# API and session authentication

Phase 3 developer API is default-disabled and development-only. Set EKPAY_DEVELOPMENT_API_ENABLED=true only in isolated development. No production activation is authorized.

REST uses exactly Authorization: Bearer ek_test_REPLACE_ME (or ek_live_REPLACE_ME). The placeholder is deliberately not a usable credential. No query/cookie credentials or alternate header are accepted. Real credentials have ek_(test|live)_16hex_43base64url format.

Unique prefix lookup precedes complete-credential HMAC-SHA256 and timingSafeEqual comparison. Fresh status, expiry, hash version, merchant status, environment and ability checks produce trusted merchant/environment context. Unknown/revoked/expired/suspended failures all return 401 invalid_api_key; missing ability on a valid credential returns 403 insufficient_scope. Service/backend failures remain generic 503.

Cookie Auth remains exclusively the management-dashboard/server-action boundary; REST never treats a session cookie as API authority. Service-role RPCs recheck current key state and ability under SHARE locks. A key ID is trusted only after server HMAC validation, never from a caller body.
