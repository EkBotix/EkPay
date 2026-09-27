# Android sandbox security boundary

No SMS/contact/phone/hardware identifiers or provider/account secrets. Internet/network
state permissions only in app source; WorkManager merged permissions separately verified.
FLAG_SECURE on every screen; only the app's launcher activity is exported, no WebView/custom
service or receiver. Merged library exports are limited to BIND_JOB_SERVICE-protected
WorkManager scheduling and DUMP-protected diagnostics/profile receivers. Automated checks
enforce this allowlist. Backup/cloud/device transfer excluded. No service/anon/API/HMAC backend keys
in app/config. Test-only build marker cannot be switched to live.

Networking default-off; release URL blank/off; debug HTTPS destination restricted to host
loopback localhost/127.0.0.1/emulator 10.0.2.2. System CA validation and hostname checks;
debug user CA trust only on these domains. No HTTP option, trust-all, global developer CA,
TLS pinning hack, external redirect or certificate verifier override. Generated local CA
only in integration tests; remove emulator trust after testing. Production never opened.

Keystore/protected software differences are explicit; see [crypto](crypto.md). Encrypted
queue/state with device binding, no token persistence, candidates retained for uncertain
rotation, missing keys/revocation fail closed. Debug logs allow HTTP status/known queue
state only, default off; no payload, signature, key, token or Throwable detail.

Not production hardened: no verified OEM/hardware support matrix, attestation, user-auth
policy, penetration review, fleet operations, monitored limits, store permission review or
real-source provenance. Distributed device/IP/pairing attempt limits remain backend launch
blockers. Signing a synthetic observation does not prove provider-origin authenticity.
