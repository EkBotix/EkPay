# Encryption and key management

Status: restricted ciphertext storage exists in the proposed migration;
application encryption/KMS is not implemented. SQL cannot prove bytes are
encrypted or enforce use of a sound cipher. Test ciphertext is synthetic.

Provider account ciphertext is excluded from authenticated column SELECTs and
has a required external account_encryption_key_reference. The mutable account
record permits authorized re-encryption. Evidence payloads and webhook secrets
live in ekpay_private with no PUBLIC/anon/authenticated access. Both have external
key_reference fields; webhook signing versions are separate from encryption-key
references and can overlap during rotation.

Implement authenticated encryption with a reviewed library (e.g. AES-GCM), fresh
nonces and associated data binding merchant/object/field identity. Store the
versioned envelope, nonce and authentication tag with ciphertext. Use an external
KMS/key store and least-privilege access; do not put encryption keys into DB rows,
source, NEXT_PUBLIC variables or logs. Encrypt provider payloads before DB INSERT.

Append-only evidence payloads cannot be rewritten to rotate ciphertext. Prefer
external envelope-key rewrapping/versioned KMS references while preserving the
stored envelope. A future data re-encryption or deletion workflow requires an
explicit audited migration/maintenance design. Do not disable triggers casually.

Device token hashes are irreversible high-entropy token hashes, not encryption;
Ed25519 public keys need no secrecy. Identity/message hashes should be keyed to
resist low-entropy guessing and use a stable deduplication domain. Rotating their
key without a version/dedup transition plan could weaken replay detection.
Masked account display must not contain a full number; free-form metadata and
response excerpts must be redacted by the application. No plaintext fallback
secret columns are provided. Backups, keys and retention need coordinated policies.
