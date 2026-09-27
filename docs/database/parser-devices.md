# Parser device registry — Phase 6 (unapplied)

Reuses existing Phase 5 explicit merchant/environment/provider/account/source binding and
ingestion_revision. New pending_pairing/active/revoked lifecycle, nullable signing key/
legacy secret_hash, version 0 pending, display_name, created_by, paired_at,
management_revision, last_authenticated_at and bounded app/Android/model/locale/timezone,
protocol_version=1. Active requires paired_at/key/version>0; revoked_at equivalence retained.

Identity and creator never change. Rotation requires new key and exactly next version;
terminal revoked state is DB-enforced. New private parser_policy defaults off; private
pairing token hashes and global immutable key fingerprint history have RLS and no client/
service table grants. History preserves retired key claims and prevents any reassignment.

Safe column-only member SELECT (owner/admin/developer/viewer) with tenant RLS; public keys,
legacy hashes and revisions excluded. No anon/authenticated writes; service direct device
INSERT/UPDATE/DELETE revoked. Authenticated register/issue/revoke RPCs derive auth.uid()
and require verified owner/admin. Service-only consume/heartbeat RPCs trust prior TS proof/
signature attestation, rechecking all DB-controlled facts. No unsafe grant additions.

Actual management/ingestion source writes serialize races; receipt health trigger updates
the parent device inside the admitting transaction without recursion. Config changes remain
audited and explicit lifecycle events omit secrets. See [lifecycle](../architecture/parser-lifecycle.md).
