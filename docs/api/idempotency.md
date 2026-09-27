# Idempotency

POST requires a bounded Idempotency-Key. DB stores SHA256 of that identifier, a normalized semantic request SHA256 fingerprint and intent UUID, never the raw body or bearer key. Idempotency keys are identifiers, not secrets.

Receipt uniqueness is (merchant_id,environment,key_hash). Merchant references are also unique per merchant/environment. Scope is merchant/environment rather than individual key: replacement keys can replay the same authorized request. Receipt has a deferred composite tenant/environment FK to its intent and is immutable.

INSERT ON CONFLICT DO NOTHING reserves the generated intent UUID before insertion. New reservation, intent, event and audit commit atomically. Existing reservation returns the same intent when fingerprints match; changed payload returns 409. Failure leaves no orphan receipt.

Fingerprint normalizes references, amount, account UUID, metadata JSONB, optional values and explicit expiry in UTC. Omitted expiry remains null in fingerprint, while actual new intent gets the 30-minute default. Replay remains valid after expiry and returns current effective status. The same key and semantic request does not promise byte-identical status forever.

READ COMMITTED waits then reuses/conflicts deterministically. REPEATABLE READ/SERIALIZABLE may abort with 40001; no automatic blind retry occurs. API returns generic transient 503; retry the whole request with the SAME key/body after uncertainty. Receipts have no automatic TTL/purge in this phase. PostgreSQL tests cover same/conflict/rollback for all three isolation levels.
