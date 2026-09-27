# Phase 4 verification boundary

Existing create/read API semantics remain. There is NO payment-evidence, verify,
approve or transaction-mutation HTTP endpoint. API-key clients cannot execute the
authoritative service-only RPC. Intent/account environment is explicit in trusted
DB creation; omission no longer defaults live. A created/pending or manual_review
intent never proves payment. Engine rule and test-only gate are documented in
[verification architecture](../architecture/payment-verification-engine.md).

# Development payment-intent API

Development / pre-launch; expected payment records only. No payment URL, fund collection, evidence ingestion or verification command is exposed.

POST /api/v1/payment-intents requires payment_intents:create and Idempotency-Key (8–128 ASCII letters/digits/._:-). Required body: amount (integer BDT minor units, 1–100000000), currency BDT, reference (trimmed 1–128 characters), provider (bkash/nagad/rocket/upay), provider_account_id UUID. Optional customer_reference (1–128), expires_at (ISO timestamp with offset), metadata object (20 keys, key length 64, encoded size 4 KiB). Body limit 8 KiB. Unknown fields including merchant_id, environment, status, actor_id, verified_at and transaction_id are rejected.

Provider account must be active and match the key's merchant, logical environment and provider. Account setup remains disabled; use synthetic fixtures in isolated development. Defaults: empty metadata, null customer reference, 30-minute expiry. Explicit expiry must be future and no later than 24 hours. Initial stored status is created.

201 {data: intent} for new creation; 200 for exact replay. Safe fields: id (pi_ plus 32 hex), reference, amount, currency, provider, environment, status, customer_reference, metadata, created_at, expires_at, verified_at. No internal UUID, account ciphertext, proof or key hash.

GET /api/v1/payment-intents/{id} requires payment_intents:read. Key controls both merchant and environment; foreign/missing objects return identical 404. Expired nonterminal records return effective expired without background writes. Verification timestamp is not populated by this API.

```bash
curl -X POST http://localhost:3000/api/v1/payment-intents \
  -H "Authorization: Bearer ek_test_REPLACE_ME" \
  -H "Idempotency-Key: order-12345" \
  -H "Content-Type: application/json" \
  -d '{"amount":82000,"currency":"BDT","reference":"ORDER-12345","provider":"bkash","provider_account_id":"00000000-0000-4000-8000-000000000001","metadata":{}}'
```

All example IDs/keys are placeholders; this requires isolated schema/account setup first. Never place secrets, SMS, bank details or unnecessary personal data in metadata.
