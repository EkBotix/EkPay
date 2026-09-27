> Historical Phase 5 report. Its migration is now applied (six applied migrations).
> Phase 6 adds separate parser HTTP routes/lifecycle; see [current report](phase-6-implementation.md).

# Phase 5 implementation and pre-apply review

Review date: 2026-09-28. DEVELOPMENT / PRE-LAUNCH / SYNTHETIC ONLY.
**APPLY RECOMMENDATION: PASS for the rechecked empty baseline with all gates disabled.**
Human review required; this does not authorize engine activation or commercial launch.
No apply, commit, push, production data write, genuine SMS/provider/customer data,
real payment verification, external webhook or BD21topup connection occurred.

1. Implemented synthetic trusted-source authentication, Ed25519 raw-body signing,
   deterministic normalization, provenance, immutable receipt/evidence persistence,
   DB-backed replay/idempotency, separate verification handoff, safe UI and tests/docs.
2. New CLI-generated migration: `20260927180557_trusted_synthetic_evidence_ingestion.sql`.
   All five applied migration hashes remain unchanged. No earlier migration edited.
3. Created files:
   - `supabase/migrations/20260927180557_trusted_synthetic_evidence_ingestion.sql`
   - `lib/ingestion/protocol.ts`, `lib/ingestion/adapter.ts`, `lib/ingestion/ingest.ts`
   - `tests/ingestion-protocol.test.ts`, `scripts/test-phase-5.mjs`
   - `app/dashboard/evidence/page.tsx`
   - `docs/architecture/evidence-ingestion.md`, `docs/architecture/evidence-adapters.md`, `docs/architecture/parser-protocol.md`
   - `docs/security/evidence-ingestion-security.md`, `docs/security/parser-signatures.md`, `docs/security/replay-protection.md`, `docs/security/raw-payload-handling.md`
   - `docs/database/parser-devices.md`, `docs/database/parser-requests.md`
   - `docs/api/internal-evidence-ingestion.md`, `docs/phase-5-implementation.md`
4. Modified this phase:
   - `README.md`, `.env.example`, `package.json`
   - `scripts/test-phase-4.mjs`, `scripts/testing/postgres.mjs`
   - `docs/database/payment-evidence.md`, `docs/database/migrations.md`, `docs/database/rls.md`, `docs/database/schema.md`
   - `docs/compliance/operating-model.md`, `docs/compliance/launch-gate.md`
   - `docs/portfolio/project-case-study.md`, `docs/portfolio/technical-skills.md`, `docs/portfolio/engineering-decisions.md`
   - `docs/architecture/overview.md`, `docs/security/security-model.md`, `docs/phase-4-implementation.md`
   - `docs/security/evidence-trust-model.md`, `docs/security/verification-security.md`
5. Reused parser_devices as source registry, explicit tenant/environment/provider/account,
   source_type and is_synthetic. Only active test synthetic provider_api capability passes.
   Body cannot claim merchant/environment/source/account/trust; registry derives authority.
6. Server-only authenticateEvidenceSource checks registry/current version/signature/freshness;
   no concrete production store or HTTP transport. DB service-only RPC trusts server crypto
   attestation and independently rechecks current public-key hash/version/status/source scope
   and DB freshness under actual writes. DB does NOT itself verify Ed25519; service role/DBA
   remains privileged trust boundary. This limitation is explicit, not hidden by trust flags.
7. Synthetic Ed25519 public-key protocol works locally; real Android parser/provider adapters
   remain unimplemented. No signing private key stored server-side; fixture keypairs ephemeral.
   Legacy secret_hash is unused compatibility metadata, not a plaintext/shared-secret fallback.
8. Canonical UTF-8 LF lines + final LF: synthetic domain, timestamp_ms, nonce, lowercase public
   UUID, key_version, lowercase ingestion UUID, message_hash, SHA256(exact raw bytes).
   Every field/body is signature-bound; raw JSON order/whitespace changes require new signature.
   Future real protocol needs transport/domain/enrollment review; no current HTTP path exists.
9. Existing unique(device,nonce) retained; partial global primary ingestion ID uniqueness plus
   same-source/identity FK aliases retain fresh-nonce retries. No second replay table. Indexed
   message lookup replaces old receipt message uniqueness; evidence dedupe constraint remains.
   Freshness symmetric <=300s, checked again using DB clock after waits; outside-future/stale deny.
10. Strict known provider, positive safe integer amount, BDT uppercase, reference trim with
    uppercase synthetic grammar (case is preserved/rejected, never inferred), hash/UUID formats,
    explicit ISO time normalized UTC milliseconds. 4096 raw bytes; unknown/raw/secret fields deny.
11. normalization_version: `ekpay-evidence-normalization-synthetic-v1`.
12. Evidence source ID/key version/source timestamp/authentication method/normalization version;
    receipt raw-body digest/semantic fingerprint and DB received timestamp. Partial attestation
    bundles disallowed, environment-scoped source FK. Legacy fixture provenance stays NULL.
    No historic signatures/old public-key history retained; future forensic key-history design needed.
13. No raw payload persistence/KMS emulation/plaintext fallback. Existing private ciphertext
    model stays restricted; synthetic body exists only in local memory. No keys/raw SMS in logs.
14. Same source/ingestion ID/message hash/normalized fingerprint returns existing evidence.
    Exact nonce retry reuses receipt with no duplicate event/audit; fresh nonce adds a duplicate
    alias receipt. Changed semantic payload/source/message identity rejects 23505.
15. Same message/new ingestion ID stores receipt pointing to existing evidence if fingerprint
    agrees. Conflicting same message rejects; same provider reference/different messages remains
    independent observations for Phase 4 conflict review. Global transaction uniqueness unchanged.
16. Separate handoffSyntheticVerification needs both synthetic flags + Phase 4 DBA gate. Test
    evidence can verify; duplicate handoff returns original decision with one transaction.
17. Ingestion receipt/evidence/events/audit share one atomic commit; late audit failure rolls all
    back. Verification runs separately after commit; disabled/failed matching leaves evidence intact.
    No automatic delivery/retry worker. Rejected conflicts are errors, not persisted success events.
18. Revoked identities cannot ingest/retry/reactivate/reassign; monotonic key rotation/current
    key/version rejects stale attestations. Historical evidence remains immutable/auditable.
19. Actual ingestion-ID/message scope writes and source ingestion_revision UPDATE serialize
    replay and configuration races, including RR/SERIALIZABLE snapshots. Source revision is
    deliberate security bookkeeping; updated_at reflects activity; config audit skips revision-only
    updates. No trigger recursion. Whole-transaction retry for 40001/40P01, never blind success.
20. evidence.ingestion_accepted and evidence.duplicate_detected events + evidence.ingested
    source-actor audit. Source registration/revoke/rotate audit logged without key material.
    No raw payload/signature/secret/receiver hash in event/audit; conflicts return classified errors
    without an autonomous rejection audit. Existing Phase 4 evidence/verification events remain.
21. Dedicated evidence dashboard reads tenant RLS safe fields: environment/provider/amount,
    masked transaction reference, received/source time, source/key-version/auth/normalization,
    actual evaluated outcomes. No raw payload/ciphertext/signing keys; explicit empty/error/test
    labels. Lists cap 50 evidence/250 evaluations and show truncation notices.
22. Simple EvidenceAdapter.validateSource/normalize boundary; orchestration builds trusted
    context. Only SyntheticEvidenceAdapter. Real parser/provider-specific formats stay outside
    deterministic core verification; no actual MFS adapter invented.
23. EKPAY_SYNTHETIC_INGESTION_ENABLED=false and EKPAY_AUTO_VERIFY_SYNTHETIC_EVIDENCE=false,
    server-only + NODE_ENV=test. Separate DBA ingestion/verification policies default false,
    no service/client toggle, no flag enables live behavior.
24. Existing RLS preserved. Safe provenance read grants; revoke direct service evidence/request
    INSERT. Private ingestion policy RLS/no client/service grants. No new unsafe grants/public
    secrets/browser service role. Source config DML stays trusted-only, no client enrollment.
25. One new SECURITY DEFINER: ingest_synthetic_evidence(uuid,integer,text,timestamptz,text,
    uuid,text,text,jsonb), service-role EXECUTE only; empty search_path/qualified objects/
    PUBLIC-client execute revoked. New config-audit and replaced device-guard remain INVOKER.
26. PASS: 10 unit tests; Phase 1 110 checks; Phase 2 39; owner regression three isolations;
    Phase 3 74 + transport/idempotency races; Phase 4 235 + 33 races; Phase 5 150 checks.
    Full npm test completed successfully. Fixtures include bKash/Nagad, invalid shape/signature,
    source/version/time/environment/tenant mismatch, nonce/ID/message conflicts, rotation/revoke,
    replay/reorder, immutable provenance/private reads, atomic rollback and separate handoff.
27. Phase 5 24 real multi-session races: 8 scenarios × RC/RR/SERIALIZABLE. RC serializes;
    conflicting nonce 23505; revocation/rotation winner rejects stale ingest 42501. RR/SERIALIZABLE
    stale writes abort 40001; fresh valid retries safe. Rollback survivor accepts once. Concurrent
    two-source conflicting observations persist but create zero authoritative transactions;
    duplicate verification handoff produces exactly one. Actual pg_blocking_pids barriers used.
28. Typecheck/lint/build PASS. Native tests PostgreSQL 18.4, hosted 17.6; no hosted schema writes.
    Fixed Windows-only test cleanup: orphan fixture I/O workers held pipes after library force-stop;
    verified local workers stopped, disposable harness now io_method=sync. No production config
    change. Phase 4 race fixture explicitly uses DBA-only INSERT after Phase 5 service revocation.
    Authenticated hosted dashboard walkthrough is unvalidated (no isolated Auth fixtures).
29. Linked list: five applied through 20260927173212; only new 20260927180557 local/unapplied.
30. Linked dry-run PASS: only new Phase 5 migration, no seeds/roles, no SQL applied. Plan output
    does not execute new SQL on hosted PostgreSQL or prove hosted runtime parity.
31. Read-only live: PostgreSQL 17.6; merchants/accounts/evidence/devices/requests/transactions
    zero, Phase 4 verification policy disabled, Phase 5 RPC absent. Existing replay/FK constraint
    names verified compatible. Recheck before applying; populated source/request history requires
    separately reviewed mapping/backfill because new binding/environment NOT NULL columns fail.
32. git diff --check PASS; stat/status captured. Existing worktree remains eight tracked modified
    scaffold files plus untracked foundation app/docs/lib/scripts/supabase/tests. Whole tracked diff
    is 1551 insertions/116 deletions, not Phase 5-only size; untracked files excluded by Git diff.
    Explicit Phase 5 whitespace/conflict/link checks cover untracked files. Nothing staged/committed/
    pushed. Applied five SHA256 fingerprints unchanged. CRLF conversion notices are warnings only.
33. Remaining risks: true source provenance and compromised keys/device/service/DBA, hosted
    PostgreSQL/Auth/PostgREST parity, key-history/forensics, KMS/receiver/provider namespaces,
    replay retention/resource pressure/quotas and durable operational retries. Synthetic source
    signatures prove possession only; no claim of authentic SMS/provider origin or fraud guarantee.
34. Regulatory/pre-launch blockers remain: qualified Bangladesh legal/regulatory classification,
    required approvals/merchant-provider account authorization, privacy/consent/retention/disputes,
    limits/monitoring/security review. Software/non-custodial design does not establish exemption.
35. Disabled: public/real ingestion, Android/MFS adapters, real customer/payment data, real
    verification, live webhooks, BD21topup, raw storage/KMS runtime, operator approval, funds/
    balances/settlement and public commercial service. Both synthetic flags and DB policies OFF.
36. **PASS for human-reviewed additive migration against rechecked empty baseline with gates
    disabled.** No critical/high issue found in tested synthetic foundation. This is not launch,
    real-source deployment or ingestion/verification activation approval. Stop here for review.

## Applied history integrity

| Migration | Unchanged SHA256 |
| --- | --- |
| 20260927072955 | 51CD36E1A0A7F72F5D43A0F1A67093CD3C69467200114726BBCC50F9B22D661C |
| 20260927082848 | 789C95B52F5B6F2852100E6BF820F78ADD14DA36597E56D49E29CC2D70159521 |
| 20260927090644 | 81C18D58E1FB2CBEC058BF4A8FC11E4D4CC08A7912C3E6BA56F12C9ACC421269 |
| 20260927165346 | A2E0D576D5FD90E7776CF2D15A6222B3263261830A14AC9C299962FCFA2ECF7C |
| 20260927173212 | 2285BD06C4AF7E4B3A4997EDE5CFE86C76369C617491ECBD101E834338F76F56 |
