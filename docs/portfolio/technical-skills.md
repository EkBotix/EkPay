## Phase 6 evidence

PostgreSQL transaction serialization, global uniqueness and least-privilege definer RPCs;
Ed25519 canonical signing/proof of possession; durable nonce/idempotency separation;
Next server actions with independent SQL authorization; bounded streaming validation;
synthetic native PostgreSQL multi-session simulator and explicit launch limitations.

# Phase 5 evidence

Ed25519/raw-body canonical signing, strict server-only contracts, source-derived tenant context,
partial unique primary receipts with retry aliases, transactional revocation/rotation checks,
safe provenance/audit and failure isolation. Native concurrency tests exercise fresh retries,
not in-memory locks. [Phase 5 report](../phase-5-implementation.md) lists demonstrated results.

Historical Phase 4 evidence follows.

PostgreSQL transaction isolation, real-session concurrency barriers, composite FKs,
least-privilege SECURITY DEFINER RPCs, immutable decision history, atomic rollback,
explicit environments and deterministic rule versioning. Next.js async server detail
reads preserve RLS and masked account information. Synthetic local tests demonstrate
invariants; they do not claim real provider/payment or hosted-auth validation.

# Demonstrated skills and planned work

Phase 3 demonstrates Node route handlers, streamed body bounds, Zod strict
schemas, timingSafeEqual/HMAC auth, environment/tenant FKs, atomic SQL RPCs,
deferred-FK receipt reservation, stable HTTP errors and native PostgreSQL
multi-session tests. Distributed limits, SDKs, provider verification and
commercial regulatory clearance remain future work.

Historical Phase 1/2 notes below:

Phase 2 implemented skills: Next.js App Router server actions and async cookies,
Supabase Auth cookie SSR/PKCE, server-only boundaries, current-user/membership
authorization, atomic SECURITY DEFINER bootstrap/key RPCs, HMAC API-key hashing,
Zod validation, RBAC dashboard, audit atomicity and local DB/unit tests.
Key authentication consumers/payment/crypto-ingress/webhook runtimes remain future work.

| Technology/skill | Evidence and status |
| --- | --- |
| Next.js, React, TypeScript | Initialized scaffold; typecheck/lint validation; payment UI/API not built |
| Supabase/PostgreSQL | Applied core schema, proposed infrastructure migration, catalog inspection |
| Multi-tenant architecture/RLS | Composite tenant FKs, role policies, safe column grants and negative tests |
| Database constraints/indexes | Minor units, controlled states, ownership/provider consistency, uniqueness and lookup indexes |
| Payment verification | Deterministic DB invariants, locking and atomic verified/event transition |
| Idempotency/replay | Durable ingestion/nonce/message uniqueness and device status/version checks |
| Audit logging | Trusted-only append with tenant target/actor validation |
| Cryptographic signing | Ed25519 parser/public-key and versioned webhook-signing design; crypto runtime pending |
| Secret handling | Restricted ciphertext/hashes and external key references; KMS encryption pending |
| Webhook security | Delivery storage and documented SSRF/lease/at-least-once requirements; sender pending |
| Migrations/testing | Transactional DDL, first-history preservation, disposable PostgreSQL checks and dry-run |
| REST API architecture | Future authorized `/v1/...` boundaries; no published API |
| Android/Kotlin | Future parser client; no implementation claim |
| PHP/Laravel/WooCommerce/WHMCS/BD21topup | Future integration architecture; no SDK/plugin delivery claim |

Full Supabase/PostgREST and real parallel-session testing remain outstanding.
