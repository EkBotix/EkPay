# Parser device management — Phase 6

DEVELOPMENT / PRE-LAUNCH. Only synthetic devices on disposable local PostgreSQL.
Six prior migrations are applied; Phase 6 is unapplied. No Android app or provider integration.

The registry, binding, ingestion receipts, Ed25519 source verification and ingestion RPC
already existed in Phase 5. Phase 6 reuses them and adds pending registration, one-time
pairing, public-key history, dashboard-authorized rotation, terminal revocation, health,
and a separate method/path-bound HTTP protocol. Synthetic identities retain the existing
`source_type=provider_api`, `is_synthetic=true`, `environment=test` admission model; this
is simulation infrastructure, not an assertion of provider-origin authenticity.

Registration requires a verified non-anonymous `auth.uid()`, active merchant and owner/admin
membership. Developer/viewer and API-key clients cannot manage devices. Dashboard actions
recheck session and merchant role; authenticated SQL RPCs independently recheck and derive
the actor. No caller-supplied actor ID or service-role management shortcut.

One opaque public device UUID binds permanently to one merchant, explicit test environment,
provider and active provider account through composite FKs. Payloads cannot select a merchant,
environment or account. Multiple accounts/SIMs require a future reviewed capability model.

Management requires `EKPAY_PARSER_MANAGEMENT_ENABLED=true`, a non-production runtime,
and the private DBA-controlled `parser_policy`. Defaults are off. The dashboard displays
safe status/version/account/timestamps/health only; readers never receive keys, replay data
or previously issued tokens. Existing last-owner and API-key role models remain unchanged.

See [lifecycle](parser-lifecycle.md), [pairing](../security/parser-pairing.md),
[protocol](parser-protocol.md), [Phase 6 report](../phase-6-implementation.md).
