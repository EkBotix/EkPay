# Android sandbox architecture — Phase 7

Separate project D:\ekpay-android-parser; no runtime backend schema/Next-route change.
Core JVM module holds protocol, models, key abstraction, HTTPS client and retry classifier.
Android app uses Jetpack Compose, ViewModel/coroutines, Room, WorkManager and Android Keystore.
Packages: ui/data/network/crypto/protocol/storage/workers/model/repository/diagnostics.
No injection framework, WebView, SMS reader or provider SDK.

Repository mutex serializes queue sync, settings and pairing/rotation within the single
app process. Room persists stable ingestion IDs and encrypted synthetic payloads; active/
pending identity uses atomic AES-GCM protected no-backup files. WorkManager unique immediate
and periodic jobs call the same repository; periodic job catches work lost after process
death. Backend durable idempotency protects ambiguous network completion/crash before local
accepted-state persistence. Multiprocess execution is not configured.

No public pairing transport is added to Next. scripts/parser-sandbox-bridge.mjs creates an
isolated loopback random-password PostgreSQL cluster, fixture actors/test accounts and
ephemeral HTTPS CA, calls unchanged Phase 6 proof/handlers/RPCs, destroys all on exit.
Local fixture controls are deliberately not deployable production APIs. Seven applied
migrations and production policies remain unchanged/OFF.
