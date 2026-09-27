# Parser key management

The future device generates and retains an Ed25519 private key. EkPay registration never
generates a device keypair. Only the local simulator generates temporary fixture keys in
memory; no private key, token or signature is logged, stored in DB, committed or returned
by dashboard reads. A public key is not secret, but is excluded from browser metadata.

Canonical public encoding: unpadded base64url, exactly 43 characters decoding to exactly
32 bytes and round-tripping identically. No arbitrary PEM variants, padding, zero/ff key,
or malformed proof accepted. Node Ed25519 verifies possession of the new key during pairing.
SQL stores raw 32-byte public keys plus monotonic version; `secret_hash` is legacy nullable
compatibility metadata and is not used for signing authentication.

Global fingerprint history retains every current/retired key forever under the current
foundation. A uniqueness conflict rolls back activation/rotation/token consumption/audit.
No key reassignment across merchants or devices, including retired keys. Key version starts
at 0 pending, becomes 1 paired and increments exactly once per new key. Rollback, same-key
version bumps and post-revocation modifications fail at DB level.

Lost key recovery requires owner/admin approved fresh pairing/new key; revoked identity
requires new enrollment. Hardware-backed Android Ed25519 support, backup restrictions,
re-auth/MFA for sensitive management and incident response remain launch blockers.
