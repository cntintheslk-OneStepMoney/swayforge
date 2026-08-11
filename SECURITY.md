# Security policy

SwayForge is a local-first creator application. Security reports should protect the user data involved in the report as carefully as the application itself.

## Reporting a vulnerability

Do not post credentials, OAuth tokens, session data, private creator media, unpublished content, raw diagnostics, private keys, account exports, or other sensitive material in a public GitHub Issue.

Use GitHub private vulnerability reporting when it is enabled for this repository. If private vulnerability reporting is unavailable, contact the repository owner through a non-public channel and share only the minimum information needed to reproduce the issue. A public Issue may be opened with a sanitised description that contains no secrets or private creator content.

When reporting a security issue:

- describe the affected SwayForge version or commit and operating system;
- explain the security boundary that can be crossed;
- provide minimal synthetic reproduction steps where practical;
- replace real tokens, paths, account identifiers, media and diagnostics with synthetic values;
- state whether any external action, data loss or credential exposure actually occurred;
- do not upload a credential store, user database or creator-media archive as evidence.

## Repository security baseline

The v0.1.0 repository must not contain real creator media, OAuth credentials, API keys, session exports, runtime databases, diagnostic exports, private signing material, telemetry, cloud AI credentials or privileged CI secrets.

Normal CI uses read-only repository permissions and synthetic data only. Live Ollama, social-platform accounts and production credentials are not test dependencies.

## Credential exposure

If a real credential is accidentally committed or published, treat the credential as compromised. Revoke or rotate it through the issuing service before repository cleanup. Removing a secret from the latest file alone does not make an already-published credential safe.

Do not rewrite shared Git history or force-push as an ad-hoc response without an explicitly agreed incident-recovery plan.
