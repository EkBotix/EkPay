## Phase 6 schema delta (unapplied)

Parser pending/active/revoked lifecycle, safe metadata, paired/authenticated timestamps,
management revision, private token hashes/global key history/disabled policy, receipt
request kind and health trigger. See [devices](parser-devices.md), [receipts](parser-requests.md).
Earlier Phase 5 schema notes remain historical.

# Current migration inventory

Phase 1–4's five migrations are applied. New unapplied Phase 5:
20260927180557_trusted_synthetic_evidence_ingestion.sql. Reuses source/receipt tables,
adds provenance and retry aliases, revokes normal direct trusted evidence/request INSERT.
See [current report](../phase-5-implementation.md). Earlier inventory below is historical.

Phase 1–3's four migrations are applied. New unapplied Phase 4:
20260927173212_synthetic_verification_engine.sql. Existing evidence/matches/transactions
gain environment FKs, deterministic checks/reasons/rule; private disabled policy and
serialization tables control synthetic-only verification. Intent/account defaults
no longer silently select live. See [migration workflow](migrations.md) and
[current report](../phase-4-implementation.md). Earlier schema descriptions below are historical.

# Database schema

Applied: `20260927072955_init_ekpay_core.sql`. Proposed/unapplied:
`20260927082848_core_payment_security_infrastructure.sql`.

| Table | Purpose and important invariant |
| --- | --- |
| merchants | Tenant identity and lifecycle |
| merchant_members | User role; one membership per merchant/user; no client writes |
| merchant_brands | Merchant configuration; safe owner/admin column writes |
| provider_accounts | Merchant-owned account, masked/encrypted identity, receiver hash and external encryption-key reference |
| payment_intents | Expected minor-unit BDT payment; account/provider/brand tenant FKs |
| payment_evidence | Immutable trusted observations; unique ingestion/content identities |
| payment_matches | Immutable versioned matching decisions; five flags required for matched status |
| transactions | Verified record; intent/evidence/match one-use and provider-ID uniqueness |
| events | Immutable typed tenant event with bounded JSON payload |
| webhook_endpoints | Disabled-by-default HTTPS config and event subscriptions |
| webhook_deliveries | Immutable completed attempts referencing event, endpoint and signing-secret version |
| audit_logs | Immutable bounded metadata with tenant-validated target/actor |
| parser_devices | Token hash, public signing key, monotonic key version and terminal revocation |
| parser_requests | Immutable nonce, ingestion and message replay reservations |
| ekpay_private.evidence_payloads | Restricted ciphertext and external key reference |
| ekpay_private.webhook_secrets | Restricted ciphertext per endpoint/signing version |

UUID IDs and created_at are consistent; mutable resources use updated_at. Amounts
are positive bigint minor units, currency is BDT, provider is one of the initial
four. Compound merchant/time/status and relationship indexes support tenant
queries. New history relationships use RESTRICT to retain provenance.

No payment balance/ledger, API-key registry, durable webhook job queue, SDK or
parser application is implemented. Global transaction-ID uniqueness is an explicit
conservative policy, not a verified provider guarantee; see [decisions](../portfolio/engineering-decisions.md).
