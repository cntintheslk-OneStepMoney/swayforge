# Settings and diagnostics foundation

Issue #10 adds one authoritative non-secret Settings service over the existing local application-state repository and one separate non-authoritative diagnostics store.

## Settings schema

Settings schema version: `1`.

Canonical v0.1.0 settings:

- `appearance`: `light`, `dark` or `system`;
- `ai.enabled`: local AI on/off;
- `ai.endpoint`: an Ollama loopback endpoint accepted by the existing #6 endpoint validator;
- `ai.selectedModel`: a validated local model identifier or `null`;
- `diagnostics.enabled`: whether detailed local diagnostic events are recorded;
- `diagnostics.retentionDays`: bounded retention, default 7 days;
- `diagnostics.maxEvents`: bounded retention, default 250 events.

Existing unrelated non-secret settings are preserved. Missing or invalid known values are normalised to safe defaults when the Settings service starts. The migration is idempotent: once the canonical settings shape is persisted, reopening does not write it again.

Credentials, prompts and model responses are not part of this schema. The renderer uses typed Settings IPC calls instead of direct arbitrary settings mutation.

## Ollama configuration

Settings delegates endpoint validation and runtime behaviour to the #6 Ollama boundary. v0.1.0 accepts loopback HTTP endpoints only. A changed endpoint rebuilds the trusted AI runtime; enabled/model changes update that runtime through its existing typed controls.

No model is downloaded automatically and no cloud provider/fallback is introduced.

## Diagnostics

Diagnostics are stored separately under the per-user SwayForge application-data diagnostics directory as `events.json`.

The diagnostic store is non-authoritative. Deleting, clearing, resetting or recovering it must not delete or rewrite projects, media, settings or protected credentials.

Events are allowlisted structural records containing timestamp, event code, severity, component, application version, optional local correlation/error codes and bounded safe metadata. Unsupported metadata fields are rejected. Existing credential redaction is reused and path/media-filename shaped values are replaced before persistence.

Default retention is 7 days and 250 events, with bounded configurable limits. Corrupt diagnostics are quarantined/reset without blocking core application startup.

Export is explicit and user-selected. The exported JSON contains only the structured diagnostic snapshot and retention/privacy information; it does not include application databases, project files or media.

## Privacy boundary

There is no telemetry, analytics, remote crash reporting or automatic upload. Diagnostics must not contain credentials, authorization headers/cookies, prompts/model responses, creator scripts/captions/drafts, raw media, media-derived AI descriptions, private source paths or arbitrary environment variables.
