# Phase 7 Android parser — sandbox implementation report

Reviewed 2026-09-28. **PHASE 7 RECOMMENDATION: PASS for the local sandbox foundation.**
This is not production readiness or permission to start Phase 8. No SMS, real account,
real payment data, hosted parser enablement, migration apply, commit or push occurred.

1. **Summary:** Kotlin Android app implements test pairing, Ed25519 identity, exact
   parser-v1 signing, heartbeat, synthetic evidence, encrypted durable retries and status.
2. **Project:** `D:\ekpay-android-parser`, separate locally initialized Git repository.
   Backend remains `D:\ekpay`; no remote Android GitHub repository was created.
3. **Package:** namespace/release application ID `com.ekbotix.ekpayparser`; debug
   `com.ekbotix.ekpayparser.sandbox`, app name EkPay Parser — Sandbox.
4. **SDK/toolchain:** minSdk 28, targetSdk/compileSdk 36, JDK17, Gradle8.13,
   AGP8.13.2, Kotlin2.2.21. Verified official toolchain download checksums; local ignored
   SDK/JDK/cache/build artifacts are not source or credentials.
5. **Files/modules:** `app` (Compose/Room/WorkManager/Android Keystore) and `core`
   (protocol/models/HTTP/retry abstraction/tests), Gradle wrapper, schema1, manifest,
   resources, tests and mirrored docs. Complete source inventory: [files](phase-7-files.md).
6. **Architecture:** single-process repository mutex serializes settings/pairing/sync;
   Room persists encrypted queue payloads, AtomicFile persists encrypted identity;
   CoroutineWorker runs constrained sync. See [architecture](android/architecture.md).
7. **Key generation:** on-device native Ed25519 capability probe API33+; partial failed
   aliases deleted. Explicit user consent permits encrypted software Ed25519 sandbox
   fallback. No server-generated parser private key or private export method.
8. **Keystore compatibility:** Android13 AOSP implements Curve25519/Ed25519 handling,
   but API level does not establish OEM or hardware support. Native availability is
   probed; hardware classification queried separately. API28+ fallback uses Keystore
   AES-GCM. No connected device matrix was established. [Evidence/tradeoffs](android/crypto.md).
9. **Storage:** non-exportable native key, or software seed protected by non-exportable
   Keystore AES256-GCM/random IV/alias AAD in no-backup AtomicFile. Encrypted identity
   and queue bodies. Missing/corrupt wrapping key fails closed. Software seed necessarily
   appears in signing-process memory; managed-runtime zeroization is not guaranteed.
10. **Pairing:** public UUID/token/current version input; candidate key signs exact Phase6
    token/public-key proof. Local bridge consumes actual existing SQL RPC. Matching
    success promotes version+1; token never persisted and screen clears after attempt.
    Generic errors preserve backend anti-enumeration. Metadata follows in heartbeat;
    no invented fields added to strict Phase6 pairing contract. [Pairing](android/pairing.md).
11. **Protocol:** exact Phase6 eight headers including `X-EkPay-Message-Hash`, both fixed
    paths, Ed25519 hex signature and strict UUID/version grammar. [Protocol](android/protocol-v1.md).
12. **Canonical bytes:** UTF8/LF/no trailing LF; domain, POST, path, device, version,
    milliseconds, nonce, ingestion ID, normalized message hash, raw-body SHA256 in that
    order. Serialize once; hash/sign/send same bytes. Shared Node/Kotlin vector passes.
13. **Time:** 13-digit UTC Unix milliseconds for signing; provider UTC ISO timestamp
    always three fractional digits. Backend ±5-minute skew policy; no fabricated server
    time or automatic clock adjustment. User clock correction needed on rejection.
14. **Nonce:** SecureRandom 16 bytes, canonical unpadded base64url (22 characters), new
    nonce/timestamp/signature every queued attempt. Exact previously accepted request
    remains idempotent per backend; changed request reusing nonce is rejected.
15. **Ingestion ID:** UUIDv4 created once per logical queue item; retries keep same ID
    and body, different evidence receives new ID. Queue remains bound to paired device.
16. **Message hash:** normalized immutable ordered evidence fields hashed exactly as
    Phase6; no retry state. Heartbeat hash is raw-body digest. Public vector artifacts
    contain only synthetic data/public key/signature; published RFC8032 seed in tests
    is a known public fixture, not a deployed private key.
17. **Networking:** OkHttp HTTPS only, standard CA/hostname verification, 10/15/20-second
    connect/read/call bounds, bounded response, no redirects/implicit retries/logging.
    Debug opt-in only for exact localhost/127.0.0.1/10.0.2.2; domain-scoped debug user CA.
    Release blank URL/networking false/system CA only. No trust-all or TLS bypass.
18. **Heartbeat:** explicit test heartbeat enqueues signed safe app/protocol/health
    metadata; status shows last successful sync/failure/summary. No device identifiers.
19. **Evidence:** enum provider, positive safe integer amount, BDT, `TEST_` transaction
    and reference values, UTC time, hashed identities. Optional sender must be synthetic.
    No note transmitted because finalized backend body rejects extra fields.
20. **Queue:** Room durable encrypted payload, ingestion/public device/path/status/
    attempts/next retry/safe error; signatures/nonces/keys/tokens not persisted there.
    Maximum100 rows total, pending24-hour expiry, pruning terminal rows. Queue views
    show safe metadata. WorkManager network constraint and unique periodic/immediate work.
21. **Retry:** network/5xx/explicit temporary conflict only, 30-second exponential delay
    capped1 hour/8 attempts; OS15-minute periodic scheduling can delay delivery. Permanent
    protocol/signature/conflict/validation errors stop. No duplicate evidence on retry.
22. **Revocation:** explicit revoked state terminal, send disabled, queue paused/new
    registration required. Generic401 pauses identity (backend intentionally does not
    disclose revocation), never triggers replacement/reactivation or further ingestion.
23. **Rotation:** supported dashboard-authorized re-pair flow, not invented signed
    old-key rotation. Candidate promotion only after confirmed server success; old and
    bounded recovery aliases retained through uncertainty. Ambiguous pairing blocks
    ingestion; owner/admin must review server version and issue fresh token.
24. **Status UX:** identity/environment/provider/masked test account/version/protocol/
    pairing time/last sync/failure/queue/app version/protection; welcome/unpaired/pair/
    success/status, evidence/queue/diagnostics/settings. No private key display.
25. **Sandbox protections:** TEST MODE badge every main screen, FLAG_SECURE, default-off
    local networking, immutable test marker, `TEST_` validation in app and local bridge.
    No WebView, provider login, SMS or notification reader.
26. **Permissions:** source INTERNET/ACCESS_NETWORK_STATE; merged APK additionally
    WorkManager WAKE_LOCK/RECEIVE_BOOT_COMPLETED/FOREGROUND_SERVICE and app signature
    dynamic-receiver permission. Launcher exported; scheduler BIND_JOB_SERVICE and
    library diagnostics/profile receivers DUMP-protected; other components unexported.
27. **SMS absence:** source unit test plus automated debug/release merged-manifest
    checks PASS; aapt APK permission inspection matches. READ_SMS/RECEIVE_SMS/SEND_SMS,
    contact/phone permissions and SMS receivers absent. Backups/cleartext disabled.
28. **Privacy:** synthetic facts and minimal safe metadata only; no inbox/contact/phone/
    IMEI/serial/advertising ID, customer data or account credentials. No analytics/crash
    reporter. [Privacy](privacy/android-parser-privacy.md) covers retention/recovery.
29. **Diagnostics:** default-off toggle, known safe enums/status/queue counts only; no
    payload/token/key/signature/full-account/exception logging. Pairing token memory
    lifetime cannot be claimed to be instantly erased by JVM/HTTP code.
30. **Unit tests:** core6 PASS; app5 PASS in both debug/release (10 executions): protocol/
    RFCvector/headers/retry/destinations, source permissions, pairing/token/rotation,
    encrypted queue/stable retry/fresh nonce, auth/revocation and missing-key fail closed.
    Core integration excluded without explicit disposable fixture environment.
31. **Integration:** separate real Kotlin HTTPS client → existing Phase6 handler → native
    disposable PostgreSQL PASS: pair, heartbeat, evidence, stable retry, bad signature,
    stale time, nonce conflict, wrong version, approved rotation/old-key denial/revocation.
    Final DB exactly1 synthetic evidence/0 authoritative transactions. Instrumentation
    APK compiles; connectedAndroidTest NOT RUN (ADB list empty). UI/OEM/Doze not validated.
32. **Lint/build:** Gradle test/lint/assembleDebug/assembleDebugAndroidTest PASS. Lint
    0 errors/10 newer-dependency warnings, no baseline suppressions. Initial Windows JAR
    lock resolved by stopping daemon and single-worker rerun. Nonfatal SDK XML-version
    and native-library symbol warnings do not establish device compatibility. Backend
    typecheck/lint/build PASS; npm test PASS: unit15, Phase1 110, Phase2 39 plus3 isolation
    concurrency cases, Phase3 74, Phase4 235/33 races, Phase5 150/24 races, Phase6 209/30 races.
33. **Backend changes:** local bridge/vector/test scripts, vector unit test, npm script
    entries, README/current-status and Android/security/privacy docs only this phase.
    No deployed handler/protocol/auth/runtime weakening. Bridge uses temporary native
    fixtures/ephemeral test CA; local registration displays token once without logs.
34. **Migrations/live:** no new migration or SQL edit. Seven already-applied migrations
    retain original hashes. Linked dry-run PASS: up to date, empty migration/seed/role
    changes. Read-only live inspection: parser policies OFF,0 devices/requests. Disposable
    local policy writes are confined to test DB; hosted production untouched.
35. **Git:** backend existing uncommitted multi-phase tree preserved; Android all source
    untracked, no commits/staging/remotes. Both diff-check PASS. SDK/cache/APK/local.properties
    ignored. [Inventory](phase-7-files.md) separates this phase from pre-existing work.
36. **Unresolved security risks:** rooted/process compromise, software signing exposure,
    no hardware attestation/auth policy/penetration validation, protected-storage atomic
    state and Room cross-store recovery edge cases require device crash tests. No claim
    that a signed synthetic observation proves provider-origin authenticity.
37. **Compatibility risks:** native Ed25519 OEM/API support untested; fallback requires
    explicit consent and working Keystore AES. Real secure-storage/instrumentation/UI/
    reboot/Doze/multi-process behavior untested. Raise/narrow tested API/OEM policy for
    native-only production; raising minSdk alone cannot guarantee hardware support.
38. **Production blockers:** hosted pairing transport, parser gates, provenance/provider
    approval, verified device matrix, fleet/recovery operations, distributed rate limits,
    real verification/reconciliation, monitoring, store/privacy/legal launch review and
    explicit human approval. Sandbox bridge is never a production service.
39. **Disabled:** SMS reading/permissions, notification reader, real data/provider API,
    live destinations, production verification/parser traffic, BD21topup integration,
    publishing and auto-reactivation. Release has no configured backend/networking.
40. **Recommendation:** **PASS — local Phase7 sandbox foundation only.** Stop for human
    review before Phase8. Runtime device/Keystore/UI validation remains outstanding;
    this report authorizes no production ingestion or rollout.

Detailed guides live under `docs/android/` and are mirrored into the Android project;
current backend protocol/replay/API docs are copied there for offline reference.
