# SwayForge v0.1.0 release verification

This document records the release-integration verification for Issue #13. It distinguishes inherited upstream evidence from checks executed on the final release branch and never treats an unavailable check as passed.

## Integrated workstreams

Accepted v0.1.0 foundations: #3 application shell, #4 local storage/projects, #5 credential boundary, #6 Ollama runtime, #7 structured AI contracts, #8 media foundation, #9 navigation/design system, #10 settings/diagnostics, #11 quality/CI, and #12 Windows packaging.

Issue #12 was accepted through its dependency branch rather than landing directly on `main`; Issue #13 deliberately integrates that reviewed packaging tree on top of the current `main` release base.

## Upstream verification evidence

- #11 final Linux and Windows quality runs passed clean `npm ci`, the complete automated test suite, canonical project/privacy/security/workflow checks, lint/static checks, Windows path/storage coverage and Electron preflight.
- #12 final Windows packaging run passed clean `npm ci`, complete tests/check/lint, unpacked Windows x64 build, package-content privacy inspection, packaged launch/restart, NSIS installer build, installed launch, uninstall and preservation of per-user workspace data.
- #12 Git-conventions validation passed on its final reviewed head.

These results are inherited evidence only. The final Issue #13 pull request must rerun the repository checks against the actual integrated release tree before Review is considered complete.

## Release-branch verification matrix

| Check | Status | Evidence / reason |
| --- | --- | --- |
| Clean `npm ci` | Pending | Final release PR CI not yet recorded. |
| Complete `npm test` | Pending | Final release PR CI not yet recorded. |
| `npm run check` | Pending | Includes project, privacy, security, workflow and package policy gates. |
| `npm run lint` | Pending | Final release PR CI not yet recorded. |
| `git diff --check` | Pending | Final release PR CI not yet recorded. |
| Electron desktop startup/preflight | Pending | Final release PR CI not yet recorded. |
| Windows unpacked package build | Pending | Final release PR packaging workflow not yet recorded. |
| Package-content privacy inspection | Pending | Final release PR packaging workflow not yet recorded. |
| Packaged launch/restart | Pending | Final release PR packaging workflow not yet recorded. |
| NSIS installer build | Pending | Final release PR packaging workflow not yet recorded. |
| Installer execution / uninstall preservation | Pending | Final release PR packaging workflow not yet recorded. |
| Live local Ollama structured task | Unavailable | No live local Ollama runtime is assumed by deterministic CI; runtime and contract tests remain deterministic. |
| Manual Light/Dark/System visual review | Unavailable | Requires human desktop review; automated theme/accessibility contract tests remain part of the suite. |
| Manual arbitrary-size performance profiling | Skipped | v0.1.0 validates bounded foundation behaviour only; no untested scale claim is made. |

## Release boundaries

The release must preserve the following non-negotiable properties:

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

The v0.1.0 Windows installer is unsigned. Ollama/models are not bundled or downloaded. Windows x64 is the verified packaging target. Social account connection, publishing, trends, analytics, scheduling, full media intelligence, Content Studio and Autopilot remain future work.
