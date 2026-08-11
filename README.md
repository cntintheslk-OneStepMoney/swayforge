# SwayForge

SwayForge is a local-first desktop application for AI-assisted social-content creation, management and publishing. The long-term product is designed to reduce the work of running social accounts while keeping deterministic application rules and user controls authoritative.

## Current status

This repository state contains the **Application Foundation shell and local data foundation**. It establishes a secure Electron main/preload/renderer boundary plus authoritative local persistence for non-secret application state and creator-project metadata. It does **not** yet connect social accounts, call Ollama, import creator media, publish content, collect trends, schedule posts or run Autopilot.

The local AI direction is Ollama-first behind replaceable application interfaces in later work. No cloud AI fallback is introduced by this foundation.

## Prerequisites

- A supported Windows development environment is the primary target.
- Node.js 22.12.0 or later.
- npm.

Electron is pinned as a development dependency. A verified `package-lock.json` still needs to be generated in an environment with npm registry access before `npm ci` can satisfy the release acceptance criterion.

## Developer commands

```bash
npm ci
npm start
npm test
npm run check
npm run lint
```

- `npm start` launches the Electron application from source.
- `npm test` runs the architecture, security, storage, migration and integrity tests.
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
  storage/    Versioned local application/project persistence and migrations
scripts/      Foundation project and lint checks
tests/        Architecture/security/storage regression tests
```

Later work should add substantial modules under deliberate directories such as `src/ai`, `src/media` and `src/diagnostics` only when those modules actually exist. Empty architectural folders are not created merely for appearance.

## Local data foundation

SwayForge uses a dependency-free JSON repository for the initial v0.1.0 state model. The trusted main process resolves a stable `data` subdirectory beneath Electron's per-user `userData` location; renderer requests cannot choose paths or issue arbitrary filesystem/database operations.

The authoritative file is `workspace.json`. `workspace.previous.json` retains the immediately previous valid generation after a successful replacement. Candidate writes are validated, written to a sibling staging file, flushed, moved through the previous-copy boundary and re-read for verification. If an existing store is unreadable, structurally invalid or unsupported, SwayForge preserves it and refuses to initialise blank replacement state.

The initial store schema version is **1**, separate from the package version. Ordered migration infrastructure includes a deterministic schema `0 -> 1` scaffold for synthetic/pre-release compatibility testing. Mutations are serialized and use a monotonic store revision; stale callers must supply the expected revision and receive a conflict instead of silently overwriting newer work.

Creator projects contain stable UUIDs, project schema/revision, title, draft/archive lifecycle, stable `mediaIds` references and a bounded `extensions` object for later project modules. Raw image/video bytes are not part of ordinary state. No derived cache is required by this foundation; any future cache must remain rebuildable and non-authoritative.

OAuth access/refresh tokens, client secrets, signing keys, session cookies, encryption keys and passwords do not belong in this store and are rejected from normal extensible state by key policy. Protected credentials belong to the dedicated secure-storage workstream. This previous-generation mechanism is a write-integrity primitive, **not** a claim of complete backup/restore support.

## Security and privacy baseline

- Renderer Node.js integration is disabled.
- Context isolation and renderer sandboxing are enabled.
- The preload bridge exposes named, allowlisted capabilities only.
- New windows, external navigation and webviews are denied by the foundation policy.
- The renderer CSP disables network connections.
- There is no arbitrary filesystem, shell, HTTP, environment-variable or credential bridge.
- Local persistence is metadata/state only; credentials and raw creator media are separate data classes.
- There is no telemetry, analytics, cloud AI, cloud database/sync or social-platform network traffic in this foundation.

**Never commit production social credentials, OAuth tokens, private creator media, runtime databases, local state, logs or model caches to this repository.** Use fictional/synthetic data for tests and development fixtures.

## Versioning

The application displays the version reported by Electron from `package.json`; renderer code does not carry a separate hard-coded application version. Data schemas use their own version metadata. Final v0.1.0 release metadata is owned by the release-integration workstream.
