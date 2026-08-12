# Media integrity, recovery and derived cleanup

Issue #21 adds an explicit, local-only media health workflow. The authoritative media record remains the source of truth; integrity results are derived observations and never overwrite creator projects, tags, collections, or media identity.

## Health states

An explicit integrity scan can report:

- `healthy` — the managed file exists, its container signature is plausible, and its content hash matches the authoritative record. A later unchanged size/mtime check may reuse that prior verification until a forced hash is requested.
- `missing` — the managed file is no longer present. Metadata and references are preserved.
- `changed` — file size or SHA-256 no longer matches the authoritative record.
- `corrupt` — the managed reference is unsafe, the destination is not a regular file, the media signature is invalid, or the file cannot be read safely.
- `needs-relink` — reserved for a future referenced-source storage mode. v0.2 currently imports managed copies only.

Scans are user-triggered, bounded to 250 items per request, cancellable, and do not hash the full library at startup. A previously verified healthy file can skip an expensive re-hash only when authoritative hash, size, and mtime are unchanged. Observing a missing, corrupt, or size-changed source invalidates that cached trust.

The integrity cache contains media IDs, authoritative hashes, sizes, mtimes, state and timestamps only. It does not persist source paths or filenames.

## Recovery

Recovery uses an Electron main-process file picker. The renderer sends only the media ID and never receives or supplies an arbitrary filesystem path.

For managed media, the selected file is validated as a regular file, checked against the expected media signature, and hashed locally. If the hash is identical, Sway Forge stages and verifies a managed copy before installing it under the existing managed reference. The media ID and all project/tag/collection references remain unchanged.

If the selected file has different content, the existing identity is not replaced. The recovery result says to import it as new content instead. No metadata or managed source bytes are changed by that result.

A missing managed file cannot be reconstructed from metadata, previews, AI analysis, or similarity fingerprints. Sway Forge preserves the record for deliberate recovery rather than pretending it is healthy.

## Derived cleanup

The inspector can explicitly rebuild rebuildable state:

- preview/poster cache for the selected media;
- the local search index;
- the local similarity fingerprint cache;
- local AI analysis only when the user explicitly includes AI regeneration.

Derived rebuilds operate through their existing services. They never delete source media or mutate authoritative projects, user tags or collections. Failures are reported per component, while source data remains preserved.

## Destructive behaviour

Hard source-byte deletion and library-record removal are deliberately **not exposed** by Issue #21. The existing authoritative media schema has no archive/removal lifecycle that can be added safely without a separate storage/migration design. Adding a misleading delete action here would be riskier than deferring it.

Normal integrity scans and derived cleanup therefore have these guarantees:

- no external source file is deleted;
- no managed source file is deleted;
- no project, tag, collection, or media record is silently removed;
- no automatic duplicate merge or destructive deduplication is performed.

A future hard-delete/library-removal issue must define reference impact, confirmation, transactional ordering, shared-reference behaviour, failure recovery, and the distinction between deleting a library record and deleting managed bytes.

## Privacy and diagnostics

All checking, hashing and repair stays local. No media bytes, filenames, paths, integrity hashes, AI descriptions, tag names or collection names are sent to telemetry or remote logging. The renderer receives bounded status codes and media IDs rather than filesystem paths.

## Limitations

- v0.2 has managed-copy media only; referenced-source relink is represented in the integrity model but cannot be exercised until a referenced storage mode exists.
- Container/signature validation is deliberately lightweight. The authoritative SHA-256 is the identity check; this feature is not a full codec decoder or forensic corruption detector.
- AI regeneration depends on the configured local Ollama vision runtime and may fail independently without affecting source or user-authored state.
