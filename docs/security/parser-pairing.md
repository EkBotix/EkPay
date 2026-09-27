# Parser pairing

Authenticated owner/admin registration or re-pairing returns a long opaque token once.
Token generation hashes two PostgreSQL cryptographically random v4 UUIDs (244 random bits)
into 64 lowercase hex characters. DB stores only SHA-256 of the displayed token, issuer,
device, expected key version, expiry and consumed timestamp. No short guessing code.
Expiry is ten minutes, evaluated with DB clock after waits. Token replacement invalidates
its predecessor; successful consumption is single-use and transactional.

Synthetic pairing input: public device UUID, expected version, token, canonical new public
key and new-key Ed25519 proof. Proof bytes are UTF-8 LF-separated, no final LF:

```text
ekpay-parser-pair-v1
<lowercase public device UUID>
<expected version decimal>
<SHA-256(token UTF-8) lowercase hex>
<SHA-256(raw new public key) lowercase hex>
```

`pairSyntheticParser` is test-only. It verifies proof before invoking service-only
`consume_parser_pairing`. SQL rechecks stored issuer's verified-user/membership authority,
binding, active account/merchant, expected current version and hash/expiry/unused state.
Actual device revision write serializes simultaneous pairing and rotation at all tested
isolation levels. Token/key/audit failure rolls back the entire operation.

No public pairing HTTP endpoint exists. Distributed device/IP limits and strong pairing
attempt limits are PRE-PRODUCTION BLOCKERS. A dashboard token is a temporary bearer
capability: display only in the action response, clear on dismissal/reload, no redisplay
endpoint, local storage, analytics or audit copy. TLS/log/APM redaction must be verified
before a real transport is introduced. SQL trusts service attestation for proof verification.

PostgreSQL [UUID reference](https://www.postgresql.org/docs/17/functions-uuid.html) and
[implementation using pg_strong_random](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/utils/adt/uuid.c).
