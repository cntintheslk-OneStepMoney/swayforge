# Local media preview pipeline

Issue #16 adds a rebuildable, local-only preview cache for the Media Library.

## What is generated

- Images are decoded with Electron `nativeImage`, resized to fit inside 512×512, normalised for JPEG EXIF orientation by the trusted generator, and re-encoded as PNG.
- Videos are decoded by an isolated, hidden Electron renderer using Chromium's local media decoder. A bounded poster frame is drawn to canvas and re-encoded as PNG.
- Low-resolution video proxy files are not generated in this workstream. The poster frame is sufficient for the current Media Library; full proxy/transcode work remains excluded until an editing/playback workflow justifies it.

No cloud AI, remote transcoder, FFmpeg binary, shell command, or third-party media service is introduced. There are no new runtime dependencies or redistribution licences for #16 beyond Electron already used by SwayForge.

## Storage and identity

Authoritative creator media remains under the existing managed media root. Preview data is stored separately below the per-user application cache area:

`cache/media-previews/`

The cache contains an index, temporary staging files while a job is running, and final PNG artifacts. Each artifact identity includes the authoritative media ID, source SHA-256, artifact kind/version, and generator version. Original filenames are never used as cache paths.

Derived files are disposable. Deleting or rebuilding them must not delete or rewrite source media.

## Invalidation and failure safety

A healthy artifact is reused when its identity and PNG validation still match. It is regenerated when the cached file is missing/corrupt, the source content hash changes, or the generator version changes. Generation is staged first and only published after validation.

The queue is bounded (two concurrent jobs, 128 total queued/running by default). Shutdown cancels queued/running work and does not mark an incomplete artifact healthy. Failed generation leaves source media intact and exposes only a safe failure state to the renderer.

## Renderer boundary

The renderer receives typed preview status plus a controlled URL such as:

`swayforge-preview://artifact/<opaque-artifact-id>`

It never receives source hashes, managed filesystem references, arbitrary local paths, process handles, or a generic file-read capability. The protocol handler accepts only known 64-character artifact IDs and serves only preview files that the trusted cache service has validated.

## Metadata/privacy

Image thumbnails are re-encoded from decoded pixels, which prevents source EXIF/GPS metadata bytes from being copied into the PNG derivative. Electron does not apply EXIF metadata itself, so SwayForge reads only the bounded JPEG header needed for orientation and rotates/mirrors the already-bounded bitmap before PNG encoding. Video poster frames are similarly generated from decoded pixels. Source media remains unchanged.

## Generator-version changes

`MEDIA_PREVIEW_GENERATOR_VERSION` in `src/main/preview-bootstrap.cjs` is the explicit invalidation boundary. Increment it whenever a generator change makes existing derivatives unsuitable or unsafe to reuse.
