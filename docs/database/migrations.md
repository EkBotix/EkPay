## Current Phase 7 (2026-09-28)

Seven migrations through 20260927184731 are applied and immutable, confirmed read-only.
Phase 7 creates no migration/schema change. All parser/ingestion/verification policies
remain OFF; devices/receipts empty. Dry-run reports remote up to date, no pending migration.
See [Phase 7 report](../phase-7-implementation.md).

## Historical Phase 6 review

Six migrations through 20260927180557 are applied and immutable. The only unapplied
file is 20260927184731_parser_device_lifecycle.sql, generated using Supabase CLI.
It requires empty parser_devices AND parser_requests, refuses guessed backfill, and adds
lifecycle/key/token/health protections and narrow RPC grants in one transaction.
Read-only live inspection on 2026-09-28 confirms PostgreSQL 17.6 and both tables empty.
Private policies remain disabled. Dry-run does not execute SQL. Local PostgreSQL 18.4
validation and [Phase 6 report](../phase-6-implementation.md) govern the current recommendation.

## Historical Phase 5 and earlier review snapshots
# Migration workflow

Current Phase 5: five migrations through 20260927173212 are applied and immutable.
New unapplied 20260927180557_trusted_synthetic_evidence_ingestion.sql adds source binding,
provenance, durable retry aliases and disabled service-only ingestion RPC; revokes direct
service evidence/request INSERT. Source/request NOT NULL columns require current empty
baseline; populated history needs separate reviewed provenance mapping, never guessed backfill.
See [Phase 5 report](../phase-5-implementation.md). Earlier review details below are historical.

Read-only verified on 2026-09-27: applied versions 20260927072955,
20260927082848, 20260927090644 and 20260927165346. These four files are immutable history.
Phase 1/2 pre-apply reports are historical snapshots.

New unapplied: 20260927173212_synthetic_verification_engine.sql, created with
Supabase CLI migration new. Removes live defaults on intents/accounts, adds explicit
evidence/match/transaction environment FKs, match flags/reasons/rule, private disabled
policy/serialization tables, deterministic RPC, state guard and safe verification events.
Direct service-role match/transaction INSERT is revoked; no client write grants added.

Live inspection found zero merchants, intents, evidence, matches and transactions.
Phase 3's live defaults are removed; omission must fail rather than classify new data live.
New evidence/match/transaction NOT NULL columns deliberately fail on populated history;
no automatic environment/trust backfill or silent repair is allowed.
Composite FKs and unique references must validate all rows if state changes.
Recheck live counts, constraints, grants and versions before approved apply.

Transactional BEGIN/COMMIT, 5-second lock timeout and 60-second statement timeout.
Index/constraint DDL needs a fresh lock/capacity review if the database grows.
Dry-run is a plan, not remote SQL execution. No reset, repair, automatic apply,
commit or push is authorized. Keep public API gate off during review.

Validation: npm test (unit/PGlite/native PostgreSQL concurrency), typecheck, lint,
build, migration list --linked, db push --linked --dry-run, git diff --check/stat/status.
Native PostgreSQL 18.4 local tests do not replace hosted PostgreSQL 17.6/PostgREST
checks. Real hosted auth/email, rate limiting and legal launch gates remain separate.
