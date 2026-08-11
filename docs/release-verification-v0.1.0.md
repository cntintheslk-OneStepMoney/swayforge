# SwayForge v0.1.0 release verification

This document records the release-integration verification for Issue #13. It distinguishes inherited upstream evidence from checks executed on the integrated release branch and never treats an unavailable or manual check as passed.

## Integrated workstreams

Accepted v0.1.0 foundations: #3 application shell, #4 local storage/projects, #5 credential boundary, #6 Ollama runtime, #7 structured AI contracts, #8 media foundation, #9 navigation/design system, #10 settings/diagnostics, #11 quality/CI, and #12 Windows packaging.

Issue #12 was accepted through its dependency branch rather than landing directly on `main`; Issue #13 deliberately integrates that reviewed packaging tree on top of the current `main` release base.

## Upstream verification evidence

- #11 final Linux and Windows quality runs passed clean `npm ci`, the complete automated test suite, canonical project/privacy/security/workflow checks, lint/static checks, Windows path/storage coverage and Electron preflight.
- #12 final Windows packaging run passed clean `npm ci`, complete tests/check/lint, unpacked Windows x64 build, package-content privacy inspection, packaged launch/restart, NSIS installer build, installed launch, uninstall and preservation of per-user workspace data.
- #12 Git-conventions validation passed on its final reviewed head.

These are inherited results only; they are not substituted for Issue #13 release-branch verification.

## Issue #13 integration findings

Release integration identified two release-quality defects before Review and corrected both without weakening the existing guards:

- `package.json` had moved to the final `0.1.0` version while the inherited lockfile root metadata still reported `0.1.0-dev.0`. The lock metadata was synchronized to `0.1.0`, dependency pins/integrity data were left unchanged, and release regression coverage now requires both lockfile version fields to match `package.json`.
- The initial release regression test incorrectly expected `--publish never` to be repeated directly in the Windows workflow YAML. The actual safety boundary is the `pack:win`/`dist:win` package scripts. The test now requires those scripts to contain `--publish never` and requires the workflow to invoke those scripts.

## Release-branch verification evidence

The implementation candidate at `3ae8e7d6906a1339afc6701077b8a84d0ca22610` was exercised by all three release gates before this verification-record update:

- **Git conventions — run 31544944313:** passed the OSM/SwayForge PR title, required-description-section and commit-message conventions.
- **Quality and privacy — run 31544944262:** passed on Linux and Windows. This included clean locked dependency installation, the complete automated suite, repository privacy guard, source security policy, workflow policy, canonical project/package integrity checks, lint/static checks, production dependency advisory review, Windows path/storage regressions, Electron non-interactive preflight and whitespace validation.
- **Windows packaging — run 31544944343:** passed clean install, complete tests/check/lint, unpacked Windows x64 build, package-content privacy inspection, packaged launch/restart, NSIS installer build, installer naming/output reinspection, installed launch, uninstall with per-user application/workspace data preservation, verified artifact manifest generation and installer artifact upload.

This document-only record update changes no runtime, persistence, security, packaging or dependency code. The pull request's required checks must also be green on the resulting review-candidate head before Issue #13 is moved to Review.

## Release-branch verification matrix

| Check | Status | Evidence / reason |
| --- | --- | --- |
| Clean `npm ci` | Passed | Linux quality, Windows quality and Windows packaging gates completed locked installs successfully. |
| Complete `npm test` | Passed | Complete automated suite passed on Linux, Windows and the Windows packaging gate. |
| `npm run check` | Passed | Project, privacy, security, workflow and package policy gates passed. |
| `npm run lint` | Passed | Linux, Windows and packaging lint/static checks passed. |
| `git diff --check` | Passed | Quality gates completed whitespace validation successfully. |
| Git/PR conventions | Passed | Git conventions run 31544944313 completed successfully. |
| Electron desktop startup/preflight | Passed | Windows quality Electron non-interactive preflight passed. |
| Windows unpacked package build | Passed | Windows packaging run produced the x64 unpacked application successfully. |
| Package-content privacy inspection | Passed | Unpacked and final package inspection passed. |
| Packaged launch/restart | Passed | Packaged application launched and restarted successfully. |
| NSIS installer build | Passed | Windows x64 NSIS installer built successfully. |
| Installer execution / uninstall preservation | Passed | Installed app launched; uninstall completed while preserving per-user application/workspace data. |
| Verified artifact manifest / upload | Passed | Manifest generation and installer artifact upload completed successfully. |
| Live local Ollama structured task | Unavailable | Deterministic CI does not assume a live local Ollama/model; provider/runtime and structured-contract behaviour remains covered with deterministic tests. |
| Manual Light/Dark/System visual review | Unavailable | Requires human desktop review; automated theme/accessibility contract tests remain part of the suite. |
| Manual arbitrary-size performance profiling | Skipped | v0.1.0 validates bounded foundation behaviour only; no untested scale claim is made. |

## Release boundaries

The release preserves the following non-negotiable properties:

- no unrestricted renderer Node.js/filesystem/shell/network access;
- no raw credential exposure to renderer or ordinary state;
- local-only Ollama provider boundary for v0.1.0;
- application-side validation of model output and current references;
- creator media stored locally outside install/source trees and source media never destructively altered;
- diagnostics exclude credentials, prompts/responses and private creator content;
- no telemetry, analytics, cloud AI, social APIs, publishing, scheduling or Autopilot capability;
- mutable project/media/settings/credential/diagnostic data remains outside packaged application resources;
- uninstall does not casually delete creator/application data.

## Known limitations

The v0.1.0 Windows installer is unsigned. Ollama/models are not bundled or downloaded. Windows x64 is the verified packaging target. A live local-model execution and manual full-theme visual review are not represented as automated CI passes. Social account connection, publishing, trends, analytics, scheduling, full media intelligence, Content Studio and Autopilot remain future work.
