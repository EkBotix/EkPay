# Historical Phase 3 report

Phase 3 migration is now applied (read-only verified 2026-09-27). The pre-apply
results below are historical. Current implementation/recommendation lives in
[Phase 4](phase-4-implementation.md); no applied migration was rewritten.

# Phase 3 implementation / pre-apply review

2026-09-27. **APPLY RECOMMENDATION: PASS for additive development schema after
human review; commercial/public launch remains BLOCKED.** No migration applied,
commit, push, production write, real payment/provider test or external send occurred.

## 1–4. Implementation and exact file inventory

Versioned expected-payment create/read API, shared HMAC authentication,
tenant/environment isolation, transactional idempotency, safe audit/events,
verification-focused dashboard and regulatory-safe documentation implemented.
New unapplied migration: **20260927165346_development_payment_intent_api.sql**.
All three earlier files are now applied and were not modified in Phase 3.

Created in Phase 3 (29 files):

```text
app/api/v1/payment-intents/route.ts
app/api/v1/payment-intents/[id]/route.ts
app/dashboard/payments/page.tsx
app/dashboard/payments/[id]/page.tsx
lib/api/auth.ts
lib/api/body.ts
lib/api/contract.ts
lib/api/payment-intents.ts
lib/verification.ts
scripts/test-phase-3.mjs
scripts/testing/postgres.mjs
scripts/testing/api-transport.mjs
tests/api.test.ts
supabase/migrations/20260927165346_development_payment_intent_api.sql
docs/api/payment-intents.md
docs/api/errors.md
docs/api/idempotency.md
docs/api/environments.md
docs/security/api-authentication.md
docs/security/rate-limiting.md
docs/architecture/payment-intent-api.md
docs/architecture/payment-verification-flow.md
docs/database/payment-intents.md
docs/compliance/regulatory-positioning.md
docs/compliance/operating-model.md
docs/compliance/fund-flow.md
docs/compliance/launch-gate.md
docs/compliance/regulatory-review-checklist.md
docs/phase-3-implementation.md
```

Modified in Phase 3 (24 files):

```text
.env.example
README.md
package.json
next.config.ts
app/globals.css
app/layout.tsx
app/page.tsx
app/dashboard/layout.tsx
app/dashboard/page.tsx
app/dashboard/[section]/page.tsx
components/api-key-form.tsx
lib/security/api-key.ts
lib/supabase/admin.ts
docs/api/authentication.md
docs/api/api-keys.md
docs/security/api-key-security.md
docs/architecture/overview.md
docs/phase-2-implementation.md
docs/database/migrations.md
docs/database/api-keys.md
docs/database/rls.md
docs/portfolio/project-case-study.md
docs/portfolio/technical-skills.md
docs/portfolio/engineering-decisions.md
```

package-lock.json, .gitignore and prior foundation files already had changes at
Phase 3 start; they are not new Phase 3 edits. Earlier reports are marked historical.

## 5–8. Authentication, key verification, HMAC and isolation

Strict Authorization Bearer only, full credential ek_(test|live)_16hex_43base64url.
Unique prefix lookup; shared hashApiKey/API_KEY_HASH_SECRET, HMAC-SHA256 complete
credential and fixed 32-byte timingSafeEqual. Secret remains 256 random bits;
plaintext is never persisted. No credential header/body logging exists. Missing
pepper/configuration fails closed; unsupported version, wrong secret, revoked,
expired and inactive/missing merchant return generic 401. Missing ability returns
403 only after credential validation. Total request timing is not claimed constant.

Trusted key context owns merchant/environment/abilities. Server request body cannot
override it. Service-only RPCs independently derive and recheck current key context
under SHARE locks. Fresh lookup every request, no positive auth cache. Test key
cannot read live and vice versa. Accounts gain matching logical environment with
composite FK; intent tenant/environment are immutable. Legacy rows default live
without data repair/reclassification. Logical live never activates actual services.

## 9–12. Contracts, idempotency and concurrency

POST /api/v1/payment-intents requires payment_intents:create. Integer minor-unit
BDT amount 1–100000000, bounded reference, four supported providers, UUID active
matching tenant/environment/provider account. Optional bounded customer reference,
ISO expiry and 4 KiB/20-key metadata; streamed body limited to 8 KiB. Unknown
tenant/state/actor/proof fields rejected. Default expiry 30 minutes, max 24 hours.
New records are created, never verified. New 201, replay 200, changed request 409.

GET /api/v1/payment-intents/{id} requires payment_intents:read. Only same merchant
and environment; cross-context/missing returns identical 404. Safe JSON projection
contains public id/reference/amount/currency/provider/environment/status/customer
reference/metadata/timestamps. No private account, key, parser, evidence or webhook
data. Effective expiry is computed without worker writes; no paid inference.

Receipt uniqueness (merchant,environment,SHA256 idempotency identifier), normalized
JSONB request fingerprint and deferred composite intent FK. Reservation, intent,
event and audit commit together. No raw body in receipt. Unique insert is the DB
concurrency barrier, not memory locks. Same request returns same intent even after
expiry; different payload conflicts. Metadata key order/UTC expiry normalization
and omitted default expiry are stable. Reference uniqueness also includes environment.
READ COMMITTED waits/reuses/conflicts; REPEATABLE READ/SERIALIZABLE may 40001 and
need whole-request retry using the same identifier/body. Generic transient 503
does not hide that failure as success. No blind retry or receipt TTL implemented.

## 13–16. UX, reference research, exclusions and state restrictions

Navigation: overview, payments/verification, transactions, provider accounts,
evidence, API keys/docs/event logs, audit, team and settings. Original teal/minimal
responsive layout, environment/status filters, exact-reference search, recent 50
records, safe badges and separate expectation/evidence/check/outcome sections.
Clear unavailable/empty/loading/restricted states; no fake verified data.

All supplied 22 reference names screened through grouped public searches.
Useful public patterns from UddoktaPay list/filter docs, PipraPay developer navigation,
ZiniPay endpoint/docs grouping; BohudurPay/AsthaPay developer docs also screened.
Direct fetches of UddoktaPay/PipraPay were 403/502; indexed docs used. Authenticated
dashboards and all 22 visual layouts were NOT inspected. Sources/limitations are
recorded in portfolio/engineering-decisions.md. No logos/assets/source/branding/
marketing clones, hosted checkout, refund, custody/collection/settlement UI or
query-string key support copied. Reference products' regulatory status not endorsed.

Public API only creates/reads expected intent records. No evidence/transaction
creation, authoritative verification, state override or completed/paid command.
Existing DB verified guard remains intact. Conceptual future state model:
created → pending → verified/manual_review/failed/expired; no future transition
is implemented by this API. Verification checks in detail UI explicitly unevaluated.

## 17–23. Rate limits, events, RLS, functions, config, compliance and wording

Distributed merchant/key-aware rate limiting is **DEFERRED / PRE-PRODUCTION BLOCKER**.
Documented targets: create 30/minute burst 10, read 120/minute burst 30, plus failure
and global/edge limits, quotas and cardinality protection. These are design targets,
not active enforcement. API gate defaults false; never enable public/production.

payment_intent.created event/audit is atomic and deduplicated with intent creation.
Only environment, intent/key identifiers/prefix and timestamps are retained in
audit/event projection; no raw metadata or secret/hash. Event type check extends
previous allowlist; webhook subscriptions/delivery remain unchanged and disabled.

Existing RLS preserved. api_idempotency_keys RLS enabled, all client/service table
grants revoked; definer owner reserves receipts. Environment metadata grant is
safe dashboard metadata only. No unsafe new TRUNCATE/REFERENCES or evidence/
transaction client write grants. Existing broad trusted service-role capabilities
are not browser/API bearer capabilities and have not been expanded.

New SECURITY DEFINER: api_create_payment_intent(uuid,text,jsonb) and
api_read_payment_intent(uuid,text). Empty search_path, qualified application
references, PUBLIC/anon/authenticated execute revoked, service_role only. Internal
require_api_key/intent_api_json helpers and environment trigger are SECURITY INVOKER
and not client-callable. No user/actor/merchant body trust or role elevation.

Existing variables unchanged: NEXT_PUBLIC_SUPABASE_URL/PUBLISHABLE_KEY public;
SUPABASE_SERVICE_ROLE_KEY, API_KEY_HASH_SECRET, APP_ORIGIN server-only. Added
placeholder/default EKPAY_DEVELOPMENT_API_ENABLED=false, server-only. Future
KMS_KEY_REFERENCE/WEBHOOK_SIGNING_VERSION still unused. No real value added.

Five compliance docs are DRAFT / NOT LEGAL ADVICE: positioning, operating model,
fund flow, launch gate, regulatory review checklist. Intended customer→merchant
fund flow, EkPay evidence/data/result flow, no custody/settlement and explicit
software-only/non-custodial non-exemption caveat. Bangladesh Bank pages are research
starting points; current classification needs counsel/official confirmation.
Public copy now uses Transaction Verification & Merchant Automation Software,
development/pre-launch. No approval/licensing/security certification claim.
Word search found legitimate internal approval-workflow references; retained those.

## 24–30. Validation, live compatibility and worktree evidence

- Unit: 8 PASS, including malformed/unknown/revoked/expired/suspended/wrong-env keys,
  scopes, test/live success, strict bodies and byte/content-type limits.
- Phase 1: 110 DB security checks PASS. Phase 2: 39 checks PASS.
- Last-owner native PostgreSQL 18.4 suite PASS all three isolation levels; previous
  lock-only bug reproduced only in disposable local fixture, fixed body restored.
- Phase 3: 74 native PostgreSQL security/invariant checks PASS, plus handler/Supabase
  JS/loopback transport/real SQL integration assertions: POST 201/replay 200/conflict
  409, GET 200/404, auth 401, client override 400 and no secret response/storage.
- Idempotency concurrency: READ COMMITTED, REPEATABLE READ and SERIALIZABLE same,
  changed-payload and rollback races PASS; exactly one intent and deterministic
  retry. pg_blocking_pids proves actual overlapping sessions, not just timing.
- Typecheck/lint/build PASS. Initial render-clock purity lint errors corrected by
  one cached clock per SSR request; final lint has no warnings.
- Local production-mode HTTP: POST/GET return default-gated 503 safe JSON, no-store,
  nosniff/DENY; protected payment/docs routes redirect 307 to setup/login.
- Browser: desktop/mobile landing visually inspected; 390px no overflow, no overlay,
  browser errors empty; protected payments redirect safely. Authenticated dashboard
  visual walkthrough remains unverified due to absent local Auth configuration.
- Static browser bundle scan: no service-role/HMAC/generator/auth helper matches.
- Linked list: first three aligned; only 20260927165346 local-only.
- Linked dry-run exit 0: ONLY 20260927165346_development_payment_intent_api.sql.
- Live read-only: hosted PostgreSQL 17.6, merchants/intents/keys/accounts all zero;
  proposed environment columns and idempotency table absent. Empty baseline compatible.
  Live catalog also confirms expected reference/event constraint names, invoker
  audit/event/mutation helpers and the applied last-owner actual-write fix.
- git diff --check clean; diff --stat/status inspected. Eight tracked files retain
  prior+current changes, and foundation/new artifacts remain untracked. No staging.
  Report inventory identifies Phase 3 changes rather than treating all status as new.
  All 53 Phase 3 inventory files passed separate whitespace checks (including
  untracked artifacts). Browser and local server were stopped; no port 3001 listener.

Applied SHA256 fingerprints unchanged:

```text
20260927072955 51CD36E1A0A7F72F5D43A0F1A67093CD3C69467200114726BBCC50F9B22D661C
20260927082848 789C95B52F5B6F2852100E6BF820F78ADD14DA36597E56D49E29CC2D70159521
20260927090644 81C18D58E1FB2CBEC058BF4A8FC11E4D4CC08A7912C3E6BA56F12C9ACC421269
```

## 31–34. Remaining risks, launch blockers, disabled features and recommendation

Hosted PostgreSQL 17.6/PostgREST/Auth/email and authenticated UI not tested; local
native PostgreSQL is 18.4 and transport adapter is not real hosted PostgREST.
Edge/TLS/APM redaction, distributed limits/quotas, key/pepper rotation and MFA/re-auth
operations require further work. Receipt retention/abuse/storage growth needs review.
Metadata is caller-controlled; do not store sensitive data there. Existing direct
brand/webhook configuration auditing gaps remain a separate pre-launch review item.
Full legal/regulatory classification, provider permissions and privacy terms remain
unresolved. Schema PASS is not permission to operate a payment service.

Disabled: public/live service, real accounts/provider APIs/SMS, authoritative
verification, external merchant webhooks, BD21topup/SDK commerce integrations,
checkout/collection, custody, settlement, wallet, payout and money movement.

**PASS to review/apply the additive development migration against the inspected
empty baseline after human approval and a fresh live pre-apply check.** Keep API
gate off. No commercial launch endorsement or regulatory exemption claim.
Stop here for human review; do not apply, commit or push.
