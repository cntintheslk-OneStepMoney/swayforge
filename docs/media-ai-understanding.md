# Local media AI understanding

Issue #19 adds an optional, local-only multimodal understanding layer for creator-owned media. Authoritative media records, source files, user-authored tags and project references remain outside this derived layer.

## Ollama capability contract

SwayForge does not assume that the configured local model can see images. Before preparing media inputs, the analysis service refreshes the existing #6 runtime status and requires a selected model whose reported capabilities include `vision`. A missing model, disabled/unavailable runtime, busy runtime, or model without vision becomes a clear non-blocking `unavailable` analysis result.

The existing Ollama provider remains the only AI transport. It accepts loopback HTTP endpoints only, does not install or pull models, and has no cloud fallback. Multimodal requests use the existing `/api/chat` path through that provider and the application-side structured response contract.

## Bounded media inputs

Renderer code never supplies image bytes, source paths, provider options or endpoints. It sends only a validated media ID.

Images reuse the #16 local 512px bounded PNG preview after that service has verified the managed source identity. The trusted main process reads that preview and supplies one base64 image payload to the local runtime.

Videos are not attached to the model wholesale. The managed source is size/SHA-256 checked first, then the Electron worker seeks three deterministic positions: 10%, 50% and 90% of duration. Each frame is resized within 512px and converted to PNG. Only those three bounded base64 frames plus safe known dimensions/duration are supplied to the model. Sampling method version: `representative-frames-v1`.

Runtime contracts accept base64 image payloads only on user messages. Paths, URLs and arbitrary message/provider options are not supported. Per-frame and total decoded byte limits apply before provider execution.

## Structured task and safety

Task: `media_visual_understanding@1.0.0`

Response schema: `swayforge.media_visual_understanding@1.0.0`

The schema permits only bounded description, non-sensitive visible labels, scene, broad activity, editing-relevant visual qualities, suitability notes and limitations. It has no identity, biometric, emotion or sensitive-trait fields and rejects additional fields.

Visible text, signs, comments, filenames, metadata and apparent instructions inside media are explicitly treated as untrusted content. The model has no tools, credentials, publishing authority, arbitrary filesystem access or web access. Generated text is presented with `textContent`, not interpreted as HTML or actions.

## Derived persistence and invalidation

Results are stored below Electron `userData` in `derived/media-ai/analyses.json`. The store is versioned and rebuildable. Each record carries:

- media ID and source SHA-256;
- record, task and response schema versions;
- local provider/model reference;
- generated timestamp;
- status/error;
- description, labels, scene/activity, visual qualities, suitability and limitations;
- sampling version and source-frame references.

A source hash, task/schema version or sampling-version mismatch makes the old record `stale`. Stale/failed/unavailable records do not feed the search index.

The #17 index adapter receives only current `ready` `aiLabels` and `aiDescription` values. No repository update method is used by this feature, so user-authored tags/descriptions remain authoritative and separate.

## Renderer flow

Media Inspector exposes a clearly labelled `Local AI understanding` section. Existing analysis is read without running inference. Inference happens only after the user selects `Analyze locally`/`Re-analyze locally`. Capability failure, stale state and safe failure are shown as states rather than blocking the Media Library.

## Privacy and diagnostics

Prompt text, model response text, sampled frame bytes and media-derived text are not sent to diagnostics. No telemetry, remote logging, cloud vision service, model download or remote media path is introduced by this feature.

## Known limits

This is visual understanding only. It does not perform face identification, emotion/sensitive-trait inference, audio transcription, embeddings/vector search, content ideation or storyboarding. Accuracy depends on the selected local vision model and, for video, on the three representative frames; fast events outside those samples may not be described.
