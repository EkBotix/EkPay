# Kotlin implementation of exact Phase 6 parser protocol

Authoritative [backend contract](../architecture/parser-protocol.md), shared
[public fixed vector](parser-v1-vector.json). Kotlin core Protocol implements all headers,
including X-EkPay-Message-Hash (the task's conceptual list omitted this required header).
Canonical UTF-8 LF lines: ekpay-parser-v1, POST, exact evidence/heartbeat path, lowercase
public device UUID, current key version, Unix millisecond timestamp, nonce, UUIDv4 ingestion
ID, message hash, SHA-256 exact raw body. NO final newline; never omit method/path/hash.

Evidence body is serialized once with exact ordered normalized facts, including sender
hash=null, currency=BDT and UTC ISO milliseconds (three fractional digits/.000Z). Gson
serializeNulls/disableHtmlEscaping preserves those bytes. The normalized message hash equals
SHA-256 of these fixed ordered evidence bytes; no receive/app/nonce/ingestion metadata.
Exact same raw byte array is signed and sent without reserialization. Heartbeat hash is
raw body SHA-256. Fixtures test Node/Kotlin equality and RFC 8032 sign/verify.

Nonce: SecureRandom 16 bytes → canonical 22-character unpadded base64url. UUID.randomUUID
per logical queue item; stable UUID across retries, fresh nonce/current Unix millis and
new signature each attempt. No stale signature saved in queue. ±300s server freshness;
UI advises checking OS clock after generic auth failure, never fabricates server time.
Retryable duplicate facts retain ID; conflicting facts are not silently changed.
