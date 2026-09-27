# Parser security design

Status: schema only; Android/Kotlin and ingress cryptography are not implemented.

Enrollment must be owner/admin authorized. Generate a high-entropy token, store
only its SHA256 hash, and bind a validated 32-byte Ed25519 public key to an
immutable public device UUID and merchant. Keep the private key on the device,
preferably protected by platform keystore; never upload or store it in DB/source.
Use a reviewed Ed25519 library; length checks alone do not validate keys.

The future signed envelope must bind protocol version, device ID, key version,
timestamp, nonce, ingestion ID and canonical message/body hash. Specify byte
encoding/canonicalization and domain separation before interoperability work.
Authenticate the envelope, then reserve receipt and write evidence/payload in
one server transaction. Check token with constant-time comparison where used.

DB controls: device FOR SHARE lock; active status and key-version validation;
timestamp within 300 seconds; unique(device,nonce), global ingestion UUID,
unique(merchant,device,message_hash); evidence receipt FK including device,
ingestion and hash; active/key/freshness recheck before evidence append.
Receipt uniqueness survives rotation. Key/token changes require a higher version;
versions cannot roll back. Revocation is terminal: enroll a new device instead
of reactivating revoked credentials. Old receipts retain history.

Two duplicate submissions contend on unique indexes. Revocation/rotation updates
wait for ingestion's row lock; accepted-before-revocation transactions may finish,
later ingestion fails. This is a lock-order argument, not a completed multi-session
test. Retain replay identities or preserve tombstones when designing retention.
Enrolled devices can still fabricate SMS contents; signature authenticity is not
provider authenticity. Verify parser origin/context and corroborate high-risk
evidence in the future trusted verification layer.

Reference: [Ed25519 specification, RFC 8032](https://www.rfc-editor.org/rfc/rfc8032).
