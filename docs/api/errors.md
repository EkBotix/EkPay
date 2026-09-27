# Stable error contract

All responses use JSON and Cache-Control: no-store. Success: {"data":{}}. Error: {"error":{"code":"invalid_request","message":"Request is invalid."}}. SQL details, request content and stack traces are never returned.

| HTTP        | Code                     | Meaning                                                      |
| ----------- | ------------------------ | ------------------------------------------------------------ |
| 401         | invalid_api_key          | Any invalid/revoked/expired key or inactive/missing merchant |
| 403         | insufficient_scope       | Valid credential lacks required ability                      |
| 400/413/415 | invalid_request          | Body/field validation, byte limit or content type            |
| 404         | resource_not_found       | Intent absent or outside key's tenant/environment            |
| 409         | idempotency_conflict     | Receipt fingerprint or environment-scoped reference conflict |
| 422         | provider_account_invalid | Account not available in trusted context                     |
| 503         | development_api_disabled | Default pre-launch gate is off                               |
| 503         | internal_error           | Configuration/backend/transient concurrency failure          |

merchant_suspended is reserved for possible future trusted operator APIs and is not emitted by this public API, to avoid disclosing merchant state. Framework-generated unsupported-method responses may be 405. No wildcard CORS is enabled.
