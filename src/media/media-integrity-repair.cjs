'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { MediaIntegrityError, ensureInside, hashFile, readHeader, validSignature } = require('./media-integrity-files.cjs');

async function repairManagedMedia({ mediaId, replacementPath, repository, resolveManagedSource, repairStagingDirectory, cache, persistCache }) {
  if (typeof replacementPath !== 'string' || !path.isAbsolute(replacementPath) || replacementPath.includes('\0')) {
    throw new TypeError('replacementPath must be a trusted absolute path selected by the main process.');
  }
  const media = (await repository.getMediaRecord(mediaId))?.media;
  if (!media || media.id !== mediaId) throw new MediaIntegrityError('MEDIA_NOT_FOUND', 'Media record is unavailable.');
  if (media.importMode !== 'managed-copy') throw new MediaIntegrityError('MEDIA_REPAIR_UNSUPPORTED', 'Only managed media can be restored with this recovery path.');
  const finalPath = resolveManagedSource(media);
  const selectedStat = await fsp.stat(replacementPath).catch((error) => {
    if (error?.code === 'ENOENT') throw new MediaIntegrityError('MEDIA_REPAIR_SOURCE_MISSING', 'Selected recovery file is no longer available.', { cause: error });
    throw error;
  });
  if (!selectedStat.isFile() || selectedStat.size <= 0) throw new MediaIntegrityError('MEDIA_REPAIR_SOURCE_INVALID', 'Selected recovery item must be a regular media file.');
  const header = await readHeader(replacementPath);
  if (!validSignature(header, path.extname(media.managedReference))) throw new MediaIntegrityError('MEDIA_REPAIR_CONTENT_INVALID', 'Selected recovery file does not match the original media format.');
  const selectedHash = await hashFile(replacementPath);
  if (selectedHash !== media.sha256) {
    return Object.freeze({ mediaId, status: 'different-content', identityPreserved: true, sourceChanged: false, nextAction: 'import-as-new' });
  }
  if (Number.isSafeInteger(media.fileSize) && selectedStat.size !== media.fileSize) throw new MediaIntegrityError('MEDIA_REPAIR_VERIFY_FAILED', 'Exact-content recovery size did not match the authoritative record.');

  const staging = ensureInside(repairStagingDirectory, path.join(repairStagingDirectory, `${mediaId}-${randomUUID()}.part`));
  const backup = ensureInside(repairStagingDirectory, path.join(repairStagingDirectory, `${mediaId}-${randomUUID()}.backup`));
  let backedUp = false;
  let installed = false;
  try {
    await fsp.copyFile(replacementPath, staging);
    await fsp.chmod(staging, 0o600).catch(() => {});
    if (await hashFile(staging) !== media.sha256) throw new MediaIntegrityError('MEDIA_REPAIR_VERIFY_FAILED', 'Staged recovery copy could not be verified.');
    try {
      const current = await fsp.stat(finalPath);
      if (!current.isFile()) throw new MediaIntegrityError('MEDIA_REPAIR_DESTINATION_INVALID', 'Managed media destination is not a regular file.');
      await fsp.rename(finalPath, backup);
      backedUp = true;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await fsp.rename(staging, finalPath);
    installed = true;
    await fsp.chmod(finalPath, 0o600).catch(() => {});
    const finalStat = await fsp.stat(finalPath);
    if (finalStat.size !== media.fileSize || await hashFile(finalPath) !== media.sha256) throw new MediaIntegrityError('MEDIA_REPAIR_VERIFY_FAILED', 'Recovered managed media could not be verified after installation.');
    if (backedUp) await fsp.rm(backup, { force: true });
    delete cache.records[mediaId];
    await persistCache();
    return Object.freeze({ mediaId, status: 'restored', identityPreserved: true, sourceChanged: true, nextAction: null });
  } catch (error) {
    if (installed) await fsp.rm(finalPath, { force: true }).catch(() => {});
    if (backedUp) await fsp.rename(backup, finalPath).catch(() => {});
    throw error;
  } finally {
    await fsp.rm(staging, { force: true }).catch(() => {});
    await fsp.rm(backup, { force: true }).catch(() => {});
  }
}

module.exports = { repairManagedMedia };
