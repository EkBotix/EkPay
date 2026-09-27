# Phase 2 implementation review

Historical implementation report. As of Phase 3 read-only inspection on
2026-09-27, this third migration is remotely applied. Unapplied statements below
describe its original review state; do not edit any of the three applied files.

Implemented: public/server SSR clients, isolated server-only privileged client,
cookie refresh proxy, password auth pages/actions/PKCE callback, confirmed-user
authorization, atomic first-merchant bootstrap, active merchant switch/context,
protected dashboard sections, owner/admin key creation/revocation and atomic audits.
The new migration is local/unapplied. This is application foundation, not production
payment processing. Phase 1's two migrations were confirmed remotely applied.

Read boundaries remain user SSR/RLS; secrets/hash fields excluded from queries.
Service role is used only after user/member/role checks for narrow key RPCs.
Key secret has 256 random bits and complete-credential HMAC-SHA256; DB stores hash
only, UI displays it once, lists/audits omit it. Owner/admin manage, developer reads,
viewer denied. Membership is read-only with DB last-owner protection.

Runtime configuration: NEXT_PUBLIC_SUPABASE_URL,
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY,
API_KEY_HASH_SECRET, APP_ORIGIN. Future placeholders: KMS_KEY_REFERENCE,
WEBHOOK_SIGNING_VERSION. No actual credentials are added. .env.example is explicitly
unignored; local secret files remain ignored.

Risks/limits: third migration needs human review/apply; live Auth/email settings and
authenticated browser walkthrough not verified; no application auth rate-limit,
MFA/re-auth/quotas yet; provider encryption and key/hash rotation plans pending;
local concurrency tests use PostgreSQL 18.4 rather than the hosted runtime; no API-key
authentication middleware, payment processing, provider writes, parser ingestion,
webhook sends, wallet, BD21topup/WooCommerce/WHMCS live integration or real-money tests.

Apply recommendation is limited to additive DB foundation after validation and
review, not a product launch endorsement. Audit/RLS baseline is inspected read-only;
no remote writes, commits, pushes, resets, repairs or service changes performed.

## Validation results

All four unit tests, 110 Phase 1 DB checks and 39 Phase 2 DB checks PASS.
TypeScript, lint (no warnings), and production build exit 0. Linked migration list
shows the first two aligned and the third local-only; linked dry-run exit 0 lists
only `20260927090644_auth_merchant_bootstrap_api_keys.sql`. No SQL was applied.

Browser verification: home/login/signup render; mobile signup at 390px has no
horizontal overflow; no error overlay/browser error log; protected developer
route redirects to login when configuration/session is unavailable. Production
HTTP checks confirm private,no-store headers for login/signup/protected redirects/
callback, and DENY frame header. Development cache headers differ as expected.
Authenticated UI/real Auth email operations remain unverified, not implied PASS.
Local dev emitted a Windows Watchpack EINVAL on D:\System Volume Information;
it did not prevent rendering or the successful production build. Local servers
and the isolated verification browser were stopped after checks.

Browser bundle scan found no service-role/HMAC configuration references or key
generation/privileged-client code. Application source has no console logging of
credentials. This is a static boundary check, not a comprehensive secret audit.
Tracked git diff/check/stat reviewed; new artifacts checked separately without
staging. Eight tracked files changed; other phase artifacts remain untracked.
Both applied migration files remain unchanged. No commit or push.

Apply recommendation: **PASS for this reviewed additive schema migration against
the currently empty merchant/member baseline, after human approval**. This is
not a production launch recommendation. Live read-only inspection confirms the
two earlier versions, absence of api_keys, zero merchants/members/ownerless tenants,
and required Auth columns. Recheck live state immediately before any later apply.
Local SQL fixtures do not replace hosted Supabase/PostgREST testing.

## Last-owner concurrency correction before apply

The original trigger only locked the parent merchant. A real two-session
REPEATABLE READ regression control reproduced both owners being demoted and both
transactions committing, leaving zero owners. The migration remains unapplied;
only its last-owner trigger body was corrected, with no new migration and no
changes to the two applied migrations.

Before removing/demoting an owner, the trigger now executes a tenant-scoped
`UPDATE public.merchants SET updated_at=updated_at WHERE id=OLD.merchant_id`.
PostgreSQL creates an actual tuple version even for equal-value assignments.
The existing merchant timestamp trigger sets updated_at to the transaction time:
merchant configuration timestamps now also reflect successful owner removal or
demotion. No merchant identity, name, status or other business field changes.
The owner-existence check follows this write in the same transaction. Any failure
rolls back both the merchant touch and membership mutation.

READ COMMITTED: competing owner removals serialize on the parent write; the
waiting trigger's subsequent query sees the committed owner change and rejects
the last removal with 23514. REPEATABLE READ and SERIALIZABLE: the parent write
conflicts with the newer tuple and the stale transaction fails with 40001.
Callers must abort the whole failed transaction; any later retry must reauthorize
and rerun the invariant check. Deadlocks/timeouts also abort safely, never bypass
the invariant. Ordinary clients still lack membership and merchant write grants;
owner/admin key authorization and all function ACLs remain unchanged.

The existing merchants_set_updated_at trigger only edits NEW.updated_at; it never
writes memberships. There is no recursion. The membership guard remains SECURITY
INVOKER with empty search_path, qualified application references and revoked PUBLIC
execute. No privilege widening or new SECURITY DEFINER function was introduced.

`npm run test:concurrency` starts an isolated, temporary loopback PostgreSQL 18.4
cluster (no remote URL accepted), executes all three migration files locally,
and uses distinct sessions with service_role membership mutations. A third session
checks pg_blocking_pids to prove overlap rather than relying on a sleep. Results:

- Old lock-only REPEATABLE READ bug reproduced; fixed function restored locally.
- READ COMMITTED demotion/deletion: PASS, one commit and one 23514 rejection.
- REPEATABLE READ demotion/deletion: PASS, one commit and one 40001 rejection.
- SERIALIZABLE demotion/deletion: PASS, one commit and one 40001 rejection.
- All three isolation levels, first transaction rollback: PASS, second succeeds,
  final state retains one owner.
- Single last-owner deletion/demotion blocked; two-owner single demotion allowed;
  rollback restores both owners: PASS.

The pinned embedded-postgres and pg development dependencies provide native
PostgreSQL binaries and session connections. Their platform installation scripts
must be enabled; run under a normal non-root OS user. Cluster is stopped and its
verified temporary directory removed after tests. No local/live Supabase migration
history is changed. The concurrency suite is included in npm test.

Post-fix validation: four unit tests, 110 Phase 1 checks, 39 Phase 2 checks and
native PostgreSQL concurrency suite PASS; typecheck, lint and build PASS.
Linked migration list retains only the first two remote versions; dry-run lists
only the corrected Phase 2 migration. Apply recommendation: PASS for this
concurrency correction and additive foundation after human review, not launch
approval; hosted Auth/PostgREST walkthrough remains outstanding.

Files changed for this correction: the unapplied Phase 2 migration, this report,
scripts/test-owner-concurrency.mjs, package.json and package-lock.json.

## Exact files created in Phase 2

```text
.env.example
app/actions/api-keys.ts
app/actions/auth.ts
app/actions/merchant.ts
app/auth/callback/route.ts
app/dashboard/[section]/page.tsx
app/dashboard/error.tsx
app/dashboard/layout.tsx
app/dashboard/loading.tsx
app/dashboard/page.tsx
app/login/page.tsx
app/onboarding/page.tsx
app/signup/page.tsx
components/api-key-form.tsx
components/auth-form.tsx
components/onboarding-form.tsx
lib/merchant-context.ts
lib/security/api-key.ts
lib/supabase/admin.ts
lib/supabase/client.ts
lib/supabase/config.ts
lib/supabase/server.ts
lib/validation.ts
proxy.ts
scripts/test-phase-2.mjs
scripts/test-owner-concurrency.mjs
tests/security.test.ts
supabase/migrations/20260927090644_auth_merchant_bootstrap_api_keys.sql
docs/architecture/authentication.md
docs/architecture/merchant-onboarding.md
docs/architecture/dashboard.md
docs/api/api-keys.md
docs/api/authentication.md
docs/security/api-key-security.md
docs/security/auth-security.md
docs/security/authorization-model.md
docs/database/api-keys.md
docs/phase-2-implementation.md
```

## Exact files modified in Phase 2

```text
.gitignore
README.md
app/globals.css
app/layout.tsx
app/page.tsx
next.config.ts
package.json
package-lock.json
scripts/test-payment-security.mjs
docs/architecture/overview.md
docs/database/migrations.md
docs/database/rls.md
docs/portfolio/project-case-study.md
docs/portfolio/technical-skills.md
docs/portfolio/engineering-decisions.md
```

The first two migration files and earlier Phase 1 artifacts were already untracked
at task start; git status therefore includes them without implying Phase 2 edits.
The Phase 1 test runner now resolves the pinned repository PGlite dependency.

## Added functions and audit/RLS decisions

New SECURITY DEFINER functions: bootstrap_merchant(text,text),
create_merchant_api_key(uuid,uuid,uuid,text,text,text,text,text[],timestamptz),
revoke_merchant_api_key(uuid,uuid,uuid). Empty search_path, schema-qualified objects,
PUBLIC execute revoked and narrowly granted authenticated/service_role as documented.
First derives auth.uid(); service-only key RPCs receive the verified-server actor
and independently validate active tenant/owner-admin membership under locks.
No arbitrary service-role proxy is exposed. Create/revoke are atomic with trusted
audit writes; idempotent revoke emits only one audit row.

New invoker guards enforce last-owner preservation and immutable key identity/
terminal revocation. Existing audit validator gains tenant-validated API-key targets/
actors. Existing table RLS is unchanged. New key metadata is owner/admin/developer
readable, hash is restricted, and direct key writes are unavailable to all normal
client roles and service_role. Provider/team/webhook UI remains read-only.
