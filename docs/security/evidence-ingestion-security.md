# Ingestion security

Synthetic server-only pipeline; NODE_ENV=test AND explicit flag. Private DBA ingestion
gate defaults false; no service/client activation privilege. Live/non-synthetic/non-provider_api
sources are rejected even if gate enabled. No public/internal HTTP endpoint was added.

New SECURITY DEFINER ingest_synthetic_evidence has empty search_path, qualified application
objects, no PUBLIC/anon/authenticated execute, only service_role. No caller tenant/env trust.
DB source/key hash/version/status/account/freshness are checked under actual serialization
writes. Cryptographic signature verification happens in the trusted TypeScript ingress;
service-role RPC parameter is an attestation, not independent DB signature proof.

Direct service-role payment_evidence/parser_requests INSERT revoked; normal tenant/API-key
clients cannot insert or invoke RPC. Existing tenant RLS and sensitive column restrictions
remain. New evidence provenance is safe read metadata. Private raw ciphertext is inaccessible
to ordinary members. No new unsafe TRUNCATE/REFERENCES grants or NEXT_PUBLIC secrets.

Sources are tenant/environment/account-bound and cannot reassign. Revoked is terminal,
public-key changes require newer version, key-version rollback fails. Configuration changes
are system audit logged, excluding keys/signatures. Accepted evidence/receipts are append-only.
Late audit errors roll ingestion evidence/receipt/events back atomically.

Residual risks: compromised enrolled source/service role/DBA, actual-source authenticity,
hosted Postgres/Auth/PostgREST parity, replay retention and lock pressure, quotas, KMS,
receiver/provider namespace and operational response. These block real deployment, not waived
by synthetic tests. Engine still has separate default-disabled test-only gate.
