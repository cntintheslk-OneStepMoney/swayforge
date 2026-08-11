# Contributing

Thank you for improving SwayForge.

## Before opening a pull request

Run the strongest checks available for the work you changed and report unavailable environment-dependent checks accurately. At minimum for the current foundation:

```sh
npm ci
npm test
npm run check
npm run lint
git diff --check
```

Focused gates are also available:

```sh
npm run check:privacy
npm run check:security
npm run check:workflow
npm run test:smoke
```

Never commit creator media, OAuth tokens, API keys, client secrets, session cookies, protected credential stores, `.env` files, private diagnostics, or realistic private account data. Keep AI and creator media local where practical; do not introduce third-party uploads, telemetry, analytics, remote logging, social publishing side effects, or cloud AI unless the relevant Issue explicitly requires and approves them.

### Test fixtures and local test state

- Use synthetic, generated or clearly redistribution-safe fixtures only.
- Never copy a real social account export, creator clip, credential store, diagnostic export or scraped platform payload into tests.
- Prefer temporary directories under the operating-system temp location for storage/media integration tests and clean them after each test.
- If a token-shaped or media fixture is genuinely required, allowlist its exact test path rather than weakening a file class or secret rule globally.
- Live Ollama and live social APIs must remain optional environment-specific verification, not hidden dependencies of deterministic tests.
- Record verification as Passed, Failed, Skipped or Unavailable truthfully. Do not convert an unavailable environment check into a pass.

## Git and GitHub conventions

SwayForge uses the same Git and GitHub naming/documentation scheme as OneStep Money so repository history stays easy to audit.

### Git safety

- Never commit, push, merge or otherwise write directly to `main`.
- Start work from the current `main` on a descriptive non-main branch.
- Never rewrite shared history, force-push, delete remote branches or merge a PR without explicit approval.
- Keep commits focused and avoid unrelated edits.
- Open implementation pull requests as drafts and leave them unmerged for user review.

### Branch names

Use the branch family appropriate to the work, without normal release/version numbers in the branch name, for example:

- `feature/local-ai-runtime`
- `fix/ollama-remote-model-guard`
- `ui/application-foundation`
- `security/credential-boundary`
- `maintenance/repository-conventions`

### Commit titles

Every new non-merge commit uses:

`[Release][Type] Concise title`

Allowed release prefixes:

- `[vX.Y.Z]` for work assigned to a release.
- `[Unscheduled]` for accepted work without a target release.
- `[Historical]` or `[Superseded]` only when those labels are factually accurate.

Allowed Types:

- `Feature`
- `Bug`
- `UI/UX`
- `Security`
- `QOL`
- `Maintenance`

Examples:

- `[v0.1.0][Feature] Add structured AI response contracts`
- `[v0.1.0][Security] Harden protected credential storage`
- `[Unscheduled][Maintenance] Standardise repository conventions`

Do not use mixed free-form styles such as `Add ...`, `feat:`, `fix:`, `test:` or `chore:` for new commits.

### Commit body

Use a short factual body in this order:

```text
Purpose: Why this commit exists.
Changes: What changed in this commit.
Verification: Tests/checks run, or why verification is unavailable.
Issue: #NN
```

Use `Issue: N/A` only when there is genuinely no Issue. The commit body does not replace the full PR description.

### Pull request titles

Normal PRs use:

`[vX.Y.Z][Type] Concise title`

Accepted work without a target release uses:

`[Unscheduled][Type] Concise title`

Historical exceptions may use `[Historical][Maintenance]` or `[Superseded][Type]` only when accurate.

### Pull request description

Every implementation PR must contain these sections:

1. Purpose
2. Work completed
3. Files changed
4. User-facing changes
5. Technical changes
6. Testing and verification
7. Data and migration impact
8. Known limitations
9. Excluded work
10. Branch details — Branch, Commit SHA, Pull request, Target branch `main`
11. Confirmations

The Confirmations section must state that nothing was committed/pushed directly to `main`, the workflow did not merge the PR, no creator media/credentials/secrets/sensitive logs were committed, and only relevant files changed.

### Merge naming

Published history is immutable. Do not rewrite older commit names just to make them match the current convention.

For future merges, preserve the approved PR title as the merge commit title when the GitHub merge UI permits an override, and use the PR summary/body as the merge message. This keeps top-level `main` history aligned with the same `[Release][Type]` scheme while retaining branch history.

### Historical note

The complete published SwayForge history was audited when Issue #111 introduced this convention. Earlier commits include Conventional Commit-style messages (`feat:`, `chore:`), free-form imperative messages such as `Add ...`, and merge/PR titles using an unbracketed `v0.1.0 ...` form. Those commits remain unchanged because renaming them would rewrite published SHAs. The canonical convention above applies from Issue #111 onward.
