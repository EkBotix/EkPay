# EkPay

**Transaction Verification & Merchant Automation Software** — development / pre-launch.

EkPay intends to receive transaction evidence/data, verify information and notify
merchant systems. Customer funds would go directly to merchant-owned accounts.
No wallet, custody, collection, settlement, payout or fund-transfer feature exists.
Software-only/non-custodial design does not establish regulatory exemption.
Commercial launch requires qualified Bangladesh regulatory/legal review.

## Current status

Seven migrations through Phase 6 are applied and immutable. Phase 7 adds a separate Kotlin
Android sandbox project at D:\ekpay-android-parser: protected Ed25519 identity, pairing,
signed heartbeat/synthetic evidence, Room queue/WorkManager retry and test-only UI.
No new backend migration or runtime Next parser-route change in Phase 7.
Internal parser routes exist but require NODE_ENV=test plus EKPAY_PARSER_INGESTION_ENABLED.
Production fails closed even if the flag is true. Management and private DB policies default
OFF. No SMS permissions/reader/real device, provider/customer data, real verification,
webhook delivery, commercial service, payment collection or BD21topup integration enabled.
See [Phase 7 report](docs/phase-7-implementation.md), [protocol](docs/architecture/parser-protocol.md)
and [Android architecture](docs/android/architecture.md).

Run npm run test:phase7 for real Kotlin HTTPS→unchanged Phase 6 handler→disposable PostgreSQL.
Run npm run sandbox:android for local emulator integration only; a short-lived loopback
bridge supplies fixture pairing transport, never hosted production policies or credentials.

Run npm run simulate:parser for a disposable loopback PostgreSQL simulator: temporary
in-memory keys and synthetic data only, no remote URL or retained private-key artifacts.
Distributed device/IP and pairing limits, hosted transport/UI validation, Android Keystore
support and qualified regulatory/privacy review remain launch blockers.

## Local development

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Configure credentials yourself without printing/sharing them. NEXT_PUBLIC_SUPABASE_URL
and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are public. SUPABASE_SERVICE_ROLE_KEY,
API_KEY_HASH_SECRET and APP_ORIGIN remain server configuration. The stable HMAC
pepper must be high entropy and at least 32 characters; existing key hashes depend
on it. Never introduce a second pepper or casually rotate it.

EKPAY_DEVELOPMENT_API_ENABLED defaults to false. Only enable it on isolated development
infrastructure with synthetic fixtures after reviewed schema setup. It must stay
false for public/production deployments. Logical live keys do not activate real services.

EKPAY_SYNTHETIC_INGESTION_ENABLED and EKPAY_AUTO_VERIFY_SYNTHETIC_EVIDENCE also default
false and require NODE_ENV=test. Separate DB-owner policies remain disabled; no service
or browser toggle. Run synthetic ingestion only through disposable local tests.

## API foundation

- POST /api/v1/payment-intents: payment_intents:create, strict body and Idempotency-Key.
- GET /api/v1/payment-intents/{id}: payment_intents:read, key-scoped tenant/environment.
- Header-only Bearer; shared complete-credential HMAC and constant-time comparison.
- Integer BDT minor units; active matching synthetic account; created state only.
- Receipt, intent, safe event and audit are atomic; no evidence/verified mutation route.
- Distributed rate limiting is deferred and is a **PRE-PRODUCTION BLOCKER**.

See [API contract](docs/api/payment-intents.md), [authentication](docs/api/authentication.md),
[idempotency](docs/api/idempotency.md), [Phase 5 report](docs/phase-5-implementation.md),
[ingestion architecture](docs/architecture/evidence-ingestion.md),
[verification engine](docs/architecture/payment-verification-engine.md),
[regulatory positioning](docs/compliance/regulatory-positioning.md) and
[launch gate](docs/compliance/launch-gate.md).

## Validation

```powershell
npm test
npx tsc --noEmit
npm run lint
npm run build
supabase migration list --linked
supabase db push --linked --dry-run
git diff --check
```

Tests use synthetic fixtures in disposable PGlite and native loopback PostgreSQL.
Native tests require platform binary installation scripts and a non-root OS user.
No remote test writes occur. Hosted Auth/PostgREST verification remains outstanding.
Do not apply, reset, repair, commit or push without separate authorization.

## Roadmap

Review additive Phase 5 migration, validate hosted isolated runtime, add reviewed
distributed limits/quotas and complete legal/regulatory launch gates. Provider
encryption/KMS, trusted ingestion, real-source authoritative verification and
signed SSRF-safe webhook delivery require separate implementation and review.
Future PHP/Laravel, WooCommerce, WHMCS, Node.js and BD21topup support is planned,
not connected or certified today.
