# EkPay Phase 1: second migration review

Migration: `20260927082848_core_payment_security_infrastructure.sql`.

Prepared locally on 2026-09-27. **Not applied, committed or pushed.** No
production DDL/DML, service configuration changes, or webhook sends performed.
This infrastructure does not custody funds or create merchant wallet balances.

Files added: the second migration, this report,
`scripts/test-payment-security.mjs`, and `supabase/.gitignore` to exclude CLI
metadata/development branches. The already-applied first migration was present
as an untracked file at task start and remains unchanged.

## Live baseline (read-only)

Project `ysrvugmihzcfjxsmdxke`, PostgreSQL 17.6. Migration history contains only
`20260927072955`. All five core tables have RLS enabled and zero rows. Columns,
constraints, indexes, policies and the application helper definitions match the
first migration. The live schema also contains Supabase's managed
`rls_auto_enable()` event-trigger function; this is platform infrastructure, not
an application migration discrepancy.

Application membership helper: SECURITY DEFINER, empty search_path, qualified
membership table and auth.uid(), postgres owner, authenticated EXECUTE only.
No PUBLIC execute or membership write policy was found. It avoids recursive
membership RLS by looking up the calling user's membership as its owner.
No role-escalation path through membership DML was found.

Important live ACL difference from commonly assumed Supabase defaults: existing
tables grant `TRUNCATE`, `REFERENCES`, `TRIGGER` and `MAINTAIN` to anon,
authenticated and service_role, but not SELECT/INSERT/UPDATE/DELETE. Therefore
the permissive intent policies are a **latent** verification vulnerability if
DML grants are restored; they were not demonstrated as a current REST write
exploit. TRUNCATE privileges themselves are unsafe because RLS does not protect
TRUNCATE. The new migration explicitly resets privileges and grants only the
intended operations. API reachability was not tested using real credentials.

First migration SHA256 before and after:
`51CD36E1A0A7F72F5D43A0F1A67093CD3C69467200114726BBCC50F9B22D661C`.

## Risks and fixes

| First-migration finding | Second-migration change |
| --- | --- |
| Brand/account references can cross merchant boundaries | Composite unique keys and `(merchant_id, related_id)` foreign keys |
| Intent provider can differ from referenced account provider | Composite account/provider FK; account requires non-null provider |
| Intent INSERT permits arbitrary status; UPDATE permits marking verified | Remove both write policies and all client intent DML grants |
| Verified timestamp/state and authoritative transaction not linked | Timestamp check; intent guard requires transaction; transaction trigger updates intent atomically |
| Verified intent fields can be rewritten | Trigger rejects UPDATE/DELETE of verified intents |
| Encrypted account field covered by broad SELECT policy | Column SELECT excludes ciphertext and receiver identity hash; account writes server-only |
| Broad client table privileges including TRUNCATE | Revoke all PUBLIC/anon/authenticated privileges; explicit grants, no TRUNCATE |
| Multi-merchant admins could reassign brand tenant | Column INSERT/UPDATE excludes mutable merchant_id/id; delete grant removed |
| Brand/account ON DELETE SET NULL can erase payment context | Replace relationship FKs with RESTRICT; evidence/transaction history also blocks deletion |
| Tenant/status/time queries lack combined index | Add compound indexes for intents and new resources |
| set_updated_at has default PUBLIC execute | Revoke direct client execute; trigger remains usable |
| Platform event-trigger function has default PUBLIC execute | Conditionally revoke client execute without changing its managed body |

Existing amount > 0, bigint minor units, BDT and provider checks were already
appropriate and retained. Existing membership helper is retained, not replaced.
No new SECURITY DEFINER function is added. New trigger functions are SECURITY
INVOKER with empty search_path and qualified application tables; direct client
EXECUTE is revoked.

## Tables and isolation

Eight requested public tables: payment_evidence, payment_matches, transactions,
events, webhook_endpoints, webhook_deliveries, audit_logs, parser_devices.

Three justified helper tables:

- `public.parser_requests`: durable nonce/ingestion/message replay receipts.
- `ekpay_private.evidence_payloads`: encrypted raw payloads separate from public metadata.
- `ekpay_private.webhook_secrets`: encrypted versioned signing secrets separate from endpoints.

All tenant rows include merchant_id and a merchant FK. Related objects use
composite tenant FKs, including intent/evidence/match transaction relationships,
parser receipt/evidence identity, and delivery endpoint/event relationships.
Polymorphic event object references use an invoker trigger to validate tenant
ownership. New history uses RESTRICT, not cascading deletion. Tenant lookups
have merchant/time indexes and selected status/relationship indexes.

## RLS and authorization

RLS is enabled on every new table, including private tables. No anon privileges
are granted. Authenticated access always requires the live membership helper:

| Resource | Dashboard access |
| --- | --- |
| Intent, transaction, match, event | Members read only |
| Evidence | Members read selected metadata columns only |
| Provider account | Members read masked/configuration columns only; server manages writes |
| Brand | Members read; owner/admin insert/update safe columns |
| Membership/merchant | Members read; server manages writes |
| Parser device | Owner/admin read safe columns; server manages enrollment/rotation/revocation |
| Parser requests | No dashboard access |
| Audit | Owner/admin read; trusted server writes |
| Endpoint | Owner/admin/developer read; owner/admin insert/update URL/subscriptions |
| Delivery | Owner/admin/developer read; trusted server inserts completed attempts |
| Private payload/secret tables | No dashboard access |

Endpoint enabled/secret_version changes are server-only so enabling requires an
authorized provisioning flow. Endpoint DELETE is not exposed. Developer reads
support debugging integrations; viewers do not see endpoints/delivery bodies.
No authenticated writes to evidence, matches, authoritative transactions,
events, audits or delivery logs. History rejects UPDATE/DELETE even for its
owner through append-only triggers. Service role gets SELECT/INSERT on history,
UPDATE on mutable configuration, and no TRUNCATE. Superusers can still disable
triggers or change grants; this is normal privileged maintenance, not a client
security boundary.

Every future service-role API must validate the caller's merchant membership
and permitted role before writing. RLS cannot constrain service_role, so these
server-only paths are an explicit trust boundary. Account/device management
must require owner/admin; membership management needs its own owner-only design.

## Deterministic verification and duplicate prevention

Transactions require non-null normalized provider transaction IDs (uppercase
ASCII, digits, dot, underscore, hyphen; 1–128 chars). UNIQUE(provider,
provider_transaction_id) blocks reuse across tenants; no NULL escape. Intent,
evidence and match IDs also have one-use unique constraints. Concurrent attempts
serialize by locking the intent; unique indexes decide duplicate winners.
Providers' transaction-ID namespace guarantees must be confirmed before
production activation. The global key is intentionally conservative and could
reject a legitimate ID collision if a provider reuses IDs per account.

Transaction insertion requires a matched result with all five deterministic
flags. The DB independently compares intent/evidence/transaction amount,
currency, provider, account, transaction ID and source; checks receiver identity
hash against the active account; checks observed provider timestamp within the
intent's window and verification timestamp sanity. A manual source additionally
requires an owner/admin reviewer. No arbitrary score exists.

Successful INSERT atomically updates the intent and appends a sanitized
payment.verified event. Existing verified intents cannot be rewritten. Database
checks cannot establish whether a forged SMS actually came from a provider:
trusted ingress must authenticate devices/provider responses and validate the
matching algorithm. No ingestion or verification API has been implemented here.

## Parser replay and signature model

Devices have a public UUID, high-entropy enrollment-token SHA256 hash, a 32-byte
Ed25519 public key, key version, active/disabled/revoked status and lifecycle
timestamps. Private signing keys remain on devices. This avoids attempting to
verify HMAC signatures from an irreversible token hash. Public-key authenticity
and actual signature verification belong to trusted ingress.

Requests reserve a unique ingestion UUID, a unique (device,nonce), and a unique
(merchant,device,message_hash). Validate a canonical signed envelope containing
device public ID, key version, timestamp, nonce, ingestion ID and body hash before
inserting. The DB locks the device and rejects inactive/revoked devices, stale
key versions and timestamps outside a five-minute window. Evidence repeats the
active/key/freshness check and must reference the receipt with matching merchant,
device, ingestion and message hash. Retain receipts to preserve replay rejection.
Use a single server transaction for receipt+evidence+encrypted payload writes;
an intentional idempotent retry should return the existing result only after
re-authentication, never resend or overwrite history.

Evidence ingestion IDs are globally unique. A content hash is also unique per
merchant/account/source; different trusted sources may preserve observations of
the same payment, but the authoritative global transaction key prevents double
verification. Ingestion must canonicalize provider IDs, timestamps and identity
hashes before writing. Use keyed identity/message hashes to resist guessing
low-entropy account numbers/SMS data; hashing is not encryption.

## Sensitive data and webhooks

Encrypt raw evidence and webhook signing secrets in the server with authenticated
encryption (e.g. AES-GCM), with external key management and a non-secret key
reference. Neither raw SMS nor plaintext keys are represented in public tables.
SQL bytea/text types cannot prove ciphertext was encrypted correctly; server
implementation must enforce it. Provider account ciphertext remains restricted
by column privileges. Do not use SELECT * on column-restricted dashboard tables.

Signing requires recoverable webhook secrets, so ciphertext is used rather than
an irreversible hash. Secret versions and retirement timestamps support overlap
during rotation. Endpoints start disabled. The server must provision/validate the
secret before enabling, and snapshot the actual URL/key version for each attempt.
HTTPS is enforced syntactically, but the sender must enforce SSRF defenses at
connection time: reject internal/private/link-local destinations, re-check DNS,
limit ports, disable or validate redirects, and never put secrets in the URL.
SQL URL checks do not replace these protections. No network sends occur now.

Delivery rows are completed immutable attempts with attempt number, HTTP code,
bounded 1 KB response excerpt, duration, next retry and delivered_at.
Each attempt also references an existing encrypted signing-secret version.
Scheduler state/leases are a future worker responsibility; they are not mutable delivery
logs. Workers must redact excerpts, audit metadata, review reasons and event
payloads before inserting. JSON size checks do not detect sensitive contents.
Signed webhooks should bind event ID, timestamp and body; consumers should verify
signatures and deduplicate event IDs.

## Validation and remaining limits

- TypeScript: `npx tsc --noEmit`, exit 0.
- Lint: `npm run lint`, exit 0 after using ESM for the test harness.
- Local SQL: PGlite 0.5.8 PostgreSQL with pgcrypto; both migrations executed in
  a disposable in-memory database. The expanded adversarial suite passes. The fixture
  supplies auth.uid(), auth.users and Supabase roles; this is not a complete
  Supabase/PostgREST runtime or a multi-session concurrency test.
- Tests: `node scripts/test-payment-security.mjs <path-to-pglite-package>`.
  PGlite installed only in the OS temp directory; repository package files unchanged.
- Linked migration list: first migration aligned; second local-only.
- `supabase db push --linked --dry-run`: exit 0, lists only the second migration.
  This checks migration planning, not remote SQL execution or production readiness.
- First migration hash unchanged. New files remain untracked; nothing staged.
- Git tracked diff/check/stat are empty because all new artifacts and the existing
  supabase directory are untracked. New files are inspected with no-index diff
  and whitespace checks as well; no staging used to manufacture a tracked diff.

Before any approved application, recheck the live baseline. Adding the non-null
receiver hash and validating composite FKs/checks intentionally fails if existing
rows are incompatible; do not auto-backfill or repair production. Restrictive FKs
and indexes take locks; lock_timeout=5s and statement_timeout=60s abort rather than
wait indefinitely. A deployment with more data needs an explicit lock assessment.
Transaction is BEGIN/COMMIT; no concurrent index builds or remote application here.

Final adversarial review: [pre-apply review](database/pre-apply-review.md).
The unapplied migration now also requires account encryption-key references,
guards parser identity/key rotation/terminal revocation, tenant-scopes match
reviewers and validates audit targets/actors. API-key audit actors remain disabled
until a tenant-scoped registry is implemented. The original applied migration
is unchanged. Dedicated architecture/security/compliance/portfolio docs distinguish
implemented schema work from unimplemented runtime protections.

Remaining work: authenticated API handlers, provider-specific evidence authenticity
and parser algorithms, normalized ID namespace confirmation, key management,
account/device provisioning, signing/SSRF-safe webhook worker, retention policies,
and full Supabase integration/concurrency tests. API keys and the requested future
integrations are intentionally deferred. Merchant IDs, provider accounts, public
intent IDs, reference/idempotency keys and versioned events form their schema base.

References: [Supabase RLS and explicit grants](https://supabase.com/docs/guides/database/postgres/row-level-security),
[PGlite local PostgreSQL](https://pglite.dev/docs/), and
[current pgcrypto legacy-cipher notice](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes).
The design uses external authenticated encryption, not legacy pgcrypto ciphers.
