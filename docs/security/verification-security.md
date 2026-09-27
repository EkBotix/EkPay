# Verification security

Phase 5 tightens evidence authority: direct service evidence/parser-request INSERT is
revoked; only a separate source-authenticated synthetic ingestion RPC persists normal
observations. [Ingestion security](evidence-ingestion-security.md) describes the attestation
boundary. Earlier Phase 4 direct trusted-server INSERT wording below is superseded.

One authoritative RPC, service_role EXECUTE only, SECURITY DEFINER with empty search_path
and fully qualified application objects. It derives tenant/environment from DB rows,
locks/re-reads merchant/account/intent/evidence and validates current state. No caller
tenant or actor ID parameter. PUBLIC/anon/authenticated execute revoked.

The additional narrow SECURITY DEFINER input trigger writes private serialization
bookkeeping only. No client execute grants, role change or business-state mutation.
Private policy/mutex tables have RLS and no client/service table privileges. Normal
service_role INSERT to transactions AND payment_matches is revoked; only RPC can write
authoritative decisions. Evidence remains trusted-server INSERT, not a client API.

Existing tenant RLS and safe column grants remain. Environment/trust labels are safe
evidence reads; receiver/sender/message hashes, device provenance, raw payloads and
account ciphertext remain restricted. No new TRUNCATE/REFERENCES/TRIGGER grants.
Browser uses user SSR client, never service-role credentials. No new public secret vars.

Events and system decision audits include IDs, environment, source, outcome, reasons,
rule and DB timestamp; no raw SMS/account credentials/API or parser secrets. A forced
late audit failure test proves no partial transaction, match, verified state or success
event. No webhook delivery worker exists. Database owner/superuser can bypass privileges
or alter policy/triggers and remains outside ordinary client threat model.

Remaining blockers: trusted real-source authentication, KMS/receiver canonicalization,
provider namespace proof, hosted Auth/PostgREST tests, independent review, distributed
limits, resource/lock-pressure monitoring and regulatory/provider authorization.
