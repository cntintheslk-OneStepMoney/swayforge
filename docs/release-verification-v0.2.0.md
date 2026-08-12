# SwayForge v0.2.0 release verification

This document records the release-integration verification for Issue #22. It separates inherited upstream evidence from final release-branch checks and never treats an unavailable/manual check as passed.

## Integrated workstreams

Accepted v0.2.0 scope integrated into the release branch:

- #15 Media Library browsing and selection workspace — merged via PR #121.
- #16 thumbnail/preview pipeline — merged via PR #122.
- #17 metadata index and local search substrate — merged via PR #123.
- #18 perceptual similarity and near-duplicate evidence — merged via PR #124.
- #19 local AI image/video understanding — merged via PR #125.
- #20 tags, collections, saved views and media organisation — merged via PR #128.
- #21 media integrity, exact-content recovery and safe derived cleanup — merged via PR #129.
- #126 application branding and logo integration — merged via PR #127.

The final #22 branch starts from `main` after #21 merged, so the release candidate contains the reviewed upstream work through ordinary repository merges rather than inventing a parallel media implementation.

## Authority and integration findings

The integrated release keeps one clear authority chain:

- #8 managed-media records remain authoritative for media ID, managed reference, file size and SHA-256 exact content identity.
- Preview artifacts are disposable derivatives addressed through an opaque renderer protocol.
- The search index is a rebuildable read-model derived from authoritative media/project/user-organisation data.
- Perceptual fingerprints are evidence only. `exact-duplicate`, `highly-similar` and `related` remain separate categories.
- Local-AI analysis is versioned, optional and derived; it cannot overwrite user-authored tags/collections.
- User tags, collections and saved views remain authoritative organisation persisted through the normal revision-protected workspace store.
- Integrity health is derived by verifying authoritative media/filesystem state; it does not replace the media record.

No second authoritative media store or duplicate release-only service was introduced by #22.

## Inherited upstream evidence

The individual reviewed feature branches already supplied focused and full-gate evidence before merge:

- #15: 13/13 focused Media Library tests plus green Linux/Windows quality and Windows packaging.
- #16: 15/15 focused preview/cache/security tests; final full suite reported 176/176 and green Windows package/install verification.
- #17: 11/11 focused index tests including a 5,000-record bounded search/performance guard, plus green release gates.
- #18: 15/15 similarity/integration tests including a 5,000-item candidate-bound scenario and green Windows packaging.
- #19: 14/14 local media-understanding tests plus green Linux/Windows quality and packaging; live compatible Ollama vision execution remained unavailable in CI.
- #20: 9/9 organisation/search/persistence, 6/6 renderer/model organisation and 2/2 storage/migration smoke tests plus green Linux/Windows/package gates.
- #21: 15/15 focused integrity service tests, additional renderer/main boundary coverage, green Linux/Windows quality/privacy and green Windows packaging.
- #126: complete automated suite reported 224/224 plus green branding/package checks.

Inherited evidence is useful context only; #22 still requires its own final PR checks before Review.

## Release metadata

`package.json` is the authoritative application version and is set to **0.2.0**. The package-lock root metadata is synchronised to the same value without changing dependency pins. Electron About/version reporting and electron-builder artifact names derive from the package version. README and `CHANGELOG.md` identify v0.2.0 consistently.

The connector environment cannot patch a large lockfile safely in-place, so the branch used a one-shot GitHub Actions helper to parse the intact lock JSON, update only its two root version fields, delete the temporary workflow and commit the regenerated lockfile. The temporary workflow is absent from the final tree; normal CI remains read-only.

## Required final release-branch verification matrix

The draft PR for #22 is the authoritative final execution surface. Before Issue #22 moves to Review, the current PR head must record:

| Check | Required status | Notes |
| --- | --- | --- |
| Clean locked dependency install | Passed | Linux/Windows quality and Windows packaging. |
| Complete `npm test` | Passed | Includes Media Intelligence feature and release regression suites. |
| `npm run check` | Passed | Project, privacy, security, workflow and package policy. |
| `npm run lint` | Passed | Linux/Windows/package jobs. |
| `git diff --check` | Passed | No whitespace errors. |
| Git/PR conventions | Passed | Release branch and PR metadata comply with repository conventions. |
| Electron non-interactive startup/preflight | Passed | Windows quality job. |
| Windows unpacked x64 build | Passed | Packaging job. |
| Package-content privacy inspection | Passed | No creator media/state/secrets/cache in package. |
| Packaged launch/restart | Passed | Windows packaging job. |
| NSIS installer build | Passed | Versioned v0.2.0 artifact naming. |
| Install/launch/uninstall data preservation | Passed | Per-user application data remains preserved. |
| Live compatible Ollama vision-model media analysis | Unavailable unless a legitimate local runtime/model is present | Deterministic fake/contract coverage remains required; unavailable cannot be called Passed. |
| Physical file-picker recovery click-through | Unavailable in automated CI | Deterministic repair service + main/renderer boundary tests cover behaviour; human review may exercise it. |
| Manual Light/Dark/System visual review | Unavailable in connector CI | Automated theme/layout/accessibility assertions remain required. |

Exact final workflow run IDs/results are recorded in the #22 draft PR review handoff after the final head has completed CI.

## End-to-end release scenarios

The combined automated suites cover the release flow in deterministic pieces using synthetic/redistribution-safe files:

1. import supported image/video media and preserve source files;
2. generate/reuse local previews and renderer-safe artifact URLs;
3. build/search/rebuild the local metadata index;
4. classify exact duplicates separately from perceptual similarity;
5. run optional local AI analysis through schema/capability boundaries or surface unavailable state safely;
6. persist tags/collections/saved views and explicitly accept/dismiss AI suggestions;
7. detect missing/changed/corrupt managed media;
8. restore an existing media identity only for exact matching content;
9. rebuild derived preview/index/similarity/AI systems without deleting authoritative/user-authored state;
10. keep index/similarity candidate work bounded for low-thousands synthetic libraries.

## Privacy and security audit

The release preserves these boundaries:

- no telemetry, behavioural tracking or remote crash reporting;
- no cloud AI or cloud media storage/processing;
- no social publishing/provider network path in v0.2.0;
- no arbitrary renderer filesystem/database/shell access;
- creator media paths/content and AI prompt/response payloads remain out of ordinary diagnostics;
- exact recovery uses a trusted file picker and rejects different content as replacement identity;
- filenames do not become shell commands or trusted process arguments;
- media-derived caches remain disposable and never become the sole source of creator/user-authored data;
- package policy excludes creator media, runtime state, credentials and rebuildable caches from distributable artifacts;
- uninstall remains non-destructive to per-user application/workspace data.

## Known limitations

- Managed-copy media is the only current storage mode. Referenced external-source relink cannot be exercised yet.
- Video AI analysis uses representative frames and does not analyse audio.
- Perceptual dHash similarity is not content identity and has known crop/overlay/low-detail limitations.
- The current local index is a rebuildable JSON read-model aimed at low-thousands libraries.
- Hard managed-source deletion/library-record removal is intentionally deferred.
- Windows x64 is the verified packaging target and the installer remains unsigned.
- Live local Ollama vision execution, physical file-picker click-through and full manual theme visual review are not claimed by deterministic CI.
- Content Studio, social publishing, trends, analytics, scheduling/campaigns and Autopilot remain future releases.
