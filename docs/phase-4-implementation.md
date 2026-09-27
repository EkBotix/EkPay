# Phase 4 implementation and pre-apply report

Historical report: Phase 4 is now applied (read-only verified 2026-09-28).
Current proposed changes/recommendation: [Phase 5](phase-5-implementation.md).
Earlier pre-apply inventory/grants below describe the historical Phase 4 state.

Review date: 2026-09-27. Development/pre-launch, synthetic/local/test only.
**APPLY RECOMMENDATION: PASS for the current empty baseline and disabled engine.**
This is schema review, not permission to activate real verification or launch.
No apply, commit, push, production data write, provider call, SMS ingestion,
customer payment verification, external webhook or BD21topup integration occurred.

1. Implemented deterministic normalized synthetic evidence, exact checks, immutable
   decisions, atomic authoritative records, stable replay, safe state machine,
   concurrency serialization, audit/events and actual verification detail reads.
2. New CLI-created migration: `20260927173212_synthetic_verification_engine.sql`.
   All four applied migration SHA256 fingerprints remain unchanged.
3. Created files:
   - `supabase/migrations/20260927173212_synthetic_verification_engine.sql`
   - `lib/verification/evidence.ts`
   - `tests/evidence-normalization.test.ts`
   - `scripts/test-phase-4.mjs`
   - `docs/phase-4-implementation.md`
   - `docs/architecture/payment-verification-engine.md`
   - `docs/architecture/payment-state-machine.md`
   - `docs/security/verification-security.md`
   - `docs/security/evidence-trust-model.md`
   - `docs/security/verification-concurrency.md`
   - `docs/database/payment-evidence.md`
   - `docs/database/payment-matches.md`
   - `docs/database/transactions.md`
4. Modified this phase:
   - `README.md`, `package.json`
   - `app/dashboard/payments/[id]/page.tsx`
   - `docs/phase-3-implementation.md` (historical status clarification)
   - `docs/architecture/payment-verification-flow.md`
   - `docs/database/migrations.md`, `docs/database/rls.md`
   - `docs/database/payment-intents.md`, `docs/database/schema.md`
   - `docs/api/payment-intents.md`, `docs/api/environments.md`
   - `docs/architecture/overview.md`, `docs/security/security-model.md`
   - `docs/compliance/operating-model.md`, `docs/compliance/launch-gate.md`
   - `docs/portfolio/project-case-study.md`, `docs/portfolio/technical-skills.md`,
     `docs/portfolio/engineering-decisions.md`
5. Live read-only inspection confirmed implicit live defaults on intents/accounts.
   Removing both defaults makes new trusted objects explicit. Existing values remain;
   no reclassification. New evidence/match/transaction env columns have no guessed backfill.
6. Strict server-only test normalizer uses actual schema names, hashes/UUIDs, integer
   BDT units, bounded uppercase reference and UTC time. Only fixture-label metadata;
   unknown/raw/secret/trust inputs rejected. Throws outside NODE_ENV=test. Not an ingress.
7. Matching records nine individual booleans, bounded reasons and immutable rule.
   Includes tenant/environment/account/hash/currency/time/trust/eligibility and reference use.
8. Verified: every check true, active merchant/account, synthetic provider_api test
   evidence, created/pending unexpired target, unused reference, no conflict/ambiguity.
9. Manual review: relevant conflicting/ambiguous/consumed reference, untrusted/manual
   source, already review state or missing provider timestamp. Never creates a transaction.
10. Failed: provider/amount/receiver/missing-reference mismatch; otherwise outside
    time or ineligible state. A wrong observation does not cancel a valid intent.
    no_match: nonexistent target; no fake FK match/audit. Unknown evidence/boundary errors deny.
11. Versioned strict zero-tolerance inclusive [creation,expiry] provider window,
    provider time <= DB clock and intent expiry > decision/insertion DB clock.
    Missing timestamp review; changes require a reviewed new rule, not client config.
12. Expected account ID AND receiver_identity_hash match active account. No plaintext
    receiver comparison; UI only masked account. Real canonicalization/KMS remains absent.
13. Existing global UNIQUE(provider,provider_transaction_id) preserved, plus unique
    transaction intent/evidence/match. Global provider namespace remains unconfirmed.
14. Service-only SECURITY DEFINER RPC writes match/transaction/intent/events/audit
    atomically. A forced late audit failure rolls all verification writes back.
15. Unique(intent,evidence,algorithm_version) returns original decision on retries;
    no duplicate transaction, verified event or decision audit. No in-memory lock.
16. Actual private revision writes serialize provider-reference and merchant predicates;
    evidence/intent triggers participate. READ COMMITTED refreshes after waiting;
    REPEATABLE READ/SERIALIZABLE abort stale writers with 40001; whole-transaction retry.
    Opposite direct-update lock order may produce 40P01, which must also abort/retry safely.
17. DB state trigger prevents failed/expired revival, review auto-approval and terminal
    transitions. Existing transaction-required verified guard remains; no cancelled enum.
18. Existing append-only transaction trigger blocks all normal UPDATE/DELETE; verified
    intent is fully immutable. No administrative recovery/reversal operation added.
19. Same-reference different facts and multiple plausible targets go to review.
    Identical duplicate observations cannot consume reference twice; never first-row choice.
20. Safe evidence_received/match_evaluated/manual_review_required/verification_failed
    and enriched verified events. System decision audit stores environment/IDs/source/
    outcome/version/reasons/DB timestamp, no hashes/raw SMS/credentials/secrets. Events
    record history only; no delivery. Missing-target no_match is an unpersisted lookup.
21. Rule: `ekpay-verification-synthetic-v1`, in matches, transactions, decision/success
    events and audits. Evidence_received is provenance, not an evaluated rule decision.
22. Dashboard safe SSR/RLS detail: masked account, expiry/reference/environment,
    actual evaluated evidence/source/time/check flags/reasons/version, transaction record,
    empty/error state and synthetic development labels. No fake data/approval buttons.
23. Fixtures: perfect, wrong amount/provider/account/hash, missing reference/time,
    stale/future time, expired target, ambiguity, conflict/duplicate reference, retry,
    cross-tenant/environment, live denial, manual/untrusted evidence and rollback.
24. Existing RLS preserved. Safe evidence env/trust read grants only; revoke service
    match/transaction INSERT. Private policy/mutex RLS with no client/service privileges.
    No unsafe TRUNCATE/REFERENCES grant, no browser service role, no new public secrets.
25. New SECURITY DEFINER functions: verify_payment_evidence(uuid,uuid) (service-only)
    and ekpay_serialize_verification_inputs() (trigger-only, no direct execute grant).
    Empty search_path, qualified application objects, PUBLIC/client execute revoked.
    Replaced validator/sync functions remain hardened SECURITY INVOKER.
26. Validation PASS: 9 unit tests; Phase 1 110 checks; Phase 2 39; Phase 3 74 plus
    real handler→Supabase JS loopback→PostgreSQL transport and idempotency races;
    Phase 4 235 checks. Owner-concurrency regression passed three isolation levels,
    including local reproduction of old lock-only bug and fixed guard restoration.
27. Phase 4: 33 genuine multi-session races (11 scenarios × 3 isolation levels).
    READ COMMITTED serializes/replays; attempts to expire/review verified winner fail
    23514. REPEATABLE READ/SERIALIZABLE stale writers fail 40001; fresh retries preserve
    at most one authoritative transaction. Rollback survivor succeeds. Conflict/candidate
    phantoms and ambiguity produce zero transactions. No partial/duplicate verified event.
28. `npx tsc --noEmit`, `npm run lint`, `npm run build`: PASS. Native DB is PostgreSQL
    18.4; hosted target is 17.6. Authenticated dashboard browser walkthrough was not run
    because no isolated hosted Auth environment/fixtures are configured; do not claim it.
29. Linked list: four applied versions 20260927072955, 20260927082848,
    20260927090644, 20260927165346; only 20260927173212 local/unapplied.
30. `supabase db push --linked --dry-run`: PASS, only new Phase 4 migration planned;
    no seeds/roles planned, no SQL applied. Dry-run is not hosted SQL validation.
31. Fresh live read-only inspection: PostgreSQL 17.6; merchants/accounts/intents/
    evidence/matches/transactions all zero; no intent state rows; new RPC absent.
    Current empty baseline is compatible. Recheck counts before apply; populated
    evidence/match/transaction history needs a separately reviewed provenance backfill.
32. `git diff --check` PASS; tracked diff/stat/status captured. Worktree already contained
    earlier uncommitted foundation: eight tracked modified files, and untracked app/docs/
    lib/scripts/migrations/tests. No files staged/committed/pushed. Normal git diff excludes
    untracked files; explicit whitespace checks cover Phase 4 files. CRLF conversion notices
    are Git warnings, not test failures. Stat is whole worktree, not Phase 4-only change size.
33. Unresolved risks: hosted 17.6/Auth/PostgREST parity, provider reference namespace,
    authenticated real-source provenance, receiver canonicalization/KMS, resource/lock
    pressure and private mutex retention, late contradictory evidence/disputes. Privileged
    DBA can bypass normal controls; service credentials remain a trusted security boundary.
34. Commercial launch remains blocked: qualified Bangladesh regulatory/legal review,
    merchant/provider authorization, privacy/retention/disputes, distributed rate limits,
    independent security review and operational controls. No approval/exemption claim.
35. Disabled: DBA verification gate (default false), public development API gate
    (default false), real SMS/provider ingestion, real payment verification, operator
    approval, external webhooks, funds/balances/settlement and BD21topup integration.
36. **PASS**, scoped to applying this additive migration against the rechecked empty
    baseline with gates disabled, subject to human review. This is not production launch
    or engine activation approval. No critical/high issue remains in the tested synthetic
    path; the above limitations remain explicit.

## Applied file integrity

| Applied filename | Unchanged SHA256 |
| --- | --- |
| 20260927072955_init_ekpay_core.sql | 51CD36E1A0A7F72F5D43A0F1A67093CD3C69467200114726BBCC50F9B22D661C |
| 20260927082848_core_payment_security_infrastructure.sql | 789C95B52F5B6F2852100E6BF820F78ADD14DA36597E56D49E29CC2D70159521 |
| 20260927090644_auth_merchant_bootstrap_api_keys.sql | 81C18D58E1FB2CBEC058BF4A8FC11E4D4CC08A7912C3E6BA56F12C9ACC421269 |
| 20260927165346_development_payment_intent_api.sql | A2E0D576D5FD90E7776CF2D15A6222B3263261830A14AC9C299962FCFA2ECF7C |
