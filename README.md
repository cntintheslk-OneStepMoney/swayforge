![Sway Forge — Create smarter. Stay in control.](src/renderer/brand/sway-forge-lockup.svg)

# Sway Forge

Sway Forge is a local-first desktop application for AI-assisted social-content creation, management and publishing. The product goal is to reduce the work of running social accounts without taking control away from the user: models suggest and generate, while deterministic application rules govern what is allowed.

## v0.2.0 — Media Intelligence

v0.2.0 turns the application foundation into an organised, searchable and AI-understandable local creator-media library.

Included in v0.2.0:

- responsive Grid/List Media Library browsing with filtering, sorting, stable selection and safe metadata inspection;
- local image thumbnails and video poster previews generated on demand behind opaque renderer-safe URLs;
- a versioned rebuildable local metadata index with bounded text search, filters, sorting and pagination;
- SHA-256 exact duplicate identity kept separate from perceptual `highly-similar` and `related` evidence;
- optional local Ollama image/video understanding for compatible vision models, with bounded image payloads and deterministic video-frame sampling;
- user-authored tags, collections and saved views, with explicit acceptance/dismissal of local-AI tag suggestions;
- explicit integrity inspection for healthy, missing, changed and corrupt media plus exact-content recovery and safe derived-data rebuild controls;
- Sway Forge branding in the persistent shell, Settings → About, fallback surface and Windows packaging identity.

v0.2.0 does **not** connect social accounts, publish or schedule posts, collect trends, provide analytics, edit/render Content Studio videos, run Autopilot, use cloud AI, or upload creator media to third parties.

## Core authority model

The managed-media record created by the original media foundation remains authoritative for stable media ID, managed location, file size and SHA-256 content identity.

Everything else is deliberately layered around it:

- previews are disposable local derivatives;
- the search index is a rebuildable read-model;
- perceptual fingerprints are evidence only;
- local-AI descriptions/labels are derived and attributable;
- user tags, collections and saved views are user-authored authoritative organisation;
- integrity observations verify authoritative media rather than replacing it.

Clearing or rebuilding derived data must not delete source media, projects, tags or collections.

## Prerequisites

- Windows x64 is the verified packaging target for v0.2.0.
- Node.js 22.12.0 or later.
- npm.
- Ollama is optional for application startup and non-AI workflows. Local media-AI understanding requires a compatible locally installed vision model.

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
  settings/     Non-secret settings model and service
  diagnostics/  Privacy-safe local diagnostic event storage
scripts/        Quality, privacy, security, packaging and smoke checks
tests/          Deterministic architecture, media and regression coverage
build/          Windows packaging configuration and local build assets
```

## Local data and media

Normal application/project state is stored beneath Electron's per-user `userData` location rather than the installation directory. Writes are validated and staged; invalid or unsupported existing state is preserved rather than silently replaced with a blank store.

Creator source media is never moved, deleted or modified by import. Supported media is copied into SwayForge-managed local storage outside the source/install tree. Exact duplicate detection uses streamed SHA-256 hashing so large video files are not read wholly into memory.

Media previews, the local search index, perceptual fingerprints, AI analysis and integrity cache are rebuildable local derivatives/read-models. User organisation remains in authoritative application state and is not overwritten by AI suggestions.

Protected credentials remain a separate data class and are not stored in normal project/application state. Uninstall is configured not to delete the per-user Sway Forge data directory by default.

## Local AI boundary

AI features depend on the application `AiRuntimeService`, not direct provider calls from renderer code. Ollama traffic originates in trusted main-process code and is restricted to approved loopback hosts.

Media understanding requires a model that reports compatible vision capability. Images are bounded before provider execution; videos use deterministic representative frames rather than sending whole source files. Returned JSON is schema/reference validated and cannot directly perform application actions, access arbitrary paths or change user-authored organisation.

## Security and privacy baseline

- No telemetry or behavioural analytics.
- No remote crash reporting.
- No cloud AI or cloud media storage.
- No social-platform API or publishing network path in v0.2.0.
- No arbitrary renderer filesystem, shell, network, environment-variable or credential access.
- No raw credential values exposed to renderer code or ordinary diagnostics.
- Diagnostics exclude prompts/responses, creator content, media paths and credential payloads.
- Package policy checks reject private runtime data, creator media, credentials, model binaries and development-only material from release output.
- Exact-content recovery is chosen through a trusted main-process file picker; different content cannot silently replace an existing media identity.

**Never commit production social credentials, OAuth tokens, private creator media, runtime databases, local state, diagnostic exports, signing material or model caches to this repository.** Tests and fixtures must use fictional/synthetic data.

## Known v0.2.0 limitations

- Media storage is managed-copy only; referenced-source mode/relink is not implemented yet.
- Perceptual dHash similarity is intentionally conservative review evidence and can miss major edits or over-score low-detail imagery.
- Video understanding samples representative frames and does not analyse audio.
- The current search substrate is a local rebuildable JSON read-model aimed at low-thousands libraries rather than native FTS.
- Hard managed-source deletion/library-record removal remains deferred until a safe archive/removal lifecycle exists.
- Full Content Studio editing/rendering, social OAuth/publishing, trend intelligence, analytics, scheduling and Autopilot remain future releases.

## Versioning

The authoritative application version is `package.json`. Electron reports that version to the renderer/About surface, the package-lock root metadata must match it, and Windows artifact names are derived from the same value. Data schemas maintain separate schema versions.

Current application release metadata: **v0.2.0**.

See `CHANGELOG.md` for release notes and `docs/release-verification-v0.2.0.md` for the Media Intelligence release verification record.
