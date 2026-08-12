![Sway Forge — Create smarter. Stay in control.](src/renderer/brand/sway-forge-lockup.svg)

# Sway Forge

Sway Forge is a local-first desktop application for AI-assisted social-content creation, management and publishing. The product goal is to reduce the work of running social accounts without taking control away from the user: models suggest and generate, while deterministic application rules govern what is allowed.

## v0.1.0 — Application Foundation

The v0.1.0 foundation provides the secure local desktop substrate that later media intelligence, Content Studio, social publishing, trends, scheduling and Autopilot releases build on.

Included in v0.1.0:

- secure Electron main/preload/renderer boundaries with context isolation, renderer sandboxing and no unrestricted Node.js access;
- versioned local application/project persistence under Electron per-user data storage, with revision conflicts and conservative corrupt-state handling;
- a separate protected credential-storage boundary that does not expose raw secrets to the renderer;
- a provider-neutral local AI runtime with Ollama as the first provider, restricted to approved loopback endpoints and local-capable models;
- structured AI task/context/response contracts with application-side schema and reference validation;
- managed local image/video import with streamed SHA-256 exact-duplicate detection and non-destructive source handling;
- a shared navigation/design system for Home, Projects, Media and Settings, with future destinations visibly unavailable rather than simulated;
- persistent Light, Dark and Follow System appearance settings;
- privacy-safe bounded local diagnostics with explicit export/clear controls;
- Linux/Windows automated quality, privacy, security, workflow and lint checks;
- Windows x64 unpacked packaging and an NSIS installer foundation with non-destructive uninstall behaviour.

v0.1.0 does **not** connect social accounts, publish or schedule posts, collect trends, provide analytics, edit/render social videos, run Autopilot, use cloud AI, or upload creator media to third parties.

## Prerequisites

- Windows x64 is the verified packaging target for v0.1.0.
- Node.js 22.12.0 or later.
- npm.
- Ollama is optional for application startup and non-AI workflows. When enabled, Sway Forge accepts approved local loopback Ollama endpoints only.

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

`pack:win` builds the unpacked Windows x64 application. `dist:win` builds the configured NSIS installer. The v0.1.0 installer is unsigned, so Windows reputation/SmartScreen warnings may appear. Packaging does not publish a release and no auto-update behaviour is included.

## Source layout

```text
src/
  main/         Trusted Electron lifecycle, IPC and application services
  preload/      Narrow renderer capability bridge
  renderer/     Local HTML/CSS/JS application shell and product-owned brand assets
  core/         Shared application contracts
  storage/      Versioned local application/project persistence
  security/     Window, navigation and credential boundaries
  ai/           Local AI runtime, providers and structured task contracts
  media/        Managed local media import/storage foundation
  settings/     Non-secret settings model and service
  diagnostics/  Privacy-safe local diagnostic event storage
scripts/        Quality, privacy, security, packaging and smoke checks
tests/          Deterministic architecture and regression coverage
build/          Windows packaging configuration and local build assets
```

## Local data and media

Normal application/project state is stored beneath Electron's per-user `userData` location rather than the installation directory. Writes are validated and staged; invalid or unsupported existing state is preserved rather than silently replaced with a blank store.

Creator source media is never moved, deleted or modified by import. Supported media is copied into SwayForge-managed local storage outside the source/install tree. Exact duplicate detection uses streamed SHA-256 hashing so large video files are not read wholly into memory.

Protected credentials remain a separate data class and are not stored in normal project/application state. Uninstall is configured not to delete the per-user SwayForge data directory by default.

## Local AI boundary

AI features depend on the application `AiRuntimeService`, not direct provider calls from renderer code. Ollama traffic originates in trusted main-process code and is restricted to approved loopback hosts. Cloud-model identifiers are rejected for the v0.1.0 local-only contract.

Structured AI tasks use bounded allowlisted context, treat user/model text as untrusted data, validate returned JSON and application references, and reject executable/tool-style authority. AI output cannot directly perform application actions or mutate project/media state.

## Security and privacy baseline

- No telemetry or behavioural analytics.
- No remote crash reporting.
- No cloud AI or cloud media storage.
- No social-platform API or publishing network path in v0.1.0.
- No arbitrary renderer filesystem, shell, network, environment-variable or credential access.
- No raw credential values exposed to renderer code or ordinary diagnostics.
- Diagnostics exclude prompts/responses, creator content and credential payloads.
- Package policy checks reject private runtime data, creator media, credentials, model binaries and development-only material from release output.

**Never commit production social credentials, OAuth tokens, private creator media, runtime databases, local state, diagnostic exports, signing material or model caches to this repository.** Tests and fixtures must use fictional/synthetic data.

## Versioning

The authoritative application version is `package.json`. Electron reports that version to the renderer/About surface, and Windows artifact names are derived from the same value. Data schemas maintain separate schema versions.

Current application release metadata: **v0.1.0**.

See `CHANGELOG.md` for release notes and `docs/release-verification-v0.1.0.md` for the release verification record.
