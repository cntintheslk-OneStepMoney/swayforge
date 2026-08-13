# Changelog

## 0.2.1 — 2026-08-13

### Added

- GitHub Projects v2 reconciliation for the complete Sway Forge development roadmap.
- Canonical `Idea → Backlog → Planned → In Progress → Review → Done` Project lifecycle visibility.
- Synchronization of Priority, Complexity, Status, Type, Target Release, Area, actual Branch, Start Date and genuine Target Date metadata.
- Full-board reconciliation, focused-Issue reconciliation and dry-run/audit modes.
- Protected GitHub Actions automation for Issue lifecycle changes and daily reconciliation.
- One-time Project configuration documentation using repository variables and a protected Project-only Actions secret.

### Security and control

- Project API credentials are never committed and are isolated to the dedicated Project synchronization workflow.
- Ordinary repository Issue/Index reads use GitHub's short-lived workflow token rather than the long-lived Project credential.
- Secret-bearing Project synchronization has no pull-request trigger and automatic runs use trusted default-branch implementation code.
- Project state cannot merge pull requests, publish releases, publish social content or grant application Autopilot authority.
- Branch and Start Date values are not fabricated for planned work; unknown Target Dates remain blank.

### Quality and release integration

- `package.json` is the authoritative v0.2.1 application version.
- The dependency lockfile remains the known-good v0.2.0 dependency snapshot because v0.2.1 changes no dependencies; security checks still require package name, dependency maps and engine metadata to match.
- Project synchronization parsing, lifecycle behavior, field-option resolution, secret redaction and workflow security are covered by deterministic tests.
- Existing Windows packaging, privacy, security and Electron smoke gates remain required before Review.

### Known limitation

The connected development assistant cannot directly populate the user-owned GitHub Project. The live first backfill therefore requires the protected Project owner/type/number variables and `SWAYFORGE_PROJECT_TOKEN` secret to be configured after merge. No credential value should be placed in source, Issues, PRs or chat.

### Not included

Content Studio features, social account connection/OAuth, publishing or scheduling posts, trend collection/scoring, analytics/learning, campaigns, automatic PR merging and application Autopilot behavior are outside v0.2.1.

## 0.2.0 — 2026-08-12

### Added

- A responsive local Media Library for browsing, filtering, sorting, selecting and inspecting managed creator media.
- Local image thumbnails and video poster previews with bounded, rebuildable derived-cache storage and opaque renderer URLs.
- A versioned local media metadata index with bounded search, filtering, sorting, pagination and deterministic rebuild/recovery.
- Perceptual image/video similarity evidence that keeps SHA-256 exact identity separate from `highly-similar` and `related` results.
- Optional local Ollama image/video understanding using compatible vision models, bounded image inputs and deterministic representative video frames.
- User-authored tags, collections and saved views, plus explicit accept/dismiss flows for local-AI tag suggestions.
- Media integrity inspection and exact-content recovery with explicit missing/changed/corrupt states and safe rebuild controls for derived systems.
- Sway Forge application branding across the shell, About surface, fallback presentation, README and Windows packaging identity.

### Security and privacy

- Creator media, previews, index rows, similarity fingerprints and AI analysis remain local; no cloud media or cloud-AI fallback was added.
- SHA-256 remains authoritative for exact media identity. Perceptual similarity is review evidence only and never authorises deletion or replacement.
- User-authored tags and collections remain authoritative over AI-derived labels and descriptions.
- Integrity/recovery uses trusted main-process file selection; renderer code does not gain arbitrary filesystem paths or generic file access.
- Derived preview/index/similarity/AI data remains rebuildable and is never the sole copy of source media, projects or user organisation.
- No telemetry, behavioural tracking, remote crash reporting or social-platform network path was introduced.

### Quality and release integration

- v0.2.0 release metadata is aligned across package metadata, lock metadata, About/runtime versioning, artifact naming, README and changelog.
- Release regression coverage verifies the integrated Media Intelligence modules remain present behind the single application bootstrap and preserves existing packaging/privacy/security gates.
- Existing feature-scale tests cover low-thousands media-index/similarity workloads and bounded renderer/progressive-work behaviour.

### Known limitations

- v0.2.0 uses managed-copy media. Referenced-source storage/relink is not yet implemented; `needs-relink` remains reserved for that future mode.
- Video AI understanding samples representative frames rather than analysing every frame or audio.
- Perceptual dHash similarity can miss major crops/overlays/structural edits and can over-score simple imagery, so it remains evidence rather than identity.
- The local search read-model is a rebuildable JSON index for the current low-thousands target rather than a native SQLite/FTS dependency.
- Hard managed-source deletion/library-record removal remains deliberately deferred until a safe archive/removal lifecycle exists.
- Windows x64 remains the verified packaging target and the installer remains unsigned.
- Ollama and a compatible local model are installed/configured separately; Sway Forge does not download models automatically.

### Not included yet

Content Studio editing/rendering, social account connection/OAuth, publishing or scheduling posts, trend collection/scoring, analytics/learning, campaigns and Autopilot remain outside v0.2.0.

## 0.1.0 — 2026-08-11

### Added

- Secure Electron application shell with narrow preload capabilities and conservative navigation/window policy.
- Versioned local application and project storage with revision protection, staged writes and conservative corrupt-state handling.
- Protected local credential-storage boundary kept separate from ordinary state and renderer access.
- Local-only Ollama runtime/provider abstraction with loopback enforcement, model capability checks, cancellation and bounded generation.
- Structured AI task/context/response contracts with application-side schema and reference validation.
- Managed local creator-media import for JPEG/PNG/MP4/MOV, streamed exact-duplicate hashing and non-destructive source handling.
- Shared application navigation/design system with Home, Projects, Media and Settings foundation views.
- Persistent Light, Dark and Follow System appearance settings.
- Privacy-safe bounded local diagnostics with explicit export and clear operations.
- Repository-wide Linux/Windows tests, privacy/security/workflow policy checks, linting and deterministic dependency lockfile.
- Windows x64 Electron packaging and NSIS installer foundation with package-content privacy inspection, packaged launch/restart checks and non-destructive uninstall verification.

### Security and privacy

- Renderer Node.js integration remains disabled and context isolation/sandboxing remain enabled.
- Credentials, creator media and ordinary application state remain separate data classes under trusted local boundaries.
- No telemetry, analytics, cloud AI, remote logging, social publishing or background account integration is introduced.
- Model output remains advisory/untrusted and cannot directly execute application actions.

### Known limitations

- Windows x64 is the verified packaging target for v0.1.0.
- The installer is unsigned and may trigger Windows reputation/SmartScreen warnings.
- Ollama and an appropriate local model must be installed/configured separately for AI availability; Sway Forge does not download models automatically.
- v0.1.0 is an application foundation, not a complete social-media management product.

### Not included yet

Social account connection/OAuth, publishing/upload APIs, scheduling, trends, analytics/learning, full media intelligence, Content Studio/video editing/rendering, campaign management and Autopilot are intentionally outside v0.1.0.