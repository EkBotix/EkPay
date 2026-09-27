# API key security

Server-only crypto generates 32 random bytes per secret plus a random public
identifier. HMAC-SHA256 hashes the complete credential using API_KEY_HASH_SECRET,
a stable high-entropy server-only pepper. Only the digest, hash version and public
prefix reach DB storage. A hash is appropriate for high-entropy bearer credentials;
recoverable plaintext encryption is unnecessary. The pepper never enters public
configuration. At least 32 characters are required; generate it securely outside
source control and do not rotate it casually without a versioned migration plan.

Creation/revocation service RPCs are not executable by authenticated/anon users.
They validate the verified-server actor's current owner/admin membership, active
merchant and target ownership under locks. No caller-supplied key secret is used.
Atomic audit contains only action, environment/abilities and target ID. The key
guard prevents credential/identity changes and reactivation. No client key DML,
TRUNCATE or hash SELECT grant exists.

One-time server action responses and dashboard are private/no-store. Do not attach
analytics/session recording to secret display. No localStorage persistence or
console logging is implemented. HTTP transport must use TLS in production.

Phase 3 provides a default-disabled Bearer consumer with shared HMAC and fixed-size
timingSafeEqual. Active means provisioned, not live service readiness.
Deployment still needs distributed rate limits/key-count quotas,
MFA/re-authentication policy for credential operations, audited rotation/expiry
and hosted operational testing. New API RPCs enforce test/live isolation;
local tests do not prove hosted logging or edge controls.
