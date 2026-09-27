# TEST / INTERNAL / NOT PUBLIC API

There is NO POST /api/internal/test/evidence endpoint. Safer architecture is an isolated
local script: npm run test:phase5, which always creates its own loopback synthetic database.
No remote URL input, merchant/API-key/browser access, real credentials or real provider calls.

Server-only functions authenticateEvidenceSource, ingestSyntheticEvidence and separate
handoffSyntheticVerification accept an IngestionStore boundary. The only concrete store
adapter lives in the disposable test runner. No production HTTP transport is implemented.
NODE_ENV=test + EKPAY_SYNTHETIC_INGESTION_ENABLED=true are required; handoff additionally
requires EKPAY_AUTO_VERIFY_SYNTHETIC_EVIDENCE=true. Both default false. DB-owner ingestion/
verification policies independently default disabled and service role cannot toggle them.

Signed envelope and body: [protocol](../architecture/parser-protocol.md),
[normalization](../architecture/evidence-adapters.md). No caller merchant/environment/source
override. SQL RPC derives authority from registry and trusts only server cryptographic attestation.
Response state accepted/duplicate, evidence_id, request_id, reused; payment outcome belongs to
separate verification. Invalid/replay/conflict errors do not imply accepted evidence.
No automatic live handoff, retry worker, raw payload logging or notification sender exists.
