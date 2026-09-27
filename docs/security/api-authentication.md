# API authentication security

Server-only modules share the existing generate/hash helper; no duplicate credential algorithm or new pepper variable. API_KEY_HASH_SECRET remains stable, minimum 32 characters; operator must generate high entropy. Missing pepper fails closed, and unsupported hash versions fail closed.

Unique prefix candidate lookup avoids key scans. Complete-credential HMAC and fixed-size timingSafeEqual comparison do not imply entire endpoint timing is constant: DB/network lookup paths differ. No external error distinguishes unknown, revoked, expired or suspended context. Fresh lookup on each request; no positive authentication cache.

Trusted context is produced only after validation; privileged RPC rechecks active key, expiry, active merchant and scope under transaction locks. Public payload has no merchant/user/actor/status authority. RPCs are service_role-only; internal helpers have PUBLIC/client execute revoked and empty search_path.

Bodies are streamed and capped at 8192 bytes even without Content-Length; strict JSON media type, field whitelist and metadata bounds apply. No logging of headers/body/secret exists. No query/cookie auth and no wildcard CORS. TLS and redaction at ingress/APM are required before launch. Application checks do not prove hosted edge logging is redacted.
