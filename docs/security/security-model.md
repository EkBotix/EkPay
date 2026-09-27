## Phase 6 parser boundary

Authenticated management derives verified auth.uid() owner/admin; service credentials
never enter browser. Safe metadata column grants replace broad device SELECT; receipt
reads are unavailable to members. Pairing tokens are hashed, expiring/single-use; keys
are globally non-reassignable. Test-only TS verifies crypto; SQL trusts service attestation
and independently serializes/rechecks current status/key/binding. Hosted crypto admission,
limits, Android/private-key storage and real-source provenance remain launch blockers.

# Current Phase 5 status

Five migrations applied; synthetic-ingestion migration unapplied. Source signing/normalization
is server-only, no HTTP route, private policies default disabled. DB source/key/replay checks
supplement trusted ingress Ed25519 verification; service role/DBA remain trusted boundaries.
See [ingestion security](evidence-ingestion-security.md). Earlier phase statements are historical.

Four core migrations are applied; fifth synthetic verification migration is unapplied.
Service-only authoritative RPC, default-disabled private DBA policy, explicit test-only
engine, immutable results and real concurrency tests are implemented. No public evidence/
verification route. [Verification security](verification-security.md) describes the current
grants/threat boundary. Earlier phase status/counts below are historical.

# Security model

Status: DB controls implemented in an unapplied migration and tested locally.
No live customer payment pipeline, signing sender or production parser exists.

Threats include cross-tenant references, forged browser confirmation, stolen
parser credentials, replay/duplicate credit, configuration privilege escalation,
webhook SSRF, sensitive payload leakage and privileged-backend mistakes.

Database boundaries: tenant FKs/checks, member-scoped reads, limited column grants,
trusted-only evidence/history writes, append-only triggers, replay unique keys,
locked transaction validation and atomic intent/event updates. No score-only
verification or client-supplied verified status is accepted.

Trust boundaries still requiring implementation: API authorization before
service_role use; provider response authenticity; device enrollment/signature
verification; normalized identity/ID parsing; KMS encryption; egress controls;
rate limits and operational monitoring. A parser signature proves which enrolled
device sent bytes, not that those bytes originated from a provider. Device
compromise remains a risk and may require API corroboration/manual review.

Do not log raw SMS, tokens, ciphertext keys or full provider responses. Redact
free-form event/audit/review/response fields before writing. Restrict production
administration and rotate/revoke compromised credentials. DB owner maintenance
can bypass normal invariants and must be independently reviewed.

No certifications, regulatory approvals, guaranteed fraud prevention or
exactly-once external delivery are claimed. See [pre-apply review](../database/pre-apply-review.md).
