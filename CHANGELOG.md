# Changelog

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
- Ollama and an appropriate local model must be installed/configured separately for AI availability; SwayForge does not download models automatically.
- v0.1.0 is an application foundation, not a complete social-media management product.

### Not included yet

Social account connection/OAuth, publishing/upload APIs, scheduling, trends, analytics/learning, full media intelligence, Content Studio/video editing/rendering, campaign management and Autopilot are intentionally outside v0.1.0.
