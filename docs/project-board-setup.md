# Sway Forge Project Board — One-time setup

Once v0.2.1 is merged, Project bookkeeping is designed to run automatically. The only unavoidable manual setup is giving GitHub Actions protected access to the user-owned GitHub Project.

## 1. Get the Project number

Open the Sway Forge GitHub Project and read the number from its URL.

For a URL shaped like:

`https://github.com/users/<owner>/projects/<number>`

use the final numeric value as `SWAYFORGE_PROJECT_NUMBER`.

Do not guess the number.

## 2. Add repository variables

In the `swayforge` repository, open:

**Settings → Secrets and variables → Actions → Variables**

Create:

- `SWAYFORGE_PROJECT_OWNER` = `cntintheslk-OneStepMoney`
- `SWAYFORGE_PROJECT_OWNER_TYPE` = `user`
- `SWAYFORGE_PROJECT_NUMBER` = the Project number from step 1

These values are configuration, not credentials.

## 3. Create a Project-only classic personal access token

For the current GitHub Projects v2 REST API, user-owned Project endpoints require a classic personal access token rather than the repository GitHub App/fine-grained token path.

Create a classic PAT with the minimum required **`project`** scope for read/write Project access.

The v0.2.1 workflow deliberately uses the built-in short-lived `GITHUB_TOKEN` for repository Issue/Index reads, so the long-lived Project token does not need to be used for ordinary repository reads.

Do not paste this token into an Issue, PR, repository file, diagnostic log or ChatGPT conversation.

## 4. Store the token as an Actions secret

In the `swayforge` repository, open:

**Settings → Secrets and variables → Actions → Secrets**

Create this repository secret:

- Name: `SWAYFORGE_PROJECT_TOKEN`
- Value: the classic PAT from step 3

The value is supplied to the dedicated Project synchronization workflow only and is never written to source.

## 5. Automatic first reconciliation

After v0.2.1 is merged and the variables/secret exist, the next supported Issue lifecycle event triggers a **full Project reconciliation**. The workflow also runs a full reconciliation daily.

A manual **Project board sync** workflow dispatch is available for an immediate full run or dry run if desired, but routine bookkeeping should not require it.

## What gets synchronized

For eligible Sway Forge Issues, the Project is reconciled from the canonical Development Index and Issue/Git state:

- Priority
- Complexity
- Status
- Type
- Target Release
- Area
- actual Branch
- actual Start Date
- Target Date when genuinely scheduled

The lifecycle is:

`Idea → Backlog → Planned → In Progress → Review → Done`

Unknown dates are kept blank instead of being fabricated. `Branch` stays blank until a branch actually exists.

## Safety boundary

The Project is a visibility/planning surface. Project state cannot merge PRs, publish releases, publish social content, grant Autopilot authority or bypass user approval.

The existing Sway Forge Issue/branch/draft-PR/user-merge rules remain authoritative.
