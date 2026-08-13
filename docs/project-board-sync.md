# Sway Forge Project Board Synchronization

## Purpose

The GitHub Project is the live visual control room for Sway Forge development. It must let the user see, at a glance, what is an idea, what is backlogged, what is planned, what is underway, what is awaiting review, and what is complete.

GitHub Issues remain the detailed implementation contracts. The Project mirrors the canonical planning metadata and lifecycle so routine bookkeeping does not require manual board editing.

## Canonical lifecycle

`Idea -> Backlog -> Planned -> In Progress -> Review -> Done`

- **Idea**: captured but not yet triaged into an implementation-ready brief.
- **Backlog**: accepted work, not yet assigned to an active release plan.
- **Planned**: implementation-ready and assigned to a release/dependency position.
- **In Progress**: development has actually begun.
- **Review**: implementation/testing are complete, branch pushed, and draft PR is ready for user review.
- **Done**: the user has reviewed and merged the PR and the merge is verified.

## Project fields

The board should contain and synchronize:

1. Priority
2. Complexity
3. Title
4. Status
5. Type
6. Target Release
7. Area
8. Branch
9. Start Date
10. Target Date

### Priority

Allowed values: `Critical`, `High`, `Medium`, `Low`.

### Complexity

Allowed values: `Small`, `Medium`, `Large`.

### Type

Allowed values: `Feature`, `Bug`, `UI/UX`, `Security`, `QOL`, `Maintenance` where applicable. Release umbrellas and the Index may remain blank.

### Target Release

Use the release assignment recorded in the authoritative Issue/Index, such as `v0.3.0`.

### Area

Use the concise functional area recorded by the work brief, for example `Content Studio / Timeline / UI/UX`.

### Branch

This field represents the **actual implementation branch**. It is intentionally blank until the branch exists. Planned branch names remain visible in the Issue and Index before commencement. This avoids showing a branch as real before it has been created.

If the board later needs planned branch visibility before commencement, add a distinct `Planned Branch` text field rather than overloading `Branch`.

### Start Date

Populate only with the actual date development begins. Never pre-populate planned work with a fictional start date.

### Target Date

Target Date is a real planning commitment, not filler. It should be populated when a task/release has genuinely been scheduled. The sync must not invent dates solely to make cells non-empty.

Target dates may be derived from an explicitly approved release schedule once such a schedule exists.

## Authority model

The synchronization process must not infer permissions or external side effects from Project state.

- Issue/Index planning metadata is authoritative for Priority, Complexity, Type, Target Release, Area and planned lifecycle state.
- Git/PR state is authoritative for actual Branch, review readiness and merge completion.
- Actual commencement is authoritative for Start Date.
- An explicit release schedule is authoritative for Target Date.
- Project fields are a synchronized visual representation.

## Automatic transitions

### Idea / Backlog / Planned

These are planning transitions and should follow the canonical Issue/Index metadata.

### Planned -> In Progress

Only after commencement:

1. dependencies checked;
2. latest `origin/main` confirmed;
3. dedicated non-main branch created;
4. Issue and Index marked In Progress;
5. Project Status set to In Progress;
6. actual Branch and Start Date populated.

### In Progress -> Review

Only after:

- implementation is complete;
- required tests/checks are run;
- focused changes committed/pushed;
- draft PR is ready.

Then set Project Status to Review.

### Review -> Done

Only after the user merges the PR and the merge is verified. Then close/complete the Issue, update the Index and set Project Status to Done.

The automation must never merge a PR merely to advance Project state.

## Synchronization design

Implement an idempotent repository script and GitHub Actions workflow that:

- locates the configured GitHub Project;
- discovers Project field IDs/options dynamically by field name;
- ensures repository Issues are represented in the Project where appropriate;
- reads canonical metadata from Issue bodies and/or the Development Index;
- updates Priority, Complexity, Status, Type, Target Release, Area, Branch, Start Date and Target Date;
- can perform a full reconciliation/backfill of the whole board;
- can perform focused reconciliation after issue/PR lifecycle events;
- does not clear legitimate data merely because a field is temporarily unavailable;
- produces a clear dry-run/audit result;
- fails safely if fields/options are missing or renamed;
- never logs tokens or private credentials.

## Authentication

GitHub's repository-scoped `GITHUB_TOKEN` cannot access Projects. For a user-owned Project, use a repository secret containing a personal access token with the required Project access. For an organization-owned Project, a GitHub App with organization Projects read/write permission is preferred.

Credentials must be stored only in GitHub Actions Secrets and never committed to the repository or pasted into source/configuration.

## Required repository configuration

The workflow should consume configuration rather than hard-code private credentials:

- `SWAYFORGE_PROJECT_OWNER` — owner/login of the Project.
- `SWAYFORGE_PROJECT_NUMBER` — Project number from its GitHub URL.
- `SWAYFORGE_PROJECT_OWNER_TYPE` — `user` or `organization` if automatic detection is not reliable.
- `SWAYFORGE_PROJECT_TOKEN` — Actions secret used only for Project API access when required.

Non-secret values should be repository variables where practical; token material must be a secret.

## Full-board backfill

A manually dispatchable reconciliation must be able to populate the existing roadmap, including completed historical work and planned future work, using the canonical metadata already stored in #1 and individual Issues.

Backfill must preserve the distinction between:

- planned branch name vs actual branch;
- planned work vs actual start date;
- a real target date vs an unscheduled task.

## Future autonomous development

This system is intended to support increasingly automated release-train development while retaining user control.

For a future release cycle, the user should be able to inspect the Project and see:

- current release scope;
- dependencies and order;
- active work;
- review queue;
- completed work;
- backlog/ideas outside the current release;
- target dates where genuinely scheduled.

Autonomous development must still obey Sway Forge's branch, test, safety, approval and no-merge rules unless the user explicitly changes them.
