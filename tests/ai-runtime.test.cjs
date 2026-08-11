'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { AiRuntimeService } = require('../src/ai/ai-runtime-service.cjs');
const {
  LIMITS,
  normaliseGenerationRequest
} = require('../src/ai/runtime-contracts.cjs');
const {
  OllamaProvider,
  isCloudModelIdentifier,
  normaliseLocalEndpoint
} = require('../src/ai/providers/ollama-provider.cjs');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) }
  });
}

function createOllamaFetch({ chatContent = 'Synthetic local result.', delayChat = null } = {}) {
  const calls = [];
  const fetchImpl = async (target, options = {}) => {
    const url = new URL(target);
    calls.push({ path: url.pathname, options });
    if (url.pathname === '/api/version') return jsonResponse({ version: '0.12.3-test' });
    if (url.pathname === '/api/tags') {
      return jsonResponse({
        models: [{
          name: 'local-test:latest',
          model: 'local-test:latest',
          size: 1024,
          digest: 'a'.repeat(64),
          details: {
            format: 'gguf',
            family: 'synthetic',
            parameter_size: '1B',
            quantization_level: 'Q4'
          }
        }]
      });
    }
    if (url.pathname === '/api/show') {
      return jsonResponse({ capabilities: ['completion'] });
    }
    if (url.pathname === '/api/chat') {
      if (delayChat) return delayChat(options.signal);
      return jsonResponse({ message: { role: 'assistant', content: chatContent } });
    }
    return jsonResponse({ error: 'not found' }, { status: 404 });
  };
  return { calls, fetchImpl };
}

test('Ollama endpoint is restricted to local loopback HTTP origins', () => {
  assert.equal(normaliseLocalEndpoint('http://localhost:11434'), 'http://localhost:11434');
  assert.equal(normaliseLocalEndpoint('http://127.0.0.1:11434/api'), 'http://127.0.0.1:11434');
  assert.equal(normaliseLocalEndpoint('http://[::1]:11434'), 'http://[::1]:11434');
  assert.throws(() => normaliseLocalEndpoint('https://ollama.com'), /local loopback/);
  assert.throws(() => normaliseLocalEndpoint('http://192.168.1.20:11434'), /local loopback/);
  assert.throws(() => normaliseLocalEndpoint('http://localhost:11434/proxy'), /path/);
  assert.throws(() => normaliseLocalEndpoint('http://user:pass@localhost:11434'), /credentials/);
});

test('documented Ollama cloud model identifiers are rejected by local-only policy', () => {
  assert.equal(isCloudModelIdentifier('glm-4.7:cloud'), true);
  assert.equal(isCloudModelIdentifier('gpt-oss:120b-cloud'), true);
  assert.equal(isCloudModelIdentifier('qwen3.5'), false);
});

test('provider discovers a mocked local Ollama model and text capability', async () => {
  const { calls, fetchImpl } = createOllamaFetch();
  const provider = new OllamaProvider({ fetchImpl });
  const status = await provider.getStatus({ model: 'local-test:latest' });
  assert.equal(status.state, 'ready');
  assert.equal(status.runtimeVersion, '0.12.3-test');
  assert.deepEqual(status.capabilities, ['completion']);
  assert.deepEqual(calls.map((call) => call.path), ['/api/version', '/api/tags', '/api/show']);
});

test('provider generates bounded non-streaming text without exposing tool execution', async () => {
  const { calls, fetchImpl } = createOllamaFetch({ chatContent: '<script>not executed</script>' });
  const provider = new OllamaProvider({ fetchImpl });
  const service = new AiRuntimeService({ provider, selectedModel: 'local-test:latest' });
  const result = await service.generate({
    model: 'local-test:latest',
    input: 'Synthetic prompt only.',
    structuredOutputSchema: { type: 'object', properties: { value: { type: 'string' } } },
    temperature: 0.3,
    maxOutputTokens: 128
  });
  assert.equal(result.ok, true);
  assert.equal(result.content, '<script>not executed</script>');
  const chat = calls.find((call) => call.path === '/api/chat');
  const body = JSON.parse(chat.options.body);
  assert.equal(body.stream, false);
  assert.equal(body.tools, undefined);
  assert.equal(body.options.num_predict, 128);
  assert.equal(body.options.temperature, 0.3);
  assert.equal(body.format.type, 'object');
});

test('unreachable Ollama returns unavailable without throwing through status', async () => {
  const provider = new OllamaProvider({
    fetchImpl: async () => {
      throw new TypeError('connection refused');
    }
  });
  const status = await provider.getStatus({ model: 'local-test:latest' });
  assert.equal(status.state, 'unavailable');
});

test('cloud model never reaches Ollama chat transport', async () => {
  const { calls, fetchImpl } = createOllamaFetch();
  const provider = new OllamaProvider({ fetchImpl });
  const service = new AiRuntimeService({ provider });
  const result = await service.generate({ model: 'glm-4.7:cloud', input: 'Synthetic prompt.' });
  assert.equal(result.ok, false);
  assert.equal(result.error.category, 'unsupported');
  assert.equal(calls.some((call) => call.path === '/api/chat'), false);
});

test('generation request validation rejects unbounded and arbitrary provider options', () => {
  assert.throws(
    () => normaliseGenerationRequest({ model: 'local-test', input: 'hello', arbitraryOption: true }),
    /Unsupported AI request option/
  );
  assert.throws(
    () => normaliseGenerationRequest({ model: 'local-test', input: 'x'.repeat(LIMITS.maxInputCharacters + 1) }),
    /message content|input is too large/
  );
  assert.throws(
    () => normaliseGenerationRequest({ model: 'local-test', input: 'hello', timeoutMs: 1 }),
    /timeout/
  );
});

test('runtime enforces one active inference and returns busy for concurrency', async () => {
  let release;
  const provider = {
    getStatus: async () => ({ provider: 'ollama', state: 'ready', model: 'local-test', capabilities: ['completion'] }),
    generate: async ({ requestId, request, signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      release = () => resolve({ ok: true, requestId, model: request.model, content: 'done' });
    })
  };
  const service = new AiRuntimeService({ provider });
  const first = service.generate({ model: 'local-test', input: 'one' });
  await new Promise((resolve) => setImmediate(resolve));
  const second = await service.generate({ model: 'local-test', input: 'two' });
  assert.equal(second.ok, false);
  assert.equal(second.error.category, 'busy');
  release();
  assert.equal((await first).ok, true);
});

test('runtime cancellation abandons active result delivery safely', async () => {
  const provider = {
    getStatus: async () => ({ provider: 'ollama', state: 'ready' }),
    generate: async ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    })
  };
  const service = new AiRuntimeService({ provider });
  const handle = service.startGeneration({ model: 'local-test', input: 'cancel me', timeoutMs: 5_000 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(handle.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(service.cancel(handle.requestId), true);
  const result = await handle.result;
  assert.equal(result.ok, false);
  assert.equal(result.error.category, 'aborted');
});

test('runtime timeout returns structured timeout failure', async () => {
  const provider = {
    getStatus: async () => ({ provider: 'ollama', state: 'ready' }),
    generate: async ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    })
  };
  const service = new AiRuntimeService({ provider });
  const result = await service.generate({ model: 'local-test', input: 'timeout', timeoutMs: 250 });
  assert.equal(result.ok, false);
  assert.equal(result.error.category, 'timeout');
});

test('malformed and oversized provider responses fail safely', async () => {
  const malformedProvider = new OllamaProvider({
    fetchImpl: async (target) => {
      const pathName = new URL(target).pathname;
      if (pathName === '/api/version') return jsonResponse({ version: 'test' });
      return new Response('{not json', { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  assert.equal((await malformedProvider.getStatus()).state, 'unsupported');

  const { fetchImpl } = createOllamaFetch();
  const provider = new OllamaProvider({
    fetchImpl: async (target, options) => {
      if (new URL(target).pathname === '/api/chat') {
        return new Response(JSON.stringify({ message: { content: 'x' } }), {
          status: 200,
          headers: { 'content-length': String(129 * 1024), 'content-type': 'application/json' }
        });
      }
      return fetchImpl(target, options);
    }
  });
  const service = new AiRuntimeService({ provider });
  const oversized = await service.generate({ model: 'local-test:latest', input: 'Synthetic prompt.' });
  assert.equal(oversized.ok, false);
  assert.equal(oversized.error.category, 'response-too-large');
});

test('application shutdown cancels active inference cleanly', async () => {
  const provider = {
    getStatus: async () => ({ provider: 'ollama', state: 'ready' }),
    generate: async ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    })
  };
  const service = new AiRuntimeService({ provider });
  const pending = service.generate({ model: 'local-test', input: 'shutdown', timeoutMs: 5_000 });
  await new Promise((resolve) => setImmediate(resolve));
  service.shutdown();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.error.category, 'aborted');
  assert.equal((await service.generate({ model: 'local-test', input: 'later' })).ok, false);
});

test('normal AI diagnostics exclude prompt and response content', async () => {
  const promptSentinel = 'PRIVATE_PROMPT_SENTINEL_6';
  const responseSentinel = 'PRIVATE_RESPONSE_SENTINEL_6';
  const events = [];
  const provider = {
    getStatus: async () => ({ provider: 'ollama', state: 'ready' }),
    generate: async ({ requestId, request }) => ({
      ok: true,
      requestId,
      model: request.model,
      content: responseSentinel
    })
  };
  const service = new AiRuntimeService({ provider, logger: (event) => events.push(event) });
  const result = await service.generate({ model: 'local-test', input: promptSentinel });
  assert.equal(result.content, responseSentinel);
  const serialisedLog = JSON.stringify(events);
  assert.doesNotMatch(serialisedLog, new RegExp(promptSentinel));
  assert.doesNotMatch(serialisedLog, new RegExp(responseSentinel));
});


test('external AbortSignal cancels a generation without exposing transport controls', async () => {
  const provider = {
    id: 'fake',
    getStatus: async () => ({ provider: 'fake', state: 'ready' }),
    generate: async ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    })
  };
  const service = new AiRuntimeService({ provider });
  const controller = new AbortController();
  const pending = service.generate({ model: 'local-test', input: 'cancel externally', timeoutMs: 5_000 }, { signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.error.category, 'aborted');
});

test('provider refuses model tool-call output instead of executing or treating it as success', async () => {
  const { fetchImpl } = createOllamaFetch();
  const provider = new OllamaProvider({
    fetchImpl: async (target, options) => {
      if (new URL(target).pathname === '/api/chat') {
        return jsonResponse({ message: { content: '', tool_calls: [{ function: { name: 'run_shell', arguments: {} } }] } });
      }
      return fetchImpl(target, options);
    }
  });
  const result = await new AiRuntimeService({ provider }).generate({
    model: 'local-test:latest',
    input: 'Synthetic tool request.'
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.category, 'unsupported');
});

test('runtime source has no model pull, cloud endpoint, shell, filesystem, or credential capability', () => {
  const providerSource = read('src/ai/providers/ollama-provider.cjs');
  const serviceSource = read('src/ai/ai-runtime-service.cjs');
  const combined = `${providerSource}\n${serviceSource}`;
  assert.doesNotMatch(combined, /\/api\/pull/);
  assert.doesNotMatch(combined, /https:\/\/ollama\.com/);
  assert.doesNotMatch(combined, /require\(['"]node:(?:fs|child_process)['"]\)|require\(['"](?:fs|child_process)['"]\)|secret-store/i);
});

test('renderer receives typed status only and no generic HTTP or generation bridge', () => {
  const preload = read('src/preload/preload-bridge.cjs');
  assert.match(preload, /getAiRuntimeStatus:/);
  assert.match(preload, /refreshAiRuntimeStatus:/);
  assert.doesNotMatch(preload, /generateAi|fetch\s*:\s*|request\s*:\s*|http|endpoint/);
  assert.doesNotMatch(preload, /invoke\s*:\s*\(/);
  const html = read('src/renderer/index.html');
  assert.match(html, /connect-src 'none'/);
});

test('application startup does not wait for Ollama and shutdown cancels AI work', () => {
  const mainSource = read('src/main/main-process.cjs');
  assert.match(mainSource, /createPrimaryWindow\(\);\r?\n  void getAiRuntime\(\)\.getStatus/);
  assert.match(mainSource, /app\.on\('before-quit'/);
  assert.match(mainSource, /aiRuntime\?\.shutdown\(\)/);
  assert.doesNotMatch(mainSource, /await getAiRuntime\(\)\.getStatus/);
});
