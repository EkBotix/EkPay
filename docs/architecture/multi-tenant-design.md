# Merchant isolation

Every tenant-owned table has merchant_id. UUID primary keys identify rows;
composite `(merchant_id,id)` candidate keys identify ownership. Related records
reference those composite keys rather than trusting an application-supplied
merchant ID. Intent/account references additionally constrain the provider.

Optional brand/account references may be NULL because an intent can be configured
later. Merchant IDs are never nullable. A non-null account requires a non-null
provider; authoritative transaction fields are all required. SMS evidence requires
both a device and matching receipt. These checks close MATCH SIMPLE NULL escapes.

Events and audits use typed logical UUID targets validated by invoker triggers
on append. Audit user/device actors must belong to the tenant at append time;
API-key actors remain disabled until a tenant-scoped key registry exists.
Historical audit references are not cascading FKs: append before deletion and
retain the historical identifiers. Trusted maintenance must preserve event object
provenance; direct client history mutation is unavailable.

RLS restricts readable rows to membership of auth.uid(). The helper's SECURITY
DEFINER lookup avoids recursive membership policies; it does not accept a caller
user ID. Column grants separately protect ciphertext/hash fields. A person who
belongs to two merchants cannot move configuration rows between them through
dashboard column grants. Service-role access bypasses RLS, so every future server
operation must separately authorize merchant/role before writing.

The global provider transaction-ID unique key intentionally crosses tenant
boundaries to prevent double verification. Return a generic conflict to clients;
never reveal another merchant's transaction details.
