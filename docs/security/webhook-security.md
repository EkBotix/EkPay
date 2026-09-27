# Webhook sender security requirements

Status: storage/constraints only. No sender, network request or SSRF protection
implementation exists. All endpoints start disabled; enabling is server-only.

Before enabling, authorize owner/admin, provision an encrypted signing secret,
validate endpoint ownership where practical, and validate the URL with a real
URL parser. SQL's HTTPS regex is only a coarse syntax check. Reject credentials,
fragments, ambiguous encodings and unsupported ports; MVP should allow port 443
only. Never embed signing secrets in URLs.

For every outbound attempt, including retries and config changes:

- Require HTTPS and certificate/hostname validation.
- Reject localhost and internal-only hostnames; reject loopback, unspecified,
  multicast, reserved/non-public, RFC1918, IPv6 ULA and IPv4-mapped private addresses.
- Reject link-local destinations, including cloud metadata addresses such as
  169.254.169.254 and provider-specific metadata hosts. Apply IPv4/IPv6 checks.
- Resolve A/AAAA/CNAME chains through a trusted resolver, bound resolution time,
  reject any non-public result and pin the checked address for the connection.
  Preserve the original hostname for Host/SNI/TLS verification. Do not let the
  HTTP client resolve an unchecked address afterward; this closes DNS rebinding.
- Disable redirects. A later redirect feature must repeat the entire validation
  and DNS/pinning procedure at every hop, without forwarding secrets across hosts.
- Use egress firewall/proxy restrictions in addition to application validation.

Proposed worker limits, not deployed settings: 3-second DNS/connect timeout,
10-second total attempt timeout, 32 KiB streamed response-body ceiling, 1 KiB
redacted stored excerpt, bounded retries with exponential backoff/jitter.
Abort reads at the limit rather than buffering arbitrarily large responses.

Sign a versioned envelope binding event ID, timestamp and exact payload bytes.
Use a recoverable KMS-encrypted secret, constant-time consumer verification,
short timestamp tolerance and consumer event-ID deduplication. Snapshot the URL
and secret version in completed immutable delivery rows; secret-version FK retains
signing provenance. Never log secret headers or full sensitive response bodies.

The attempt-number unique constraint prevents duplicate DB history, **not two
network sends**. Before launching workers, implement a durable tenant-scoped job
queue with atomic claim/lease, fencing and backoff. A crash after sending but before
recording can still cause redelivery; design for at-least-once delivery. No worker
claim table is invented in this review, since no network sender exists yet.

Threat-model reference: [OWASP SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).
