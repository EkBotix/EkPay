# Payment verification flow

This describes the proposed DB flow; no production payment endpoint exists.

1. An authorized server creates a payment intent containing minor-unit amount,
   BDT currency, merchant reference and selected merchant-owned provider account.
2. The customer pays the provider account. Customer-submitted IDs and redirects
   are hints, never authoritative confirmation.
3. Trusted ingress authenticates a provider API response or signed parser request,
   normalizes evidence and atomically inserts replay receipt/evidence/ciphertext.
4. A versioned deterministic matcher records provider, amount, receiver,
   transaction-ID and time results. A score cannot replace these predicates.
5. Trusted verification inserts a transaction only with all required checks.
   The DB locks the intent, validates relationships and details, and reserves
   the provider transaction ID with a unique constraint.
6. In that same SQL transaction, the intent becomes verified and a sanitized
   event is appended. Any failure rolls the whole operation back.
7. A future worker signs the event and sends it to a provisioned endpoint.

Manual evidence still requires deterministic details and an owner/admin reviewer.
Failed, expired and already verified intents cannot create another transaction.
Provider evidence without timestamp/transaction ID may be retained but cannot
produce an authoritative transaction. Notifications should use at-least-once
delivery with receiver deduplication; external exactly-once sending is not promised.

See [schema](../database/schema.md) and [webhook requirements](../security/webhook-security.md).
