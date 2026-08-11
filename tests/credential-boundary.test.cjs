'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { ProtectedSecretStore } = require('../src/security/protected-secret-store.cjs');
const { serialiseSecretError, redactSensitiveText } = require('../src/security/secret-redaction.cjs');
const { validateSecretStoreDocument } = require('../src/security/secret-contracts.cjs');

const FIRST_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_ID = '22222222-2222-4222-8222-222222222222';
const SENTINEL = 'SYNTHETIC-CREDENTIAL-LEAK-SENTINEL-7c911f';

function createFakeSafeStorage({ available = true, backend = 'gnome_libsecret' } = {}) {
  const state = { available, backend, failEncrypt: false, failDecrypt: false };
  return {
    state,
    getSelectedStorageBackend: () => state.backend,
    isAsyncEncryptionAvailable: async () => state.available,
    encryptStringAsync: async (plainText) => {
      if (state.failEncrypt) throw new Error(`fake encrypt failure ${plainText}`);
      return Buffer.from(`protected:${Buffer.from(plainText).toString('base64')}`, 'utf8');
    },
    decryptStringAsync: async (encrypted) => {
      if (state.failDecrypt) throw new Error(`fake decrypt failure ${SENTINEL}`);
      const source = encrypted.toString('utf8');
      if (!source.startsWith('protected:')) throw new Error('invalid fake protected payload');
      return {
        shouldReEncrypt: false,
        result: Buffer.from(source.slice('protected:'.length), 'base64').toString('utf8')
      };
    }
  };
}

async function createStore(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'swayforge-secret-store-'));
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'swayforge-source-root-'));
  const ids = [FIRST_ID, SECOND_ID];
  const safeStorage = options.safeStorage ?? createFakeSafeStorage();
  const store = await ProtectedSecretStore.open({
    rootDirectory: root,
    applicationRootDirectory: sourceRoot,
    safeStorage,
    idFactory: () => ids.shift(),
    faultInjector: options.faultInjector ?? (() => {}),
    now: options.now ?? (() => new Date('2026-08-11T14:00:00.000Z'))
  });
  return { root, sourceRoot, safeStorage, store };
}

test('protected storage capability gates writes and never falls back to plaintext', async () => {
  const unavailable = await createStore({ safeStorage: createFakeSafeStorage({ available: false }) });
  assert.equal(unavailable.store.getStatus().state, 'unavailable');
  await assert.rejects(
    unavailable.store.createSecret({ provider: 'example', accountRefId: null, kind: 'access-token', value: SENTINEL, expiresAt: null }),
    (error) => error.code === 'SECRET_STORAGE_UNAVAILABLE'
  );
  await assert.rejects(fs.access(path.join(unavailable.root, 'credential-store.json')));

  const basicText = await createStore({ safeStorage: createFakeSafeStorage({ backend: 'basic_text' }) });
  assert.equal(basicText.store.getStatus().state, 'unavaile');
  await assert.rejects(
    basicText.store.createSecret({ provider: 'example', accountRefId: null, kind: 'access-token', value: SENTINEL, expiresAt: null }),
    (error) => error.code === 'SECRET_STORAGE_UNAVAILABLE'
  );
});

test('secure create/read persists only protected payload and non-secret metadata', async () => {
  const { root, store } = await createStore();
  const metadata = await store.createSecret({
    provider: 'example',
    accountRefId: 'account-1',
    kind: 'access-token',
    value: SENTINEL,
    expiresAt: '2026-08-12T14:00:00.000Z'
  });

  assert.equal(metadata.id, FIRST_ID);
  assert.equal(metadata.credentialPresent, true);
  assert.equal('value' in metadata, false);
  assert.equal('protectedPayload' in metadata, false);
  assert.equal(await store.readSecret(FIRST_ID), SENTINEL);

  const source = await fs.readFile(path.join(root, 'credential-store.json'), 'utf8');
  assert.equal(source.includes(SENTINEL), false);
  const document = JSON.parse(source);
  validateSecretStoreDocument(document);
  assert.equal(document.records[FIRST_ID].provider, 'example');
  assert.notEqual(document.records[FIRST_ID].protectedPayload, SENTINEL);
});

test('rotation is transactional and preserves the old credential on protection or commit failure', async () => {
  const fake = createFakeSafeStorage();
  let failAfterMove = false;
  const created = await createStore({
    safeStorage: fake,
    faultInjector: (point) => {
      if (failAfterMove && point === 'after-primary-moved-to-previous') throw new Error('synthetic commit interruption');
    }
  });
  await created.store.createSecret({ provider: 'example', accountRefId: null, kind: 'credential-bundle', value: 'bundle-v1', expiresAt: null });

  fake.state.failEncrypt = true;
  let caught;
  try {
    await created.store.replaceSecret({ secretId: FIRST_ID, value: SENTINEL, expiresAt: null });
  } catch (error) {
    caught = error;
  }
  assert.equal(caught.code, 'SECRET_PROTECTION_FAILED');
  assert.equal(JSON.stringify(serialiseSecretError(caught)).includes(SENTINEL), false);
  fake.state.failEncrypt = false;
  assert.equal(await created.store.readSecret(FIRST_ID), 'bundle-v1');

  failAfterMove = true;
  await assert.rejects(
    created.store.replaceSecret({ secretId: FIRST_ID, value: 'bundle-v2', expiresAt: null }),
    /synthetic commit interruption/
  );
  failAfterMove = false;
  assert.equal(await created.store.readSecret(FIRST_ID), 'bundle-v1');

  const reopened = await ProtectedSecretStore.open({
    rootDirectory: created.root,
    applicationRootDirectory: created.sourceRoot,
    safeStorage: fake
  });
  assert.equal(await reopened.readSecret(FIRST_ID), 'bundle-v1');
});

test('delete is isolated and idempotent', async () => {
  const { store } = await createStore();
  await store.createSecret({ provider: 'example', accountRefId: 'one', kind: 'refresh-token', value: 'refresh-one', expiresAt: null });
  await store.createSecret({ provider: 'example', accountRefId: 'two', kind: 'refresh-token', value: 'refresh-two', expiresAt: null });

  assert.deepEqual(await store.deleteSecret(FIRST_ID), { secretId: FIRST_ID, deleted: true });
  assert.equal(await store.hasSecret(FIRST_ID), false);
  assert.equal(await store.readSecret(SECOND_ID), 'refresh-two');
  assert.deepEqual(await store.deleteSecret(FIRST_ID), { secretId: FIRST_ID, deleted: false });
});

test('redaction and safe error serialisation do not expose token, auth, cookie or query credentials', () => {
  const unsafe = `Authorization: Bearer ${SENTINEL}\nCookie: session=${SENTINEL}\nhttps://example.test/cb?access_token=${SENTINEL}&code=${SENTINEL}`;
  const redacted = redactSensitiveText(unsafe);
  assert.equal(redacted.includes(SENTINEL), false);
  assert.match(redacted, /Authorization: \[REDACTED\]/);
  assert.match(redacted, /Cookie: \[REDACTED\]/);

  const error = new Error(`provider returned ${SENTINEL}`);
  error.code = 'SECRET_PROTECTION_FAILED';
  assert.equal(JSON.stringify(serialiseSecretError(error)).includes(SENTINEL), false);
});

test('credential store rejects paths inside the application/source tree', async () => {
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'swayforge-app-root-'));
  await assert.rejects(
    ProtectedSecretStore.open({
      rootDirectory: path.join(sourceRoot, 'credentials'),
      applicationRootDirectory: sourceRoot,
      safeStorage: createFakeSafeStorage()
    }),
    /outside the application\/source tree/
  );
});

test('renderer bridge exposes status only, while trusted main code owns secret access', async () => {
  const root = path.resolve(__dirname, '..');
  const preloadSource = await fs.readFile(path.join(root, 'src/preload/preload-bridge.cjs'), 'utf8');
  const mainSource = await fs.readFile(path.join(root, 'src/main/main-process.cjs'), 'utf8');

  assert.match(preloadSource, /getSecretStorageStatus:/);
  for (const forbidden of ['getSecret:', 'readSecret:', 'createSecret:', 'replaceSecret:', 'deleteSecret:']) {
    assert.equal(preloadSource.includes(forbidden), false, forbidden);
  }
  assert.match(mainSource, /getProtectedSecretStore/);
  assert.match(mainSource, /SECRET_IPC_CHANNELS\.status/);
  assert.doesNotMatch(mainSource, /ipcMain\.handle\([^\n]+(?:readSecret|createSecret|replaceSecret|deleteSecret)/);
});
