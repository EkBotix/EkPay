# Parser signatures — Phase 6

Only synthetic signatures are exercised. See exact [protocol](../architecture/parser-protocol.md)
and [pairing proof](parser-pairing.md). Node crypto.verify(null,bytes,key,signature) uses
Ed25519 after wrapping the raw 32-byte key in fixed SPKI. Protocol binds domain, POST,
fixed path, public identity/version/time/nonce/ingestion/message hash and exact body digest.
Cross-route signatures, malformed encodings, altered raw bytes and stale/current-key
mismatches reject. No private/shared signing secret is stored or displayed by EkPay.

Signature proves enrolled-key possession, not genuine SMS/MFS/provider origin. SQL does
not independently perform Ed25519 verification: trusted ingress/service-role attestation
is a security boundary. Service compromise or DBA authority could forge attestation.
SQL still independently checks token/issuer/current status/key hash/version/time and uses
actual writes to close lookup→revocation/rotation races, including REPEATABLE READ.

Private key fixtures exist only temporarily in the local simulator. Logs/audits store
neither signatures, tokens, nonce history nor raw bodies. Distributed limits, hosted
transport/redaction/security review and real-source corroboration remain launch blockers.

[Node signature API](https://nodejs.org/api/crypto.html#cryptoverifyalgorithm-data-key-signature).
