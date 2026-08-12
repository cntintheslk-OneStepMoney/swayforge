# Local media metadata index

Issue #17 adds a local, rebuildable search read-model over the authoritative media/project state introduced by #8 and #4.

## Authority and storage

The authoritative workspace remains `data/workspace.json`; the index never replaces media records, projects, user decisions, or creator files. The disposable index lives below Electron `userData` at:

`cache/media-index/index.json`

The document is schema-versioned (`schemaVersion: 1`) and records the authoritative workspace `sourceRevision`. A revision mismatch is treated as stale and triggers synchronization before a search result is returned. Corrupt or schema-incompatible index files are quarantined and rebuilt from authoritative state; recovery never rewrites source media/project data.

## Why a JSON read-model for v0.2.0

SwayForge currently has an authoritative JSON repository and a low-thousands Media Library target. A compact app-owned JSON index keeps Issue #17 dependency-free, cross-platform, rebuildable, and free of native SQLite/FTS redistribution concerns. It also keeps the renderer away from database/query syntax entirely. Search reads the in-memory derived index rather than repeatedly loading/scanning authoritative workspace records or media files.

This choice is an implementation substrate, not a permanent database commitment. If later measured library scale requires FTS, the typed search contract can move behind SQLite or another local engine without changing authoritative media records or exposing raw query syntax to the renderer.

## Indexed fields

Only approved fields are copied/derived:

- stable media ID;
- original display filename and normalized stem/tokens;
- media kind;
- width, height, and derived orientation;
- exact duration and a coarse duration bucket;
- import timestamp;
- availability state;
- project ID references;
- exact-duplicate relationship state (`canonical` for #8's content-deduplicated authority);
- adapter slots for future user tags/collection names and approved local-AI labels/descriptions.

The persisted index deliberately excludes source/managed paths, source directory hierarchy, SHA-256 content hashes, raw bytes, EXIF/GPS, device/owner metadata, credentials, prompts, model responses, and arbitrary extension payloads.

## Update and rebuild rules

- Normal searches first compare the authoritative workspace revision with the index revision.
- When the revision changes, the service reads current safe media/project summaries and incrementally reuses rows whose approved source fingerprint is unchanged.
- Added/changed rows are rebuilt once; records no longer present are removed from live results.
- An explicit rebuild recreates every row deterministically.
- Corrupt/missing/schema-mismatched cache state is safe to delete or rebuild.
- Future approved derived metadata is supplied through narrow provider adapters and never written back into authoritative media records by the index.

## Search boundary

The preload exposes only named `searchMedia`, `getMediaIndexStatus`, and `rebuildMediaIndex` operations. Main-process validation accepts an allowlisted versioned request with bounded text, filters, sort, offset, and a maximum result limit of 100. Unknown keys are rejected, so SQL, FTS expressions, filesystem paths, or another generic query language cannot be submitted to a database engine.

Supported v1 search dimensions include text, kind, availability, import date range, duration range, width/height range, deterministic sort, offset, and bounded limit. Text results can attribute matches to `filename`, `user-tag`, or `ai-label` sources.

## Performance evidence

Focused automated coverage builds and searches a synthetic 5,000-item index, requests 25 of 50 matching rows, and requires the query to complete within one second in the local Node test environment. The measured focused run during implementation completed the complete 11-test file in about 1.3 seconds, with the 5,000-item case around 0.4 seconds. This is a regression guard rather than a promise for every machine.

UI debouncing and richer search/organisation presentation belong to the consumer layer (#20); Issue #17 provides the bounded local substrate only.

## Privacy and network boundary

No network service, cloud/vector search, embeddings, telemetry, analytics, remote logging, or third-party media processing is introduced. Search and indexing remain local to the desktop application.
