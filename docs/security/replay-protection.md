# Durable ingestion replay/concurrency

Reuse parser_requests; no second receipt store. Unique(device,nonce) remains. One global
primary ingestion identity is enforced by a partial unique index (retry_of IS NULL).
Fresh-nonce retries add append-only aliases referencing the same device/ingestion primary
through composite FK. Same identity+semantic fingerprint+message hash returns existing evidence;
changed identity/source/payload or nonce used for another ingestion rejects 23505.
Exact retry returns the existing receipt without duplicate event/audit. Current authentication,
key and freshness are checked even on retries. A new valid nonce retry stores a new safe
duplicate receipt/event/audit, not another observation. No unrecorded nonce acceptance.

Old parser_requests unique device/message-hash constraint is replaced with indexed lookup;
message dedupe authority remains existing unique merchant/account/source/message_hash evidence.
Same message/different ingestion ID records a new primary receipt mapping existing evidence
when normalized fingerprint agrees; conflict rejects instead of discarding. Same transaction
reference/different message may be legitimate duplicate observation or conflicting facts;
store independent observations, then Phase 4 reviews conflicting facts. Global provider/reference
transaction uniqueness remains unchanged and conservative.

Actual private ingestion-ID/message scope writes plus parser_devices.ingestion_revision UPDATE
serialize source authentication/receipts, including concurrent revocation/rotation. Revision
is security bookkeeping; existing updated_at trigger reflects source activity, not a key change.
Lock order ingestion→message→source→Phase 4 reference/merchant inputs. Existing scope tables
have no recursive triggers; device audit skips revision-only updates. Deadlocks can abort 40P01;
retry entire transaction fresh. READ COMMITTED waits then rechecks; RR/SERIALIZABLE stale writers
abort 40001. Rejected/conflicting input must not be blindly retried as success.

Tests use independent native PostgreSQL sessions and pg_blocking_pids barriers: ingestion IDs,
nonce, message, cross-source reference conflicts, revocation/rotation, rollback and duplicate
verification handoff across all three isolation levels. Source configuration writer wins →
no new accepted evidence; already committed evidence remains auditable after later revocation.
Receipt/mutex retention and quotas need separate review before production.
