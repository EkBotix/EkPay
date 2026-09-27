# Parser signed protocol 1

Synthetic/test-only, default off. This method/path-bound protocol supersedes the Phase 5
fixture envelope for the two internal routes. Phase 5 regression helpers retain their
separate ekpay-source-synthetic-v1 domain and FINAL LF; they are not parser HTTP protocol 1.

Content-Type application/json. Headers:

- EkPay-Parser-Protocol: 1
- X-EkPay-Device-Id: public UUID (normalized lowercase before canonical construction)
- X-EkPay-Key-Version: current positive int32 decimal, no leading zero
- X-EkPay-Timestamp: 13-digit Unix milliseconds decimal, no leading zero
- X-EkPay-Nonce: 16 random bytes, canonical unpadded base64url, exactly 22 characters
- X-EkPay-Ingestion-Id: UUIDv4, normalized lowercase, stable for one logical message
- X-EkPay-Message-Hash: 64 lowercase hex
- X-EkPay-Signature: 64-byte Ed25519 signature encoded as 128 lowercase hex

Canonical bytes: UTF-8, LF separators, no trailing LF, fixed method and endpoint path:

```text
ekpay-parser-v1
POST
<exact /api/internal/parser/evidence OR /api/internal/parser/heartbeat>
<lowercase public device UUID>
<key version decimal>
<timestamp milliseconds decimal>
<nonce>
<lowercase ingestion UUIDv4>
<message hash lowercase hex>
<SHA-256 exact raw body bytes lowercase hex>
```

Sign raw bytes' digest, never parsed/re-serialized JSON. Whitespace/order changes need a
new valid signature. Ed25519 signs canonical bytes directly (no external signature digest).
Body limit 4096 streamed bytes; raw JSON must be valid UTF-8. Freshness is absolute
server/request time difference <=300 seconds, checked in TS and finally DB after waits.
Ingested/health timestamps always use server clock, not caller timestamps.

Evidence message hash is SHA-256(JSON.stringify) of this fixed property order after
normalization: provider, provider_transaction_id, amount_minor, currency,
receiver_identity_hash, sender_identity_hash, provider_timestamp. Currency BDT; integer
positive minor units; sender hash null if absent; UTC ISO timestamp; reference trimmed,
uppercase grammar required (never auto-uppercase a lowercase reference). Normalization
version remains ekpay-evidence-normalization-synthetic-v1. Receive/app/transport times,
nonces and JSON formatting do not affect it. Heartbeat message hash is body digest.

Verification order: runtime gate; method/media/declared size; strict headers; bounded
stream; active test synthetic device/current version/freshness lookup; raw digest/canonical
Ed25519 verification; strict normalization and message-hash/provider check; hardened RPC
rechecks binding/status/key/time, serializes nonce/ingestion identity and atomically stores
receipt/evidence/health/audit. No business write occurs before signature verification.

Nonce/idempotency need normalized facts, so final DB replay enforcement follows strict
normalization. Provider account/merchant/environment are derived from registry, never body.
See [replay](../security/parser-replay-protection.md), [errors/routes](../api/internal-parser-api.md).
No real SMS provenance or Android integration is implied.
