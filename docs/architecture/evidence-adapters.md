# Evidence adapter boundary

EvidenceAdapter has validateSource(source) and normalize(rawBody); orchestration builds
trusted context from registered identity and passes safe normalized fields to persistence.
Only SyntheticEvidenceAdapter exists. No AndroidSmsAdapter/BkashApiAdapter/NagadApiAdapter
is implemented. Provider-specific formats remain outside deterministic core verification.

Signed body accepts exactly provider, provider_transaction_id, amount_minor, currency,
receiver_identity_hash, sender_identity_hash and provider_timestamp. Integer positive safe
BDT minor units, known lowercase provider enum, 64-lowercase-hex hashes and explicit ISO time.
Currency normalizes uppercase, timestamps UTC milliseconds, reference outer whitespace trims.
Synthetic references must already use uppercase grammar; lowercase is rejected, not changed.
No fuzzy correction/missing facts inferred. Real adapters must independently establish case/
receiver namespace semantics before choosing normalization; fixture rules are not provider facts.

Raw body limit 4096 bytes, strict UTF-8/JSON/unknown-field rejection. No raw payload/metadata
or secret fields. normalization_version: ekpay-evidence-normalization-synthetic-v1.
SQL also validates bounded normalized shape and derives source linkage from DB registry.
Request/body hashes and semantic fingerprint are distinct: signature binds exact raw bytes;
idempotency compares normalized JSONB semantics, ignoring transport nonce/timestamp/order.
