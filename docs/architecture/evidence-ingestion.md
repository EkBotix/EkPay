# Trusted evidence ingestion — synthetic foundation

TEST / INTERNAL / NOT PUBLIC API. No HTTP route exists. The only runnable transport
is `npm run test:phase5`, which starts its own disposable random-password loopback
PostgreSQL cluster. It accepts no remote database URL and enrolls synthetic fixture
sources only. Both server flags and a separate private DBA policy default OFF.
NODE_ENV=test is mandatory for the server-only orchestration functions.

Flow: signed raw bytes → source lookup → Ed25519 check → strict normalization →
service-only ingest_synthetic_evidence RPC → immutable evidence/receipt/event/audit
commit. Optional verification handoff is an explicitly separate call/transaction.
It requires its own server flag and Phase 4 DBA gate. Failed matching or disabled
verification cannot discard already accepted evidence; repeat handoff reuses the decision.
Caller must commit ingestion before attempting handoff; the local runner does so.

Registry reuses parser_devices for synthetic provider_api adapter identities, not an
Android/provider connection. Identity resolves merchant/environment/provider/account;
body cannot supply merchant_id, environment, source type, account override or trust state.
Registered source must be active, synthetic, test, provider_api, with current key version
and matching public-key hash. Merchant/account must also be active and correctly scoped.

The DB RPC trusts the service ingress's cryptographic attestation; it does NOT implement
Ed25519 itself. It independently rechecks source/key/freshness under an actual source-row
write. Direct service evidence/request INSERT is revoked. A stolen service key or DB owner
can bypass application signature verification; real rollout needs a reviewed deployment
boundary, credential isolation and independent security review. No application route invokes it.

States accepted/duplicate belong to ingestion receipts, not payment status. Invalid input,
unauthenticated source, conflict or replay is an error with no accepted evidence/receipt.
Reject diagnostics must contain only error class/IDs, never raw bodies/signatures/secrets.
Future real-source adapters, durable orchestration/retry queues, quotas and KMS remain absent.
