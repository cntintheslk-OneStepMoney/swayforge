# SwayForge

SwayForge is a local-first desktop application for AI-assisted social-content creation, management and publishing. The long-term product is designed to reduce the work of running social accounts while keeping deterministic application rules and user controls authoritative.

## Current status

This repository state is the **Application Foundation shell** only. It establishes a secure Electron main/preload/renderer boundary and a minimal local UI. It does **not** yet connect social accounts, call Ollama, import creator media, publish content, collect trends, schedule posts or run Autopilot.

The local AI direction is Ollama-first behind replaceable application interfaces in later work. No cloud AI fallback is introduced by this shell.

## Prerequisites

- A supported Windows development environment is the primary target.
- Node.js 22.12.0 or later.
- npm.

Electron is pinned as a development dependency. A verified `package-lock.json` still needs to be generated in an environment with npm registry access before `npm ci` can satisfy the Issue acceptance criterion.

## Developer commands

```bash
npm ci
npm start
npm test
npm run check
npm run lint
```

- `npm start` launches the Electron application from source.
- `npm test` runs the initial architecture/security tests.
- `npm run check` verifies required project structure and rejects obvious secret/runtime/private-media file classes.
- `npm run lint` performs dependency-free JavaScript syntax and repository style/safety checks.

## Source layout

```text
src/
  main/       Trusted Electron lifecycle and IPC registration
  preload/    Narrow renderer capability bridge
  renderer/   Local HTML/CSS/JS application shell
  core/       Reusable application contracts
  security/   Electron window/navigation policy
scripts/      Foundation project and lint checks
tests/        Architecture/security regression tests
```

Later work should add substantial modules under deliberate directories such as `src/ai`, `src/media`, `src/storage` and `src/diagnostics` only when those modules actually exist. Empty architectural folders are not created merely for appearance.

## Security and privacy baseline

- Renderer Node.js integration is disabled.
- Context isolation and renderer sandboxing are enabled.
- The preload bridge exposes named, allowlisted capabilities only.
- New windows, external navigation and webviews are denied by the foundation policy.
- The renderer CSP disables network connections.
- There is no arbitrary filesystem, shell, HTTP, environment-variable or credential bridge.
- There is no telemetry, analytics, cloud AI or social-platform network traffic in this foundation.

**Never commit production social credentials, OAuth tokens, private creator media, runtime databases, local state, logs or model caches to this repository.** Use fictional/synthetic data for tests and development fixtures.

## Versioning

The application displays the version reported by Electron from `package.json`; renderer code does not carry a separate hard-coded application version. Final v0.1.0 release metadata is owned by the release-integration workstream.
