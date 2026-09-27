## Phase 6: synthetic parser identity foundation

Implemented owner/admin auth.uid()-controlled enrollment, hashed expiring one-time pairing,
Ed25519 proof of possession, global non-reassignable public-key history, exact key versions
and terminal revocation. Added method/path/raw-body-bound signed internal routes, durable
replay/idempotency, signed health metadata and safe tenant dashboard. Native multi-session
tests exercise stale-snapshot races. Development/pre-launch only; no Android/SMS readers
or real payment/provider integration.

# Phase 5 implemented foundation

Added synthetic source authentication, fixed-format Ed25519 signatures, monotonic revocation/
rotation checks, durable replay receipts/aliases and normalization provenance. Separate committed
ingestion and verification protect valid evidence from matching failures. Real multi-session races
test duplicate identities/messages, cross-source conflicts and configuration races. No real provider
adapter or commercial launch is claimed. [Current report](../phase-5-implementation.md).

Historical Phase 4 implementation follows.

Built an explainable synthetic transaction-evidence engine: strict normalization,
tenant/environment checks, exact amount/receiver/time rules, ambiguity review, atomic
authoritative record/event/audit and stable replay. Actual tuple-write mutexes protect
stale snapshots and candidate/evidence phantoms; real multi-session tests span three
isolation levels. This is development software, not a launched provider integration
or regulatory certification. Details/results: [Phase 4 report](../phase-4-implementation.md).

Earlier phase notes follow as historical context.

# EkPay: payment verification infrastructure case study

Phase 3 implemented: development-only Transaction Verification & Merchant
Automation Software API. Header-only HMAC verification, strict integer money/body
contracts, tenant/environment-scoped transactional idempotency, safe event/audit
projection and read-only verification dashboard. Native PostgreSQL sessions test
duplicate/conflict/rollback under three isolation levels; handler tests use a local
PostgREST-shaped transport adapter. Hosted runtime and commercial launch remain
unverified. See Phase 3 report and compliance launch gate; no approval/exemption claim.

Historical Phase 1/2 notes below:

Phase 2 update: Supabase Auth SSR/client/server split, password forms, PKCE callback,
merchant context, protected dashboard and scoped one-time API-key management are
implemented locally. Two Phase 1 migrations are applied; the new atomic bootstrap/
key/audit migration remains unapplied. Tests exercise HMAC material, validation,
RBAC, onboarding rollback, cross-tenant key metadata and terminal revocation.
No authenticated production walkthrough or live payment flow is claimed.

Problem: a multi-tenant payment platform must distinguish customer claims from
trusted evidence, preserve merchant isolation and prevent duplicate verification
while merchant funds flow directly to their provider accounts.

Implemented development work: initialized Next.js/React/TypeScript application;
five-table Supabase core migration applied; an unapplied transactional infrastructure
migration with evidence/matches/transactions/events, webhook/audit/parser storage;
tenant composite FKs, RLS/column grants, immutable histories and replay constraints.
An in-memory PostgreSQL test harness executes both migrations with synthetic
roles and adversarial fixtures. Read-only live inspections and CLI dry-runs
separate production facts from proposed schema.

Review outcomes: hardened parser version/revocation lifecycle, added account
encryption-key provenance, validated audit targets/actors and documented explicit
provider-ID and webhook-delivery assumptions. Detailed evidence is in the
[pre-apply review](../database/pre-apply-review.md).

Not delivered: functioning checkout/verification API, provider integrations,
Android parser, webhook sender, production encryption, SDKs or compliance program.
The case study demonstrates database/security engineering and API architecture
planning, not production transaction volume, customer adoption or fraud-prevention
performance. Portfolio screenshots/data must remain synthetic.
