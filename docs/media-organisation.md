# Media organisation and search

Issue #20 adds authoritative, local media organisation on top of the Media Library and the rebuildable search index.

## Authority model

SwayForge keeps three sources deliberately separate:

- **User organisation** — tags, collections and saved views are explicit user-authored state. They are authoritative and persist in the revisioned local workspace store.
- **AI suggestions** — labels from local media understanding remain derived metadata. They become a user tag only after an explicit accept action. Dismissing a suggestion is also an explicit local user decision.
- **System metadata** — kind, import time, dimensions, duration, orientation and availability remain deterministic media metadata and search filters.

Re-running local AI analysis never deletes or overwrites user tags, collections or saved views.

## Storage schema and migration

The workspace schema advances from version 1 to version 2. The `1->2` migration is additive: existing application, project and media records are preserved, `media` is normalised to an object when absent, and a new `mediaOrganisation` object is created.

`mediaOrganisation` has its own schema version and stores:

- tag definitions plus media-ID assignments;
- named collections containing stable media IDs;
- saved filter criteria only (never duplicated media);
- dismissed AI suggestion labels by media ID.

All writes use the existing optimistic workspace revision and atomic staged-file commit path. A failed or interrupted organisation write therefore cannot silently replace the previous authoritative workspace. Collection or tag deletion removes references only; it never deletes managed media.

Collections may retain a stable media ID that is currently unavailable. The organisation snapshot reports those IDs as missing rather than silently dropping them.

## Search integration

The #17 media index remains rebuildable and non-authoritative. Index schema version 2 adds user tag IDs/names and collection IDs/names alongside the existing AI-derived labels and description. Search can combine:

- text query;
- one or more user tags;
- collection;
- media kind and availability;
- import date range;
- duration and dimension ranges;
- orientation;
- sort and pagination.

Text matches report their source as `filename`, `user-tag`, `collection` or `ai-label`. Renderer UI uses that attribution to identify AI-derived matches instead of presenting them as user metadata.

Organisation mutations trigger an index rebuild. The authoritative workspace remains the source of truth if the index is missing or corrupt; the index can be regenerated without changing media or organisation data.

## AI suggestion workflow

The organisation service reads only current `ready` output from #19. Candidate labels are the bounded analysis labels plus scene, activity and visual-quality cues. Suggestions exclude labels already represented by an assigned user tag and suggestions the user dismissed.

Accepting a suggestion creates or reuses a normalised user tag and assigns it to the media item. Dismissing a suggestion records only the normalised suggestion label. Neither action edits the AI analysis record.

## Renderer and IPC boundary

The preload bridge exposes named organisation operations only. Renderer code cannot submit raw filesystem paths, arbitrary IPC channels, SQL/query languages, secrets or source-media bytes.

The Media Library exposes search, active filter state, reset, saved views, batch tag/collection actions, organisation management and AI accept/dismiss controls. User-authored organisation and AI-derived suggestions are labelled separately.

## Privacy

Organisation data stays under per-user application data. Tag names, collection names, saved-view names and AI-derived descriptions are not added to diagnostics. This feature adds no telemetry, cloud sync, remote logging, browser automation or third-party media upload.
