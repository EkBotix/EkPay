# Payment evidence

Phase 5 adds optional source_device_id/key version/source time/authentication method/
normalization version as a complete attestation bundle, scoped to source tenant/environment.
Existing Phase 4 fixtures remain NULL/unattested; no provenance is fabricated/backfilled.
Normal service-role INSERT is now revoked; only default-disabled synthetic ingestion RPC
inserts trusted evidence. Provenance and immutable receipts/events commit atomically.
Raw payload is not persisted. See [ingestion](../architecture/evidence-ingestion.md).
Earlier Phase 4 grant descriptions below are historical and superseded by this boundary.

Phase 4 extends existing evidence, not a duplicate table. Explicit environment is NOT
NULL with no default; composite merchant/environment/account/provider FK prevents mixing
namespaces. trust_state defaults untrusted, with synthetic as the only other value.
Only synthetic provider_api test rows are eligible for automatic verification.

Existing source/provider enums, positive integer BDT amount, optional normalized reference,
receiver/sender 64-hex hashes, provider timestamp, ingestion ID, message hash and parser
device/request constraints remain. Append-only triggers and message/ingestion uniqueness
remain; index(provider,provider_transaction_id) supports conservative conflict checks.

Authenticated members read safe columns plus environment/trust label under tenant RLS;
no INSERT/UPDATE/DELETE and no hashes/raw payload. Trusted servers can insert observations;
there is no public ingestion route. A synthetic test insertion records evidence_received
even if verification gate is disabled, without claiming a verified payment.

The NOT NULL migration intentionally fails on populated legacy evidence rather than
guess provenance/environment. Current read-only live baseline is empty; recheck before apply.
