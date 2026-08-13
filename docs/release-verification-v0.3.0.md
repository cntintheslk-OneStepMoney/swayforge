# SwayForge v0.3.0 release verification

This document records release verification for Issue #33 under the v0.3.0 release umbrella #23, integrating Issues #24–#32. v0.3.0 is the first Content Studio release. It remains local-first and does not introduce social publishing authority.

## Release identity

`package.json` is the authoritative application version and is set to **0.3.0**. Electron/About surfaces and Windows artifact naming derive from that value.

v0.3.0 adds no npm dependencies. The existing lockfile therefore remains the known-good dependency snapshot; repository checks require package name, dependency maps and engine metadata to remain consistent even when its historical root version is not cosmetically rewritten.

## Implemented scope

- versioned local content projects and creative briefs with optimistic revision protection;
- optional local-AI ideas, hooks, scripts, captions, rewrites and critiques that remain proposals until accepted;
- AI-assisted and manual storyboards constrained to approved local media IDs;
- a non-destructive editable timeline with trim, split, replace, reorder, still-duration, undo/redo and keyboard alternatives;
- deterministic local FFmpeg rendering from trusted structured render plans;
- timed subtitles, hooks, titles and labels using controlled text/style/placement data;
- local imported audio and voiceover foundations with explicit rights provenance and bounded mixing controls;
- local cover/thumbnail creation and staged PNG export;
- deterministic 9:16, 1:1 and 16:9 local export variants with safe destinations and provenance records.

## Security, privacy and authority findings

The release preserves these boundaries:

- no telemetry, behavioural analytics or remote crash reporting;
- no cloud AI, cloud rendering or cloud creator-media upload;
- no social publishing, OAuth, scheduling or live platform network authority;
- no automatic trending-audio download and no background microphone capture;
- source media remains authoritative and is never destructively modified by timeline, render, cover or export operations;
- FFmpeg/ffprobe are invoked from trusted code using structured argument arrays and `shell:false`; renderer/model text cannot supply raw shell commands or arbitrary FFmpeg flags;
- render output is staged, probed, checksummed and only then promoted to completed output;
- cancellation and failure clean staging state without overwriting prior completed derivatives;
- diagnostics exclude creator content, prompts/responses, media paths and credentials;
- no credential, OAuth token, API key, Project token or signing material is committed by this release.

## Content Studio release scenarios

The synthetic local release regression explicitly covers all 15 required Issue #33 scenarios:

1. create and validate a local content project and creative brief;
2. generate optional local-AI writing, accept it, then preserve a subsequent user edit;
3. create, accept and user-edit a storyboard constrained to approved media;
4. convert the accepted storyboard to a deterministic timeline;
5. split/trim video content safely;
6. change still duration and reorder timeline content;
7. add timed text/subtitle data;
8. add local voiceover/audio with explicit rights state;
9. create and export a local cover derivative;
10. render a verified vertical 9:16 video derivative;
11. create a separate profile-shaped variant and export provenance record;
12. cancel a render without deleting prior completed output or leaving a false completed result;
13. reload project state and continue from the stored revision;
14. create a manual Content Studio project/timeline when Ollama is unavailable;
15. resolve packaged Windows FFmpeg/ffprobe paths deterministically.

The same regression verifies source image/video hashes remain unchanged across the complete workflow.

## Required verification matrix

The draft PR for Issue #33 must not move to Review until its current head reports the following truthfully. GitHub Actions on the exact PR head is the canonical automated record.

| Check | Required result |
| --- | --- |
| Clean locked dependency install | Passed |
| Complete `npm test` on Linux | Passed |
| Complete `npm test` on Windows | Passed |
| v0.3.0 15-scenario Content Studio release regression | Passed |
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

A failed, skipped or unavailable check is never represented as Passed. Manual packaged interaction remains a separate user/reviewer validation when CI cannot substitute for real-world interaction.

## FFmpeg distribution and licensing boundary

CI installs an FFmpeg test tool so deterministic render tests can execute on Linux and Windows. Sway Forge does not silently download a production FFmpeg binary. Runtime resolution supports an explicitly packaged, user/configured or system-path FFmpeg/ffprobe pair.

Any future bundled production binary requires an explicit build/source/licensing and redistribution review before inclusion. The application does not accept raw model/user FFmpeg flags or arbitrary network media inputs.

## Known limitations

- Windows x64 is the verified packaging target and the installer remains unsigned.
- Timed text uses controlled presets rather than arbitrary fonts/CSS/filtergraphs.
- Audio is a local imported/voiceover foundation rather than a full DAW or trending-audio acquisition system.
- Export variants express planning intent only and do not claim connected accounts or verified live-platform compatibility.
- Ollama is optional and separately installed/configured; manual Content Studio workflows remain available without it.
- Live Project mutation is intentionally unavailable in ordinary PR CI because its protected Project credential is not exposed there.
- Social publishing, OAuth, scheduling, trend intelligence, analytics/learning, campaigns and Autopilot are outside v0.3.0.

## Uninstall and application data

Windows packaging verification must continue to confirm that install, launch and uninstall do not silently delete the per-user Sway Forge data directory. Creator source media and application/project state remain separate from the installed application, and generated derivatives never become the sole authoritative copy of creator media.
