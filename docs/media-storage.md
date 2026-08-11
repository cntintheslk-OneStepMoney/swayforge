# Local media storage foundation

SwayForge v0.1.0 uses **managed-copy** media by default. Importing a supported creator-owned image or video copies the file into SwayForge's per-user application data; it never moves, edits or deletes the selected source file.

## Storage and schema

Media files live beneath Electron's per-user `userData` location in a dedicated `media` domain:

- `media/files/` contains verified managed files;
- `media/.staging/` contains transient import copies only.

Application/project metadata remains in the existing authoritative local store. Media records use `media schemaVersion = 1` and are stored in an additive top-level `media` collection. The main store remains schema version 1, so valid pre-media v0.1 stores that do not yet contain `media` remain readable. The collection is created when fresh state is initialised or when the first media record is committed.

Each media record stores only the stable media ID, media kind, original basename, internal managed reference, byte size, SHA-256 content hash, import timestamp, managed-copy mode, availability state, conservative format/container information and basic dimensions/duration where the local implementation can determine them reliably.

## Supported foundation formats

The initial allowlist is deliberately conservative:

- JPEG/JPG images;
- PNG images;
- MP4 video containers;
- MOV/QuickTime video containers.

The importer verifies a format signature/container marker rather than trusting an extension alone. PNG and JPEG dimensions are extracted locally from bounded header data. MP4/MOV are accepted only after an ISO-BMFF `ftyp` check; this foundation does **not** claim video width/height/duration without a dedicated local probe, so those fields remain `null` for video until later tooling owns that capability. WebP is not advertised in v0.1.0 because this branch does not include a reliable WebP metadata path.

## Exact duplicate identity

Files are SHA-256 hashed through a bounded stream. Exact duplicate detection is based on file bytes, not filename:

- renamed identical files resolve to the existing media identity;
- an identical second import does not consume another managed copy;
- the same filename with different bytes creates a separate media identity.

The hash is identity evidence only, not a credential or authentication secret.

## Import integrity

The trusted main process selects the source file using Electron's native file picker. Renderer code never supplies a source or destination filesystem path.

For each import SwayForge validates the source, streams its hash, checks exact duplicates, copies to a private staging path derived from an opaque media ID, verifies staged size/hash, places the managed file with create-exclusive semantics so an unrelated existing file cannot be overwritten, and verifies the final size/hash again. Only then is the media record committed through the existing revision-protected local data repository. The managed file is not renderer-visible before metadata exists. If metadata commit fails, the newly finalised managed file is removed; if staging or verification fails, staging artifacts are removed and no healthy media record is created.

This ordering deliberately avoids ever committing a healthy record that points at a file which has not yet been verified and finalised.

## Project references

Projects continue to store media references as stable media IDs. Narrow attach/detach operations validate that the target project and managed media record exist and use the existing store revision guard. Detaching media from one project does not delete the managed file or remove it from another project.

Full media deletion/garbage collection belongs to later media-integrity work.

## Privacy choices

The foundation intentionally does not persist broad embedded metadata. In particular, media records do not retain:

- GPS/location coordinates;
- camera owner/device serial data;
- arbitrary embedded comments;
- source directory hierarchy;
- faces, identity analysis or object analysis;
- cloud IDs;
- raw media bytes inside JSON state.

Only `originalFilename` (the basename) is retained for display/provenance. Creator media is not uploaded and no telemetry, analytics or AI media analysis is introduced here.

## Renderer boundary

The preload bridge exposes only:

- choose/import through the trusted picker;
- list safe media summaries;
- attach a media ID to a project;
- detach a media ID from a project.

It does not expose arbitrary `readFile`, `writeFile`, directory listing, delete-path, destination-path or generic filesystem operations. Managed absolute paths and SHA-256 values are not included in ordinary renderer media summaries.

## Current limitations

This is a storage/import foundation only. It does not include media-grid UX, thumbnails, proxies, preview URLs, perceptual similarity, EXIF browsing, AI understanding, transcription, video editing/rendering, cloud storage, full media backup, relinking, or deletion/garbage-collection UX.
