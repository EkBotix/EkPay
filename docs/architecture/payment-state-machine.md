# Payment intent state machine

The Phase 4 trigger permits unchanged state, created/pending → pending, verified,
manual_review, failed or expired; manual_review → failed or expired. Failed/expired
cannot resume; no cancelled state exists in the actual schema. No normal path promotes
manual_review to verified. Future operator approval needs a separately reviewed operation.

The earlier transaction-backed verified-state guard remains. Creating an authoritative
transaction synchronizes verified_at/status in the same transaction; merely updating
status to verified fails. All changes/deletion of verified intents and all update/delete
of authoritative transactions are blocked, including normal trusted server flows.

Failed means an observation/decision failed, not necessarily the payment intent itself.
A wrong observation leaves a valid created/pending target available for later genuine
evidence. Expired clock-derived eligibility is rechecked by DB, not just the UI.

Manual review stores reason codes, immutable match/evidence references and timestamps.
Existing reviewed_by/review_reason are future trusted reviewer fields; synthetic engine
does not fill them or implement approval. Browser/customer/API-key clients cannot approve.
