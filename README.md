![Sway Forge — Create smarter. Stay in control.](src/renderer/brand/sway-forge-lockup.svg)

# Sway Forge

Sway Forge is a local-first desktop application for AI-assisted social-content creation, management and publishing. The product goal is to reduce the work of running social accounts without taking control away from the user: models suggest and generate, while deterministic application rules govern what is allowed.

## v0.3.0 — Content Studio

v0.3.0 adds the first complete local Content Studio workflow: creators can turn selected local media and a creative brief into editable writing, storyboard, timeline, rendered video, cover and platform-shaped export variants while keeping source media authoritative and non-destructive.

Included in v0.3.0:

- versioned local content projects and creative briefs with revision protection and explicit user/AI provenance;
- optional local-Ollama ideas, hooks, scripts, captions, rewrites and critiques that remain proposals until accepted;
- AI-assisted or fully manual storyboards constrained to approved real media IDs;
- an editable non-destructive timeline with trim, split, replace, reorder, still-duration, undo/redo and keyboard alternatives;
- deterministic local FFmpeg rendering with structured arguments, staged output, ffprobe verification, checksums, cancellation cleanup and bounded concurrency;
- timed subtitles, hooks, titles and labels using controlled styles and safe text escaping;
- local imported audio and voiceover foundations with explicit rights provenance and bounded mixing controls;
- local cover/thumbnail creation from creator media or render outputs;
- deterministic 9:16, 1:1 and 16:9 export variants with local destination/collision protection and provenance records.

v0.3.0 does **not** connect social accounts, publish or schedule posts, collect trends, provide analytics, run Autopilot, use cloud AI, cloud rendering or upload creator media to third parties.

## v0.2.1 — Project Board Automation

v0.2.1 is a focused maintenance release that makes the GitHub Project the development control room for Sway Forge before Content Studio work begins.

Included in v0.2.1:

- a canonical `Idea → Backlog → Planned → In Progress → Review → Done` development lifecycle;
- full-roadmap Project reconciliation from the Development Index plus verified Issue/Git state;
- synchronization of Priority, Complexity, Status, Type, Target Release, Area, actual Branch, Start Date and genuine Target Date;
- full-board, focused-Issue and dry-run/audit synchronization modes;
- a protected GitHub Actions workflow for Issue lifecycle changes and daily reconciliation;
- one-time protected Project owner/type/number and credential setup documentation;
- deterministic tests for lifecycle parsing, Project field/option handling, branch/date safety, credential redaction and workflow security.

## v0.2.0 — Media Intelligence

v0.2.0 turned the application foundation into an organised, searchable and AI-understandable local creator-media library.

Included in v0.2.0:

- responsive Grid/List Media Library browsing with filtering, sorting, stable selection and safe metadata inspection;
- local image thumbnails and video poster previews generated on demand behind opaque renderer-safe URLs;
- a versioned rebuildable local metadata index with bounded text search, filters, sorting and pagination;
- SHA-256 exact duplicate identity kept separate from perceptual `highly-similar` and `related` evidence;
- optional local Ollama image/video understanding for compatible vision models, with bounded image payloads and deterministic video-frame sampling;
- user-authored tags, collections and saved views, with explicit acceptance/dismissal of local-AI tag suggestions;
- explicit integrity inspection for healthy, missing, changed and corrupt media plus exact-content recovery and safe derived-data rebuild controls;
- Sway Forge branding in the persistent shell, Settings → About, fallback surface and Windows packaging identity.

## Core authority model

The managed-media record created by the original media foundation remains authoritative for stable media ID, managed location, file size and SHA-256 content identity.

Everything else is deliberately layered around it:

- previews are disposable local derivatives;
- the search index is a rebuildable read-model;
- perceptual fingerprints are evidence only;
- local-AI descriptions/labels and Content Studio writing/storyboards are derived or accepted content with provenance;
- timelines, rendered videos, covers and export variants are references/derivatives and never replace source media;
- user tags, collections and saved views are user-authored authoritative organisation;
- integrity observations verify authoritative media rather than replacing it.

Clearing or rebuilding derived data must not delete source media, projects, tags or collections.

The GitHub Project is likewise a synchronized development visibility surface. GitHub Issues/Index and verified Git/PR state remain the written development authority; Project state cannot merge work, publish releases or grant application publishing/Autopilot authority.

## Prerequisites

- Windows x64 is the verified packaging target for v0.3.0.
- Node.js 22.12.0 or later.
- npm.
- FFmpeg/ffprobe must resolve through an explicitly packaged, configured or system-path installation for local rendering. Sway Forge does not silently download FFmpeg.
- Ollama is optional for application startup and manual Content Studio workflows. Local AI features require a compatible locally installed model.

No model is downloaded automatically and there is no cloud-AI fallback.

## Developer commands

```bash
npm ci
npm start
npm test
npm run check
npm run lint
```

Focused checks include:

```bash
npm run test:smoke
npm run test:windows
npm run check:privacy
npm run check:security
npm run check:workflow
npm run check:package
npm run smoke:electron
```

Project bookkeeping can be reconciled by the dedicated automation after its protected repository variables/secret are configured. The underlying developer command is:

```bash
npm run sync:project
```

Windows packaging commands:

```bash
npm run pack:win
npm run check:package-output
npm run dist:win
```

`pack:win` builds the unpacked Windows x64 application. `dist:win` builds the configured NSIS installer. The installer is unsigned, so Windows reputation/SmartScreen warnings may appear. Packaging does not publish a release and no automatic update behaviour is enabled.

## Source layout

```text
src/
  main/         Trusted Electron lifecycle, IPC and composed media/application services
  preload/      Narrow renderer capability bridge
  renderer/     Local HTML/CSS/JS application shell, Media Library and product-owned brand assets
  core/         Shared application contracts
  storage/      Versioned local application/project persistence
  security/     Window, navigation and credential boundaries
  ai/           Local Ollama runtime and structured AI task contracts
  media/        Import, previews, index/search, similarity, AI understanding, organisation and integrity
  content/      Content projects, writing, storyboard, timeline, rendering, text/audio, covers and export variants
  settings/     Non-secret settings model and service
  diagnostics/  Privacy-safe local diagnostic event storage
scripts/        Quality, privacy, security, packaging, Project sync and smoke checks
tests/          Deterministic architecture, media, Content Studio and regression coverage
build/          Windows packaging configuration and local build assets
```

## Local data and media

Normal application/project state is stored beneath Electron's per-user `userData` location rather than the installation directory. Writes are validated and staged; invalid or unsupported existing state is preserved rather than silently replaced with a blank store.

Creator source media is never moved, deleted or modified by import. Supported media is copied into SwayForge-managed local storage outside the source/install tree. Exact duplicate detection uses streamed SHA-256 hashing so large video files are not read wholly into memory.

Media previews, the local search index, perceptual fingerprints, AI analysis and integrity cache are rebuildable local derivatives/read-models. Content Studio timeline/render/cover/export outputs remain separate derivatives or references. User organisation and accepted creator edits remain authoritative and are not silently overwritten by AI suggestions.

Protected credentials remain a separate data class and are not stored in normal project/application state. Uninstall is configured not to delete the per-user Sway Forge data directory by default.

## Local AI boundary

AI features depend on trusted application services rather than direct provider calls from renderer code. Ollama traffic originates in trusted main-process/provider code and is restricted to approved loopback hosts.

Media understanding requires a model that reports compatible vision capability. Images are bounded before provider execution; videos use deterministic representative frames rather than sending whole source files. Content Studio writing/storyboard generation receives only bounded approved context and model output remains advisory until application validation and user acceptance. Manual Content Studio creation remains available when Ollama is unavailable.

## Security and privacy baseline

- No telemetry or behavioural analytics.
- No remote crash reporting.
- No cloud AI, cloud rendering or cloud media storage.
- No social-platform API, social publishing or scheduling network path in v0.3.0.
- No automatic trending-audio download and no background microphone capture.
- No arbitrary renderer filesystem, shell, network, environment-variable or credential access.
- No raw credential values exposed to renderer code or ordinary diagnostics.
- Diagnostics exclude prompts/responses, creator content, media paths and credential payloads.
- FFmpeg is invoked with structured arguments and `shell:false`; user/model text cannot supply raw commands or flags.
- Package policy checks reject private runtime data, creator media, credentials, model binaries and development-only material from release output.
- Exact-content recovery is chosen through a trusted main-process file picker; different content cannot silently replace an existing media identity.
- GitHub Project credentials are protected Actions secrets and are never committed or exposed to ordinary PR execution.

**Never commit production social credentials, OAuth tokens, GitHub Project tokens, private creator media, runtime databases, local state, diagnostic exports, signing material or model caches to this repository.** Tests and fixtures must use fictional/synthetic data.

## Known v0.3.0 limitations

- Windows x64 remains the verified packaging target and the installer is unsigned.
- Production FFmpeg distribution is not silently bundled/downloaded by v0.3.0; packaged/configured/system-path resolution is supported and any future bundled binary requires explicit redistribution/licensing review.
- Timed text uses controlled presets rather than arbitrary fonts, CSS or filtergraphs.
- Audio provides local imported/voiceover foundations rather than trending-audio acquisition or a full DAW-style editor.
- Export profiles express local platform intent only; they do not claim a connected account or verified live compatibility.
- Ollama and compatible models remain separately installed/configured and are optional for manual Content Studio work.
- Live Project mutation cannot be exercised in ordinary PR CI because the protected Project credential is intentionally unavailable there.
- Media storage is managed-copy only; referenced-source mode/relink is not implemented yet.
- Perceptual dHash similarity is conservative review evidence and can miss major edits or over-score low-detail imagery.
- Video understanding samples representative frames and does not analyse audio.
- The current search substrate is a local rebuildable JSON read-model aimed at low-thousands libraries rather than native FTS.
- Hard managed-source deletion/library-record removal remains deferred until a safe archive/removal lifecycle exists.
- Social OAuth/publishing, trend intelligence, analytics, scheduling/campaigns and Autopilot remain future product work.

## Versioning

The authoritative application/release version is `package.json`. Electron reports that version to the renderer/About surface and Windows artifact names derive from the same value. `package-lock.json` remains the authoritative dependency snapshot: its package name, dependency maps and engine metadata must match `package.json`; a no-dependency release does not require cosmetic lockfile root-version rewriting. Data schemas maintain separate schema versions.

Current application release metadata: **v0.3.0**.

See `CHANGELOG.md` for release notes and `docs/release-verification-v0.3.0.md` for the Content Studio release verification record.
