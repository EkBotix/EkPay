# Parser lifecycle

`pending_pairing → active → revoked`; pending devices may also be revoked.
There is no disabled/reactivation path. Re-enrollment creates a new public identity and
fresh key; current and retired keys are never reassigned to another device/merchant.

Registration atomically creates version 0, no public/private key, unpaired state,
creator, safe name, token hash/expiry, event and audit. Pairing consumes a token and
installs the first key/version 1 atomically. New-key proof is checked in trusted TS;
SQL rechecks token, issuer membership/verified user, account, merchant, status and version.

Rotation uses dashboard-authorized re-pairing (approach B), not autonomous signed
old-key replacement. Owner/admin issues a fresh token for the exact current version;
the new device key proves possession and advances exactly one version. Issuing another
token invalidates the old token. No overlap/grace period for old-key ingestion.

Revocation writes terminal status, retires keys and consumes outstanding token, creating
one safe event/audit. Repeat revocation is idempotent. Historical receipts/evidence/keys
are preserved; heartbeat, rotation, pairing and future ingestion all reject.

Management and ingestion perform actual revision writes on the same device row.
READ COMMITTED losers re-evaluate current status/version after waiting; REPEATABLE READ
and SERIALIZABLE stale writes abort with 40001. Global public-key uniqueness uses an
immutable SHA-256 fingerprint primary key, protecting even different-device races.
Receipt health touches the parent device; device triggers never create receipts, avoiding
recursion. Deadlock/serialization errors require retrying the whole transaction.

Admission is ordered by the device write. If ingestion acquires it first and commits,
its history survives subsequent revocation; if revocation commits first, ingestion cannot
succeed. This does not cancel already committed evidence or verification history.
