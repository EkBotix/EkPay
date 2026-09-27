# API-key schema and migration

Applied migration: `20260927090644_auth_merchant_bootstrap_api_keys.sql`, read-only
verified during Phase 3. All three applied files are immutable. Phase 3 adds
default-disabled runtime Bearer authentication and API RPC expiry/status checks;
see [intent schema](payment-intents.md). Historical design notes follow.

api_keys includes UUID/merchant/name/prefix/hash/hash-version/environment/abilities,
active/revoked status, last_used_at, optional expiry, creator, creation/revocation
timestamps and optional same-tenant rotation predecessor. Minor scope registry is
explicitly constrained. Credential identities are immutable, revocation terminal,
and deletion blocked to preserve audit history. Expiry is enforced by storage but
must also be checked by the future authentication consumer.

RLS reads metadata only for owner/admin/developer. Hash is excluded from client
column grants. No direct client or service-role key INSERT/UPDATE/DELETE is granted;
service role has SELECT for future trusted auth, and execute on create/revoke RPCs.
No browser/service generic mutation path is exposed.

Three new SECURITY DEFINER RPCs have empty search_path, qualified tables, revoked
PUBLIC EXECUTE and narrow grants: authenticated bootstrap_merchant; service-only
create_merchant_api_key and revoke_merchant_api_key. Invoker guards protect key
immutability/last owner. Existing audit validator is extended to tenant-scoped
API-key targets/actors without weakening earlier validations or history policies.

No indexes are built concurrently. Empty new key table and existing integrity
allow this additive migration; inspect live data/function baseline again before
any explicit approved apply. It does not activate ingestion, verification or sends.
