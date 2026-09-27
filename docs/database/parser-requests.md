# Durable parser receipts — Phase 6 (unapplied)

Existing immutable receipt environment/body_digest/semantic_fingerprint/evidence_id/retry_of/
processing_state preserved. Adds request_kind=evidence|heartbeat; heartbeat has no evidence.
Composite tenant/environment/source/evidence FKs and global primary ingestion-ID partial
unique index retained. Fresh retry aliases preserve stable evidence; (device_id,nonce)
uniqueness is durable. No signatures/private keys/raw bodies stored.

Authenticated parser_requests SELECT and all table privileges revoked, even for owners.
Replay data is trusted-service/DBA only. Direct service INSERT remains revoked; no API-key
capability. Only hardened RPCs create normal receipts. AFTER INSERT health updates source
last_seen_at/last_authenticated_at inside the transaction. Exact cached retries don't add
receipt/event or health timestamp; accepted fresh-nonce aliases do. Heartbeat safe fields
are stored on device; exact heartbeat replay emits no duplicate event/audit.

Current/retired key history and receipts have no retention deletion job. Future retention
must not erase replay protection. See [replay model](../security/parser-replay-protection.md).
