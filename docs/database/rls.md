## Phase 6 parser grants (unapplied)

Member reads are limited to safe device columns with tenant RLS. Parser requests have no
authenticated read/write grants. Anon/authenticated cannot write device configuration;
service direct device DML revoked. Authenticated management RPCs require verified auth.uid()
owner/admin; service-only pairing/heartbeat attestation RPCs cannot choose actor/tenant.
Private policy/token/key-history tables have RLS and no PUBLIC/anon/auth/service grants.
New definers have empty search_path and no PUBLIC execute; trigger functions have no RPC
execute grants. No TRUNCATE/REFERENCES grants added.

## Prior baseline
# RLS, grants and privileged boundaries

Phase 5 preserves tenant policies and revokes direct service evidence/parser-request INSERT.
Only service_role executes hardened ingest_synthetic_evidence. Private disabled policy has
RLS/no service/client grants; provenance-safe columns become member-readable. Source identity
is derived from registry, not caller tenant/env. No raw data/signatures/private keys or new
unsafe table grants. Configuration audit trigger is SECURITY INVOKER; PUBLIC execute revoked.
See [ingestion security](../security/evidence-ingestion-security.md). Historical grants below
must be interpreted with these Phase 5 revocations.

Phase 4: only service_role executes verify_payment_evidence. No authenticated/API-key
verification route; service direct match/transaction INSERT revoked. The private disabled
policy and serialization tables have RLS/no client/service grants. A narrow hardened
definer input trigger writes only mutex metadata. All existing tenant policies remain.
Safe evidence environment/trust columns become member-readable; hashes/raw payloads
stay restricted. No unsafe TRUNCATE/REFERENCES grants. See [verification security](../security/verification-security.md).

The Phase 1/2 helper/function counts below are historical, not a current inventory.

Phase 3 preserves existing policies. New api_idempotency_keys enables RLS and
revokes all client/service table privileges. Only two service-only SECURITY
DEFINER RPCs create/read intents; context comes from server-HMAC-verified API key
and is rechecked in DB. Empty search paths, qualified application references,
and no PUBLIC/client execute grants. No new evidence/transaction client writes.
Intent tenant/environment are immutable; account linkage is composite-scoped.
Dashboard reads environment metadata under existing membership RLS. See
[intent schema](payment-intents.md). Earlier notes below describe Phase 1/2.

Phase 2 adds api_keys metadata SELECT for owner/admin/developer, no viewer access,
no hash SELECT and no direct client or service-role key DML. Service-only key RPCs
authorize and atomically audit; authenticated bootstrap derives auth.uid().
Earlier RLS is not weakened. See [API-key schema](api-keys.md).

The proposed migration enables RLS on all new public/private tables and resets
default privileges. PUBLIC and anon get no table access. UUID keys use no sequences;
there are no application sequence grants to manage. No client gets TRUNCATE,
REFERENCES, TRIGGER or MAINTAIN. Column-level grants must be used with explicit
column SELECTs rather than SELECT * on sensitive resources.

| Resource | Authenticated permission |
| --- | --- |
| Merchants/membership/intents/matches/transactions/events | Tenant members read |
| Brands | Members read; owner/admin safe insert/update columns |
| Provider accounts/evidence | Members read safe columns only |
| Parser devices | Owner/admin read safe columns only |
| Endpoints | Owner/admin/developer read; owner/admin URL/subscription insert/update |
| Delivery attempts | Owner/admin/developer read |
| Audit logs | Owner/admin read |
| Parser receipts/private ciphertext | None |

Viewer cannot write configuration. Developer cannot manage endpoints; reads are
for integration diagnosis. Admin cannot promote itself through membership writes.
Endpoint enabling, secret rotation, account/device management and authoritative
payment writes are server-only. Service role has SELECT/INSERT on new history,
UPDATE on mutable config, limited private-secret retirement updates and no
TRUNCATE. Existing merchant/membership/config server DML remains available.

`is_merchant_member(uuid,text[])` is the sole application SECURITY DEFINER helper.
Live review confirmed postgres ownership, empty search_path, qualified table and
auth.uid(), and only authenticated EXECUTE besides owner. No recursive policy
lookup or caller-controlled user parameter exists. New triggers are invoker
functions with empty search_path; PUBLIC/anon/authenticated EXECUTE is revoked.

Service-role caller authorization is future API work, not something RLS guarantees.
The DB owner/superuser can alter triggers/grants and is outside the normal-user
threat boundary. Review derives from actual catalog inspection and local role tests.

Reference: [Supabase RLS and grants](https://supabase.com/docs/guides/database/postgres/row-level-security).
