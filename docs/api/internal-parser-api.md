# INTERNAL / DISABLED BY DEFAULT / NOT PUBLIC API

POST `/api/internal/parser/evidence` and POST `/api/internal/parser/heartbeat` are Node
server routes. `EKPAY_PARSER_INGESTION_ENABLED=false` by default. Even flag true requires
`NODE_ENV=test`; production/development return 404 `not_available` before credentials/DB
lookup. Private parser and existing ingestion policies are disabled by default and are
not browser/service toggles. No pairing endpoint or public API-key parser capability.

See the exact [protocol](../architecture/parser-protocol.md). Content type JSON; maximum
4096 actual streamed bytes, including missing/incorrect Content-Length. Valid signed
evidence accepts only synthetic normalized fields, never raw SMS, merchant/environment/
account IDs. Heartbeat accepts bounded app_version, protocol_version=1 and optional
android_version/device_model/locale/timezone. No identifier collection or state mutation.

Response classes (all `Cache-Control: no-store`): 404 not_available; 400 invalid_request;
413 invalid_request; 401 invalid_device_request; 409 request_conflict or retry_request;
500 internal_error. Unknown/revoked keys, wrong signature/version and stale timestamp
share an error; SQL error details, nonce existence and key registry are not disclosed.
Success is a safe evidence receipt or `{accepted,reused}` heartbeat response. No raw body,
signature or key is echoed. Ingestion never automatically invokes verification/webhooks.

The local simulator uses the actual handler factory and native SQL-backed store, plus
exported-route production-off unit tests. Hosted enabled Next HTTP→Supabase PostgREST→SQL
and authenticated dashboard browser flows remain unvalidated launch gates.
