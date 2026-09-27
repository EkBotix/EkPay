# API key management

Phase 2 migration is now applied. Phase 3 adds default-disabled development
authentication and create/read intent routes under `/api/v1`; no public/live
verification service is enabled. See [authentication](authentication.md).

Key format: `ek_test_<16-hex-public-id>_<256-bit-secret>` or live equivalent.
The full value appears once after successful creation, held in transient UI state.
Dismiss/reload removes it; lists never return it. Do not put it in browser storage,
URLs, audit metadata, source or logs. Creation form is removed while the secret is
shown so it is not resubmitted in React action state.

Allowed abilities: payment_intents:create, payment_intents:read, transactions:read,
webhooks:read, webhooks:manage. Unknown/repeated/empty lists are rejected by the
server. Phase 3 implements only payment_intents:create/read; other scopes remain
reserved. Both environments can be provisioned; neither activates real verification.

Owner/admin create/revoke; developer reads metadata; viewer has no API-key access.
Requests carry merchant ID as untrusted input. Server verifies user, active
membership and role, then invokes a service-only DB RPC that repeats membership/
role/ownership checks and atomically audits. Revocation is terminal and idempotent.
No key-edit, retrieval or automatic rotation exists. Development API authentication
is server-only; missing/invalid credentials fail closed and no query/cookie key is accepted.
