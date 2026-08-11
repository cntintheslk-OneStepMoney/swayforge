# Windows packaging foundation

Issue #12 establishes the first Windows distribution path for SwayForge. It is a development/review packaging path, not a production release or updater.

## Supported foundation target

- Platform: Windows.
- Architecture: x64 only.
- Packager: `electron-builder` 26.15.7.
- Installer: NSIS assisted installer.
- Install scope: per-user (`perMachine: false`).
- Application ID: `app.swayforge.desktop`.
- Product/executable name: `SwayForge` / `SwayForge.exe`.
- Application version: the authoritative `package.json` version.
- Code signing: disabled for this foundation; no certificate or signing secret is stored in the repository.

ARM64, older Windows releases and other installer targets are not claimed as supported until they have their own build and verification evidence.

## Commands

Install the exact dependency graph first:

```text
npm ci
```

Validate the packaging contract without building an installer:

```text
npm run check:package
```

Build an unpacked Windows x64 application for smoke testing:

```text
npm run pack:win
```

Inspect the generated ASAR/resources for unexpected or private files:

```text
npm run check:package-output
```

Build the Windows x64 NSIS installer:

```text
npm run dist:win
```

The expected installer name is:

```text
SwayForge-<package-version>-win-x64-setup.exe
```

The unpacked application is created beneath `dist/win-unpacked/`. Build output under `dist/` is ignored by Git and is not source-controlled.

## Package contents

`build/electron-builder.config.cjs` deliberately uses an allowlist rather than shipping the repository wholesale. Application content is limited to:

```text
package.json
src/**/*
```

ASAR packaging is enabled. SwayForge currently has no accepted native/runtime asset that requires a manual `asarUnpack` rule. electron-builder may still perform its normal smart unpacking for dependencies that genuinely require it.

The package must not contain development-only or private/runtime material such as:

- `.git` or `.github` metadata;
- tests, scripts, docs or planning exports;
- `.env` files, certificates, private keys or credential/token stores;
- `workspace.json`, diagnostics exports or other user runtime state;
- creator media/import workspaces;
- local model files or Ollama binaries;
- logs, build caches or local databases.

`scripts/check-package-output.cjs` lists the generated `app.asar` with the pinned `@electron/asar` tooling and fails the build when required runtime files are missing or forbidden material is present. It also inspects unpacked resources and the final installer name.

## Application icon

`build/icon.svg` is the original SwayForge development icon source. It embeds no remote/third-party artwork. electron-builder accepts SVG as a Windows icon source and generates the required Windows icon representation during packaging.

This icon is intentionally suitable for foundation builds, not a promise of final marketing branding.

## Installer behaviour

The NSIS configuration uses an assisted installer so the installation directory may be changed. It creates Start Menu and desktop shortcuts using the SwayForge identity.

The installer is per-user by default and **must not delete SwayForge application data during uninstall**. `deleteAppDataOnUninstall` is explicitly false. User/project/media/credential state is a separate data lifecycle from installed program files; uninstalling the executable is not consent to destroy creator data.

No installer migration rewrites projects, media or credentials.

## Mutable data remains outside the installation

The accepted runtime already roots authoritative mutable state beneath Electron's per-user `userData` location:

- `data/` — application/project state;
- `credentials/` — protected credential-store boundary;
- `media/` — managed creator-media copies;
- `diagnostics/` — bounded local diagnostics.

The installed `resources` directory and `app.asar` are application code/assets only. They are not mutable application storage.

The Windows packaging CI smoke uses the hosted runner's real per-user `%APPDATA%` location, launches the packaged application, finds the single app-level `data/workspace.json` created there, restarts the packaged app and requires it to reuse the same workspace. It also rejects any `workspace.json` written under `dist/win-unpacked`. Because each GitHub-hosted Windows job receives an ephemeral runner profile, this validates the normal Windows path without adding a production-only storage override.

## Installer verification

The Windows packaging workflow performs these steps before any artifact is uploaded:

1. `npm ci` from the committed lockfile.
2. Full automated tests.
3. Canonical project/privacy/security/workflow/package checks.
4. Lint/static checks.
5. `npm run pack:win`.
6. ASAR/output privacy inspection.
7. Unpacked application launch and restart smoke using the same per-user workspace.
8. `npm run dist:win`.
9. Repeat package/output inspection.
10. Silent NSIS install to an isolated runner directory.
11. Launch the installed application.
12. Silent uninstall.
13. Verify the same per-user SwayForge workspace still exists after uninstall.
14. Generate a SHA-256 artifact manifest.
15. Upload the already-verified installer and manifest as a short-retention workflow artifact.

CI artifacts are review evidence only. The workflow does not create a GitHub Release or publish a production installer.

## Local Ollama boundary

Windows packaging does not bundle Ollama, a model, or an AI runtime installer. SwayForge continues to communicate only with the separately installed local Ollama service through the accepted local runtime boundary.

An unavailable Ollama service is not a packaging failure; non-AI application startup must remain graceful.

## Signing and Windows reputation

This foundation is unsigned because no approved code-signing certificate/workflow has been supplied. Windows may therefore show reputation/SmartScreen warnings for development installers. Do not add a private certificate, signing key or CI signing secret to make those warnings disappear.

Production signing is a separate release/security decision.

## Updates and network behaviour

Issue #12 adds no updater library, release-feed polling, automatic download/install, telemetry or remote logging. Packaging itself must not change SwayForge's local-first runtime behaviour.

## Release handoff

Before a later production release, release integration should re-run the Windows package workflow, review its artifact manifest, confirm the intended version, perform any additional manual Windows UX checks, and make separate decisions about signing and distribution. The Issue #12 branch itself does not publish or merge a release.
