# Sway Forge v0.2.1

## Project Board Automation

v0.2.1 is a focused maintenance release that makes the GitHub Project the live development control room for Sway Forge.

Planned release scope:

- complete Project board backfill for existing roadmap Issues;
- canonical `Idea -> Backlog -> Planned -> In Progress -> Review -> Done` lifecycle;
- synchronization of Priority, Complexity, Type, Target Release, Area, actual Branch, Start Date and Target Date;
- idempotent Projects v2 sync tooling;
- manual full-board reconciliation workflow;
- lifecycle-triggered synchronization where GitHub event permissions allow;
- safe secret-based Project authentication without committed credentials;
- documentation/tests for missing fields, dry-run behaviour and safe failure.

This release does not add Content Studio functionality and does not change publishing, AI, media or user-data authority.
