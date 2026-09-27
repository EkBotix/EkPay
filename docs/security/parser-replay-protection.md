# Parser replay protection

Protocol 1 requires 16 cryptographically random nonce bytes, canonical unpadded base64url
(22 characters), unique per device. Accepted nonces are durable DB receipts; no memory
cache substitutes for the unique `(device_id,nonce)` index. Sign every new transport attempt.

An exact already accepted nonce/ingestion/fingerprint retry returns its stable result,
never creates a second business acceptance. Same nonce with changed ingestion/fingerprint
conflicts. Retry with fresh nonce/timestamp but same UUIDv4 ingestion ID and normalized
fingerprint returns the same evidence ID and records a retry alias. Changed semantics
or source for a global ingestion ID conflicts. Source/key/freshness are checked before
cached replies, so revocation/rotation cannot be bypassed by retrying old requests.

Ingestion IDs have a global primary unique index and an actual per-ingestion serialization
write. Source revision writes serialize source races even under stale snapshots. Retry
whole transactions after 40001/40P01; never automatically change conflicting payment facts.
Nonce persistence, aliases and evidence insertion commit/roll back together.

Message hash is distinct from exact raw-body digest. For evidence it covers ordered
normalized provider, provider transaction reference, integer minor amount, BDT currency,
receiver/sender identity hashes and UTC provider timestamp. It excludes receive time,
nonce, transport/app metadata and JSON whitespace/order. TS recomputes it. Separate logical
messages with matching normalized facts can dedupe to one immutable evidence observation.
Heartbeat message hash is exact body SHA-256; heartbeat semantic fingerprint is separately
operation-prefixed and cannot reuse an evidence ingestion ID.

No cleanup/retention job exists. Expiry/partition/retention policy must preserve replay and
ingestion identity protection and key history before production; deleting receipts to
allow replays is forbidden. Rejected requests do not generate unauthenticated audit spam.
