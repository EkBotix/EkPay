# Adversarial pre-apply security review

Reviewed 2026-09-27. Recommendation: **PASS for applying this infrastructure
migration to the verified empty baseline after explicit approval; FAIL for
activating real payment ingestion or webhook sending today.** No apply, commit,
push, production mutation, reset or repair was performed. Recheck live data
immediately before any later approved apply.

Migration: `20260927082848_core_payment_security_infrastructure.sql`.
First migration remains unchanged; SHA256 is recorded in [migrations](migrations.md).

## New findings and corrections in the unapplied migration

| Finding | Correction/evidence |
| --- | --- |
| Provider account ciphertext lacked explicit key provenance | Required account_encryption_key_reference; hidden from dashboard; synthetic fixtures updated |
| Signing key/token could change without version advance; version could roll back | Invoker device guard requires increasing version for key/token changes, rejects rollback, stamps rotation |
| Revoked credentials could be reactivated | Terminal revoked status; new enrollment required |
| Device UUID/tenant/public identity could change through trusted UPDATE | Device guard rejects identity reassignment |
| Audit target and actor UUIDs could name another merchant's objects | Allowlisted typed target validation, user/device tenant checks on INSERT; future api_key actor disabled until registry exists |
| Match reviewer FK was only auth-global | Composite merchant/reviewer membership FK; manual verification also requires owner/admin |
| Documented requested test command required a hidden positional argument | Runner now supports no-argument temp-package discovery, env override and explicit path |
| Global provider ID semantics unproven | Keep conservative global unique key explicitly as policy assumption; conflicts require trusted review, no silent scope weakening |
| Webhook attempt uniqueness can be mistaken for send deduplication | Document atomic queue/lease/fencing and consumer dedup requirements; sender still absent/disabled |
| Encryption/SSRF/signature designs could be mistaken for deployed features | Dedicated docs distinguish schema controls from unimplemented application protections |

First-review fixes remain intact: composite tenant/provider FKs, no client intent
verification writes, safe column grants, revoked TRUNCATE/default privileges,
append-only triggers and atomic intent/event synchronization. No new SECURITY
DEFINER function is introduced by this review.

## Tenant/FK and NULL review

All tenant tables have non-null merchant IDs. Brands/accounts/intents, matches,
transactions, parser receipts/evidence, payloads, secrets and delivery endpoints/
events use composite ownership FKs. Delivery secret version is transitively tied
to its same-merchant endpoint. Transaction match FK includes intent and evidence
IDs, so unrelated same-merchant matches cannot be substituted. Reviewer membership
is also tenant-scoped. Event/audit polymorphic objects are validated on append.

Optional brand/account references do not allow another tenant's non-null ID.
Non-null account requires provider. Authoritative intent/evidence/account/match
fields cannot be NULL. SMS source requires both device and receipt, preventing a
partial-null composite FK bypass. Manual/provider_api evidence must not carry a
parser receipt. Missing review metadata is allowed for automatic matching, but
manual verification requires an owner/admin reviewer. Audit references are
historical logical identifiers; log before deleting/removing targets/members.

## RLS, table/schema/sequence/function grant review

Live helper verified again: postgres owner, SECURITY DEFINER, empty search_path,
qualified membership/auth lookup, authenticated EXECUTE only. It cannot query as
an arbitrary caller user. Client membership mutation is unavailable; no escalation
or policy recursion path found. Live public schema grants no client CREATE;
there are no application sequences. New schema uses UUIDs and introduces none.

Migration revokes PUBLIC/anon/client broad table privileges, including TRUNCATE,
REFERENCES, TRIGGER and MAINTAIN. Explicit column grants protect account ciphertext,
receiver/token hashes and key references. Private schema/table access is not
available to clients. Trigger RPC execution is revoked. Read/write role matrix
is in [RLS](rls.md). Local catalog assertions also inspect unexpected privileges.
Service-role synthetic fixtures successfully ingest and verify, update devices
and atomically produce events; server authorization is still a required API boundary.

## Verification and concurrency

The transaction trigger independently compares merchant, provider, amount, currency,
account/receiver hash, provider ID, source and provider timestamp. Only eligible
intents, matched five-flag results and active accounts qualify. Unique intent,
evidence, match and provider transaction identities prevent duplicate records;
verified intent/transaction/history mutation is rejected.

| Race | DB outcome or remaining requirement |
| --- | --- |
| Same SMS/content twice | Unique message/ingestion constraints reject duplicates |
| Concurrent nonce replay | Unique(device,nonce) permits one receipt |
| Same payment, two intents | Global provider ID and evidence one-use constraints permit one transaction |
| Two verification attempts for one intent | Intent FOR UPDATE serializes attempts; second sees ineligible verified status |
| Device rotation/revocation during ingestion | Device FOR SHARE lock serializes against config UPDATE; post-update requests fail |
| Two webhook workers | Attempt uniqueness protects history only; future atomic job claims/leases required before sending |

These are SQL lock/index arguments plus sequential adversarial tests. PGlite
does not establish real multi-session race coverage. No exactly-once network
delivery claim is made. Roll back failed writes; do not blindly retry ambiguous
financial verification or external sends.

## Live-data compatibility

Read-only inspection returned zero merchants, members, brands, accounts and
intents. Cross-merchant account/brand/intent links, provider mismatch, verified
timestamp inconsistency and invalid expiry counts were all zero. The first
migration alone is applied; the transactions table/private schema do not exist
remotely, so there is no authoritative transaction data to deduplicate. Existing
accounts cannot violate new required hash/key-reference fields because there
are no accounts. This is a current snapshot, not a promise about later inserts.

## Remaining runtime risks and apply boundary

Global provider transaction namespaces and canonical ID formats are unconfirmed
for all four providers. Fail-closed conflicts may deny valid payments; confirm
contracts before real verification and do not expose other tenant identifiers.
Provider authenticity and matching algorithms remain future implementation.
Ed25519 length checks do not prove valid keys or verified signatures. A compromised
enrolled device can fabricate message content. Signature verification, enrollment,
rate limiting and KMS encryption are not implemented.

Webhook SQL HTTPS checks do not block private/metadata addresses or DNS rebinding.
No sender exists; detailed required safeguards and proposed limits are in
[webhook security](../security/webhook-security.md). Workers must stay inactive
until sender/queue/authorization controls are implemented and tested.
Retention/erasure, hash-key rotation and replay tombstone policies remain drafts.
Matched-review member RESTRICT references intentionally preserve provenance;
membership removal may need an explicit historical-review/offboarding design.

## Validation and artifacts

The executable local suite checks migrations, grants, cross-tenant references,
client forgery, verification invariants, replay/lifecycle, secret exposure,
delivery provenance and immutability. See [migration validation](migrations.md)
for reproducible commands and temp dependency installation. TypeScript, lint,
linked list/dry-run and whitespace checks must be reported with this review's
actual results; dry-run never substitutes for remote SQL execution.

Results from this review: **110 local checks PASS**, no-argument test command
exit 0; TypeScript exit 0; lint exit 0; linked list shows first aligned and second
local-only; linked dry-run exit 0 lists only the second migration. Tracked
git diff/check/stat are empty because artifacts are untracked; changed-artifact
no-index checks pass. An initial no-index check with autocrlf disabled treated
the unchanged first migration's CRLF terminators as trailing whitespace; it was
not rewritten. Changed-file checks respect CR-at-EOL. Status remains untracked
docs/scripts/supabase, with nothing staged.

Updated: proposed migration, test runner and phase-1-security-migration.md.
Created: architecture overview/payment-flow/multi-tenant-design; database
schema/rls/migrations/this review; security model/parser/webhook/encryption docs;
three compliance drafts and three portfolio docs. No application, package,
first-migration or deployment configuration changed.
