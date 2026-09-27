> Historical pre-apply report. Phase 6 is now applied (seven migrations). Phase 7 adds
> a separate sandbox Android app; see [current report](phase-7-implementation.md).

# Phase 6 implementation and pre-apply review

2026-09-28 · DEVELOPMENT / PRE-LAUNCH / SYNTHETIC ONLY.
**APPLY RECOMMENDATION: PASS for the verified empty baseline, keeping every gate OFF.**
This is a disabled-infrastructure migration recommendation, not permission to apply,
enable real parser traffic or commercially launch. No apply, commit, push, production
data/schema write, Android/SMS access, provider call, real payment verification, webhook
delivery or BD21topup connection occurred. Live queries were SELECT-only; Supabase CLI
linked inspection initializes its temporary login role as part of normal CLI operation.

1. **Implementation:** reused Phase 5 source registry/receipts/ingestion; added owner/admin
   enrollment, pairing, key history/rotation/revocation, signed parser protocol, health,
   safe dashboard and disposable synthetic simulator. No real Android app.
2. **Migration:** `supabase/migrations/20260927184731_parser_device_lifecycle.sql`.
   CLI-generated, unapplied. Transactional DDL with 5s lock/60s statement timeouts and
   explicit empty registry/receipt guard. Six applied migration hashes unchanged below.
3. **Created files:** exact inventory below (20 files including this report).
4. **Modified files:** exact inventory below (20 files); preserve unrelated prior work.
5. **Lifecycle:** pending_pairing → active → revoked, or pending → revoked. Terminal
   revocation DB enforced; new identity/key required for re-enrollment. No disabled state.
6. **Registration:** authenticated SSR server action plus independently hardened SQL
   `auth.uid()` verified-user owner/admin checks. Developer/viewer/API keys denied.
   Pending version 0, no key, creator, opaque public UUID, active test account binding.
7. **Pairing:** DB-backed capability for exact device/version; TS verifies new-key proof;
   service-only SQL rechecks hash, expiry, consumption, verified issuer/current role,
   merchant/account/status/version. Atomic key/token/event/audit commit or rollback.
8. **Token security:** ten-minute single-use long hex token, 244 random bits from two
   v4 UUIDs hashed into token. Only token SHA-256 stored. Action response shown once,
   dismiss/reload clears display; no redisplay/read endpoint, secret logging or audit copy.
9. **Public key:** 32-byte Ed25519, canonical unpadded base64url 43 characters; strict
   length/round-trip, zero/ff/malformed/proof rejection. Global current/retired key claims.
10. **Versions:** 0 pending, 1 first paired, exactly +1 for a different new key; int32.
    No rollback, same-key bump or old-version ingestion.
11. **Rotation:** approach B, owner/admin dashboard-authorized re-pairing for expected
    current version. Fresh token and new-key proof; no autonomous old-key rotation path.
12. **Revocation:** same source row serialization point as admission; terminal status,
    token invalidation, key retirement, one event/audit; idempotent repeat. Committed
    historical evidence survives; future heartbeat/pair/rotate/ingest denied.
13. **Tenant/environment:** device registry derives merchant/test environment; no body
    override. Immutable identity and composite tenant/environment FKs preserved.
14. **Account binding:** exactly one active test provider account/provider per device.
    Synthetic provider_api capability reused; not real provider-origin proof.
15. **Headers:** EkPay-Parser-Protocol=1 plus X-EkPay-Device-Id, Key-Version, Timestamp,
    Nonce, Ingestion-Id, Message-Hash, Signature. JSON media type, 4096 streamed bytes.
16. **Canonical signature:** UTF-8 LF-separated domain `ekpay-parser-v1`, POST, exact
    endpoint path, lowercase device UUID, decimal version/millisecond timestamp, nonce,
    lowercase ingestion UUIDv4, message hash, exact raw-body SHA-256; NO trailing LF.
    Full [byte contract](architecture/parser-protocol.md). Never sign reserialized JSON.
17. **Freshness:** absolute difference <=300s, preliminary TS/server clock and final DB
    clock after waits. DB-generated ingestion/health timestamps. Generic auth errors.
18. **Nonce/replay:** 16 random bytes/22 canonical base64url characters; durable per-device
    unique nonce. Exact accepted request can return cached receipt without second effect;
    changed ID/fingerprint conflicts. No in-memory-only replay cache.
19. **Ingestion identity:** global UUIDv4 primary receipt; same logical facts/ID with fresh
    nonce is a retry alias/stable evidence ID. Source/semantic conflict rejected. Actual
    per-ID serialization write protects REPEATABLE READ; retry whole failed transaction.
20. **Message hash:** recomputed SHA-256 of ordered normalized provider/reference/amount/
    BDT/receiver/sender hashes/UTC provider time. Excludes receive/app/nonce/JSON formatting.
    Heartbeat hash is raw-body digest; heartbeat/evidence operation fingerprints separated.
21. **Verification order:** gate, method/media/size/strict headers/bounded stream, source
    status/version/time, raw digest/canonical signature, strict normalization/hash/provider,
    DB current status/key/time/binding plus durable replay/idempotency, atomic receipt.
    No business writes before signature; normalization precedes semantic DB replay checks.
22. **Heartbeat:** signed test-only health; current source/version/time/replay rechecked.
    Active merchant/account rechecked in SQL; safe app metadata and server timestamps only;
    cannot alter identity/key/account/status. Suspended merchant/inactive account reject.
    Accepted evidence/heartbeat receipts update last_authenticated_at/last_seen_at atomically.
    Exact cached nonce retries do not refresh health; fresh accepted aliases do.
23. **Metadata/privacy:** bounded app/Android/model/locale/timezone and protocol 1. No IMEI,
    serial, advertising ID, contacts, phone number, raw SMS or unrelated inbox data.
24. **Rate limits:** distributed per-device + IP secondary signal and pairing attempt
    limits are DEFERRED / PRE-PRODUCTION BLOCKERS. No claim that local memory limits suffice.
25. **Simulator:** `npm run simulate:parser` runs the Phase 6 suite with an isolated
    random-password loopback PostgreSQL 18.4 cluster and temporary in-memory Ed25519 keys.
    Safe registration/pairing, valid/retry/replay/bad signature/time/version/rotation/revoke
    tested. No remote URL input/private-key repository artifact/real message.
26. **Routes/flags:** POST /api/internal/parser/evidence and /heartbeat; INTERNAL, NOT PUBLIC
    API. Parser ingestion flag defaults false and requires NODE_ENV=test. Production is
    hard blocked even with flag true. Management flag defaults false/nonproduction-only;
    private parser, ingestion, verification policies remain disabled.
27. **Dashboard:** Parser Devices sidebar/page, safe status/environment/provider/account/
    version/created/paired/seen/authenticated/app/protocol data, register/replace token/
    approved rotation/revoke controls. Revoked state immutable; no keys/nonces/secret reads.
    Authenticated browser walkthrough remains unvalidated (no real tenant created).
28. **Audit/events:** created, pairing issued, paired, rotated, revoked, heartbeat; trusted
    derived actor/device/merchant and bounded safe metadata. No token/key/signature/nonce
    in explicit lifecycle audits. Rejected traffic deliberately creates no audit flood.
29. **RLS/grants:** member safe column-only device SELECT with tenant RLS. No authenticated
    receipt SELECT. No anon/auth device writes; service device DML revoked. Token/key/policy
    tables private/RLS/no client-service grants. API keys cannot manage devices. No unsafe
    TRUNCATE/REFERENCES grants added; cross-tenant tests pass.
30. **SECURITY DEFINER:** register_parser_device, issue_parser_pairing, consume_parser_pairing,
    revoke_parser_device, parser_heartbeat, ekpay_record_parser_key, ekpay_parser_request_health.
    All empty search_path, schema-qualified relations, PUBLIC execute revoked. Three auth
    management RPCs, two service attestation RPCs; trigger functions have no callable RPC
    grants. Private helpers are INVOKER with no execution grants. No caller actor parameter.
31. **Concurrency:** 30 real multi-session blocking-barrier races, ten per isolation level.
    READ COMMITTED, REPEATABLE READ and SERIALIZABLE all PASS. Single token activation,
    cross-device key uniqueness, single next rotation version, revoke-before-evidence/
    heartbeat, evidence-before-revoke history, nonce conflict, stable ingestion retry,
    heartbeat retry and rollback tested. Key uniqueness loses with 23505 or serialization;
    source stale writes abort 40001 at snapshot isolation. No conflicting double activation
    or second authoritative receipt. Admission uses real source revision writes; global
    key claims use primary-key uniqueness. Receipt trigger has no device→receipt recursion.
32. **Tests:** npm test PASS across all phases; expanded final Phase 6 rerun PASS, 209
    assertions/30 races. Unit 14 PASS (four new parser tests); Phase 1 110 checks;
    Phase 2 39 checks plus real owner concurrency at all three isolation levels;
    Phase 3 74 checks including handler→supabase-js loopback→PG; Phase 4 235 checks/33 races;
    Phase 5 150 checks/24 races. Phase 5 fixtures adapted to stricter lifecycle/service DML
    restrictions without editing applied SQL. Initial Phase 6 test fixture exhausted local
    connections; fixed by closing each race's clients, final suite exits cleanly.
33. **Validation:** npx tsc --noEmit PASS, npm run lint PASS, npm run build PASS.
    Production Next HTTP smoke with parser flag=true: both POST routes 404 not_available,
    no-store. Temporary loopback server stopped. No enabled hosted transport claim.
34. **Linked list:** six local=remote versions through 20260927180557; new 20260927184731
    local-only. Remote project ysrvugmihzcfjxsmdxke, fresh inspection 2026-09-28.
35. **Dry-run:** supabase db push --linked --dry-run PASS; would push only
    20260927184731_parser_device_lifecycle.sql. No seeds/roles planned; SQL was not applied.
36. **Live compatibility:** SELECT-only PostgreSQL 17.6 catalog/count inspection: devices,
    receipts, merchants, accounts, evidence and events zero; constraints validated,
    expected Phase 5 definitions/functions/RLS present, unsafe anon/auth write grants absent,
    direct service receipt INSERT absent, ingestion/verification policies false. Empty guard
    compatible now; fresh check required if data arrives before human-approved application.
37. **Git:** diff --check PASS; stat/status run. Worktree already contains prior phases:
    eight tracked modified files (1561 insertions/116 deletions at check) and broad untracked
    app/lib/docs/scripts/supabase/tests directories. Stat excludes untracked Phase 6 files;
    this is not a Phase 6-only diff. Nothing staged/committed/pushed. Full inventory below.
38. **Remaining security risks:** SQL trusts service/DBA crypto attestation; signatures do
    not prove provider origin. Distributed limits, sensitive-action re-auth/MFA, log/APM
    redaction, production monitoring/incident response, receipt/key retention and isolated
    hosted Next/Auth/PostgREST review remain blockers. No claim of production readiness.
39. **Android blockers:** actual device-side implementation, Ed25519 provider/Keystore/API/
    OEM/hardware compatibility, offline queue encryption/retention/backoff/clock recovery,
    enrollment transport and device integrity testing. No universally supported hardware
    Ed25519 assumption. See [future contract](android/parser-contract.md).
40. **Regulatory blockers:** qualified Bangladesh classification/review, any required
    approvals, merchant/provider account authorization, privacy/consent/store permission/
    retention terms. Software-only design establishes no exemption or approval.
41. **Disabled:** public/real parser traffic and pairing transport, Android/SMS access,
    real provider/customer evidence/payment verification, external webhooks, commercial
    service, custody/collection/settlement and BD21topup integration. Flags/policies OFF.
42. **Recommendation:** PASS for this empty-baseline disabled synthetic migration after
    human review. NOT a real-traffic or launch approval; no apply performed.

## Exact Phase 6 file inventory

Created:

- supabase/migrations/20260927184731_parser_device_lifecycle.sql
- lib/parser/protocol.ts
- lib/parser/pairing.ts
- lib/parser/handler.ts
- lib/parser/store.ts
- app/actions/parser-devices.ts
- app/api/internal/parser/evidence/route.ts
- app/api/internal/parser/heartbeat/route.ts
- app/dashboard/parser-devices/page.tsx
- components/parser-device-form.tsx
- scripts/test-phase-6.mjs
- tests/parser-protocol.test.ts
- docs/architecture/parser-device-management.md
- docs/architecture/parser-lifecycle.md
- docs/security/parser-key-management.md
- docs/security/parser-replay-protection.md
- docs/security/parser-pairing.md
- docs/api/internal-parser-api.md
- docs/android/parser-contract.md
- docs/phase-6-implementation.md

Modified:

- .env.example
- package.json
- README.md
- app/dashboard/layout.tsx
- scripts/test-phase-5.mjs
- docs/architecture/parser-protocol.md
- docs/architecture/overview.md
- docs/security/parser-signatures.md
- docs/security/security-model.md
- docs/database/parser-devices.md
- docs/database/parser-requests.md
- docs/database/migrations.md
- docs/database/rls.md
- docs/database/schema.md
- docs/compliance/operating-model.md
- docs/compliance/launch-gate.md
- docs/portfolio/project-case-study.md
- docs/portfolio/technical-skills.md
- docs/portfolio/engineering-decisions.md
- docs/phase-5-implementation.md

## Applied migration integrity

SHA-256 before/after matched for all six immutable migrations:

| Version | SHA-256 |
| --- | --- |
| 20260927072955 | 51CD36E1A0A7F72F5D43A0F1A67093CD3C69467200114726BBCC50F9B22D661C |
| 20260927082848 | 789C95B52F5B6F2852100E6BF820F78ADD14DA36597E56D49E29CC2D70159521 |
| 20260927090644 | 81C18D58E1FB2CBEC058BF4A8FC11E4D4CC08A7912C3E6BA56F12C9ACC421269 |
| 20260927165346 | A2E0D576D5FD90E7776CF2D15A6222B3263261830A14AC9C299962FCFA2ECF7C |
| 20260927173212 | 2285BD06C4AF7E4B3A4997EDE5CFE86C76369C617491ECBD101E834338F76F56 |
| 20260927180557 | E4545EE9651C1A74A656BC9DF5C16B982022864E18C009F6B08FAA8D300B56C2 |

New migration SHA-256:
`22349994A6CD827A8B6B16E718CA2FD507889014EBD25FB795E1EF0466EDF810`.
Native test PostgreSQL 18.4 is not hosted PostgreSQL 17.6; dry-run is not a hosted
migration execution or PostgREST integration test.
