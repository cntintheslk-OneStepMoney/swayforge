# Protected credential storage

SwayForge keeps OAuth-style credential material in a dedicated trusted-process store that is separate from ordinary application/project JSON.

## Protection mechanism

The store uses Electron `safeStorage` after Electron is ready. Async `safeStorage` capability/encrypt/decrypt APIs are preferred when available. The store never writes a plaintext fallback. A Linux `basic_text` backend is treated as unavailable rather than as secure storage.

Credential data is written under the per-user Electron `userData` area in a dedicated `credentials` directory, outside the application/source tree. The persisted document contains only non-secret metadata plus the protected bytes encoded as base64 for JSON transport. Base64 is not treated as protection; the protection comes from the OS-backed `safeStorage` encryption step.

If protected storage is unavailable or fails to initialise, credential writes and reads fail closed. The rest of the non-secret SwayForge workspace remains usable.

## Trust boundary

Only trusted main-process/service code can create, replace, decrypt or delete a secret. The preload/renderer bridge exposes only a bounded secret-storage capability/status query. It does not expose `getSecret`, token values, protected payloads, encryption keys or a generic credential API.

Future social-provider adapters should run in trusted application code and resolve an opaque credential ID through the protected store only for the typed provider operation that needs it.

## Record and rotation contract

Secret records contain an opaque UUID, provider key, optional opaque account reference, secret kind, timestamps/optional expiry metadata, and a protected payload. Display usernames/profile data belong in normal account metadata, not this store.

Writes replace the whole credential document through a staged, flushed, previous-generation and verified commit. Replacement encrypts the new value before the old record is moved, and restores the previous generation if the file commit is interrupted. Where a provider rotates access and refresh tokens together, later adapters may store both inside one protected `credential-bundle` so the pair is replaced as one protected record.

Deletion is explicit, target-scoped and idempotent. Removing a credential does not remove project/media state. The v0.1.0 store does not claim secure erase of storage media and is not included in ordinary backup/export.

## Desktop OAuth client-secret constraint

A distributed desktop application cannot assume a provider-issued static client secret can be kept genuinely secret merely by placing it in source code, environment files, JavaScript bundles or an ASAR. SwayForge therefore does not ship a production client secret in this foundation.

Every future provider integration must document whether it is a public-client/PKCE flow, whether the provider truly requires a client secret, and how that requirement can be satisfied without pretending an embedded package value is secret. User-issued access/refresh credentials remain a separate data class from application-registration configuration.

## Schema and migration

The credential store has its own schema version independent of the package version and ordinary application/project schema. Future migrations must operate on protected records without moving plaintext secrets into ordinary state or logs. Unsupported/corrupt credential metadata fails closed and is preserved rather than replaced with a blank credential store.
