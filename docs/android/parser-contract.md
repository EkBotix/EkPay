# Parser contract — Phase 6 specification

Phase 7 implements the sandbox-only companion at D:\ekpay-android-parser. See
[Android architecture](architecture.md) and [current report](../phase-7-implementation.md).
The future real SMS/notification reader remains unimplemented. The original Phase 6
contract below is historical; protocol bytes remain authoritative and unchanged.

Phase 6 simulator is local synthetic test code only. No SMS permissions, real Android
device, notification reader, inbox upload or provider/customer data collection exists.

Generate an Ed25519 key on-device; never transmit/back up the private key to EkPay.
Prefer non-exportable Android Keystore keys when the algorithm/device/API supports them.
Do not assume Ed25519 or hardware-backed/StrongBox support on every Android target.
Validate minimum API, provider, OEM and security level on a supported device matrix and
review any protected-software fallback before implementation. This is a launch blocker,
not an implemented compatibility guarantee. See Android's
[Keystore security model](https://developer.android.com/privacy-and-security/keystore) and
[KeyProperties reference](https://developer.android.com/reference/android/security/keystore/KeyProperties).

Owner/admin creates pending identity and transfers a short-lived token securely to the
intended device. Device submits canonical public key plus token-bound new-key proof using
[pairing](../security/parser-pairing.md). No deployed pairing transport yet. Persist public
device identity/version; on approved rotation generate a fresh key and pair for exact
current version. Retain no reusable pairing token after success. Revoked identities stop
all traffic and require a new identity/new key, never silent reactivation.

Implement [protocol 1](../architecture/parser-protocol.md) exactly. Secure RNG for 16-byte
nonce and UUIDv4 ingestion ID. Offline queue contains minimized normalized payment facts,
not unrelated messages/inbox. Preserve logical ingestion ID/message facts across retries;
generate fresh nonce/server-adjusted timestamp and sign exact bytes at send time. Do not
replay old offline signatures beyond ±300 seconds. Verify clock synchronization through
trusted time/TLS; no widening freshness to make broken clocks pass. Queue encryption,
bounded retention, backoff, duplicate handling and crash recovery require future review.

On 409 retry_request retry a whole operation with backoff; request_conflict requires
operator investigation, never silently change facts. A generic 401 must not trigger
automatic identity/key reassignment. Stop and check enrollment/clock/status securely.

Privacy: eventual consented ingestion must narrowly justify payment-notification/SMS
access and applicable store policy. Never collect whole inbox, contacts, IMEI, serial,
advertising IDs or unrelated messages. Local normalization and minimal evidence only;
no raw upload without separate justified privacy/encryption/retention review. Provider
origin cannot be proven merely by possessing an enrolled signing key.
