# SwayForge v0.2.1 release verification

This document records release verification for #131 under release umbrella #132. v0.2.1 is a focused maintenance release for GitHub Project Board Automation; it does not add Content Studio or social publishing behavior.

## Release identity

`package.json` is the authoritative application version and is set to **0.2.1**. Electron and Windows artifact naming derive from that version.

v0.2.1 changes no dependencies. The existing `package-lock.json` therefore remains the known-good dependency snapshot. Repository security checks still require its package name, dependency maps and engine metadata to match `package.json`.

## Implemented scope

- canonical `Idea → Backlog → Planned → In Progress → Review → Done` development lifecycle;
- complete-roadmap Project reconciliation from Issue #1 plus Issue/Git lifecycle state;
- Priority, Complexity, Status, Type, Target Release, Area, actual Branch, Start Date and genuine Target Date synchronization;
- full-board, focused-Issue and dry-run/audit modes;
- dynamic Projects v2 field/option lookup rather than hard-coded field IDs;
- idempotent Project item reuse/addition and batched field updates;
- protected automatic Issue-event and daily reconciliation workflow;
- one-time setup documentation for Project owner/type/number and protected Project credential.

## Security and authority findings

The implementation preserves these boundaries:

- no Project credential is committed to the repository, Issue, PR or diagnostic output;
- Project API calls use the protected `SWAYFORGE_PROJECT_TOKEN` secret;
- ordinary repository Issue/Index reads use GitHub's short-lived built-in workflow token;
- the secret-bearing Project workflow has no pull-request trigger;
- automatic runs use trusted default-branch implementation code;
- normal CI remains read-only and continues to reject unexpected workflow write permissions/secrets;
- no telemetry, behavioral tracking or remote crash reporting is added;
- no cloud AI or cloud creator-media processing is added;
- no social publishing/provider network authority is added;
- Project state cannot merge pull requests, publish GitHub Releases, publish social content or grant application Autopilot authority;
- planned work cannot receive a fabricated actual Branch or Start Date;
- unknown Target Dates remain blank rather than being invented.

## Required final verification matrix

Before #131 and #132 move to Review, the current draft PR head must record:

| Check | Required status |
| --- | --- |
| Clean locked dependency install | Passed |
| Complete `npm test` on Linux | Passed |
| Complete `npm test` on Windows | Passed |
| `npm run check` | Passed |
| Privacy guard | Passed |
| Security/source policy | Passed |
| Workflow policy | Passed |
| Lint/static checks | Passed |
| `git diff --check` | Passed |
| Git/PR conventions | Passed |
| Electron Windows preflight | Passed |
| Windows unpacked x64 build | Passed |
| Package-content privacy inspection | Passed |
| Packaged launch/restart | Passed |
| NSIS installer build | Passed |
| Install/launch/uninstall data preservation | Passed |

Exact workflow run results belong in the final PR handoff. No incomplete or unavailable check is called Passed.

## Project synchronization scenarios

Deterministic tests cover the important application behavior around Project API output and metadata:

1. parse existing Issue conventions for Priority, Complexity, Area, Type and Target Release;
2. distinguish Idea, Backlog, Planned, In Progress, Review and Done;
3. prevent planned work from gaining a nonexistent actual branch/start date;
4. read actual branch/start data once work is active;
5. preserve GitHub closed/completed authority over stale Review metadata;
6. treat closed `not_planned` work conservatively rather than Done;
7. parse canonical Index roadmap rows for full-board reconciliation;
8. resolve named single-select options to Project option IDs;
9. explicitly clear authoritative stale branch/date values when required;
10. fail visibly when required Project fields/options/configuration are missing;
11. redact Project-token-like values from API failure text;
12. preserve package/dependency consistency while v0.2.1 remains a no-dependency maintenance release.

## One-time live Project setup

The connected development assistant cannot directly write the user-owned GitHub Project. After merge, the repository therefore requires:

- `SWAYFORGE_PROJECT_OWNER` repository variable;
- `SWAYFORGE_PROJECT_OWNER_TYPE` repository variable;
- `SWAYFORGE_PROJECT_NUMBER` repository variable;
- `SWAYFORGE_PROJECT_TOKEN` protected Actions secret.

The credential value must never be pasted into chat, source, Issues or PRs. See `docs/project-board-setup.md`.

The first real full-board backfill cannot truthfully be marked Passed until that protected setup exists and the workflow successfully runs against the live Project.

## Known limitations

- Live Project mutation cannot be exercised in ordinary PR CI because the protected Project credential is intentionally unavailable there.
- Target Dates remain blank for genuinely unscheduled future work.
- The Project is a synchronized visual control room; GitHub Issues/Index and verified Git/PR state remain the written development authority.
- Windows x64 remains the verified packaging target and the installer remains unsigned.
- Existing v0.2.0 Media Intelligence limitations remain unchanged.
- Content Studio, social publishing, trends, analytics, scheduling/campaigns and Autopilot remain future product work.

## Uninstall and application data

v0.2.1 does not change application data storage, creator-media handling or uninstall behavior. Existing packaging verification must continue to confirm uninstall does not silently delete per-user Sway Forge data.