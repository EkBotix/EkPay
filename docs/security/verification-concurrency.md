# Verification concurrency

Private `verification_serialization(scope,revision)` provides actual INSERT/ON CONFLICT
UPDATE writes. A global SHA256(provider:transaction_reference) scope prevents concurrent
reference consumption/conflict-evidence phantoms; a merchant scope prevents candidate
intent insertion/state-change phantoms. Evidence INSERT and intent INSERT/UPDATE triggers
participate even outside the RPC. This deliberately changes bookkeeping only, not merchant
business timestamps. Gate does not suppress these consistency triggers.

RPC order: reference write → merchant write → intent FOR UPDATE → merchant/evidence/account
row locks. No mutex table triggers exist; intent synchronization re-touches the same scope
in its own transaction, without recursion. All writes release at commit/rollback.
READ COMMITTED waiters evaluate a fresh snapshot after the predecessor commits. REPEATABLE
READ/SERIALIZABLE stale writers receive 40001 instead of verifying old snapshots. A direct
intent update holds its tuple before the merchant trigger, so opposite lock order can yield
40P01; abort/retry the entire transaction with a fresh snapshot. Never retry inside an
aborted transaction or automatically infer success from errors.

The pair/rule unique constraint, unique intent/evidence/match transaction references and
global UNIQUE(provider,provider_transaction_id) remain final defenses. No transaction
reference may verify two intents. Namespace assumption is conservative and unconfirmed;
false-positive review is safer than silently weakening duplicate prevention.

Native PostgreSQL 18.4 tests use independent sessions and pg_blocking_pids barriers, not
timing-only sleeps. Three isolation levels cover duplicate workers, same evidence/two
targets, ambiguous targets, duplicate reference evidence, verification versus expiration/
review in both winning directions, rollback, newly inserted conflict evidence and candidate
phantoms. Hosted PostgreSQL 17.6 parity remains an isolated staging validation limitation.

Tradeoff: tenant-wide serialization reduces concurrency. Reference/tenant mutex entries
grow with history; retention and monitoring need a reviewed design before production.
Privileged manual bulk operations can deadlock and must fail/retry safely, never disable
triggers. Late contradictory evidence after commit needs a future dispute workflow.

References: [PostgreSQL isolation](https://www.postgresql.org/docs/current/transaction-iso.html),
[locking](https://www.postgresql.org/docs/current/explicit-locking.html).
