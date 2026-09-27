# Logical environments

API key determines test or live. Clients cannot submit/select environment. Both creation and lookup rederive key context in DB; intent reads always filter merchant AND environment.

Provider accounts and payment intents have constrained non-null environment columns.
Phase 4 removes Phase 3's inherited live defaults; trusted creation must be explicit.
Existing values are unchanged. Evidence, matches and transactions also require explicit
environment/composite FKs. Intent merchant/environment is immutable; merchant-reference
and idempotency uniqueness include environment. The gated synthetic engine rejects live.

Live here is only a logical namespace. Neither environment enables provider calls, SMS, real verification, checkout, fund movement or webhook delivery. EKPAY_DEVELOPMENT_API_ENABLED=false is the default regardless of key prefix. Do not enable public/production service. Test fixtures use synthetic accounts and ciphertext, never production accounts.
