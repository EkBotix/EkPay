# Phase 7 file inventory

This inventory records only this phase; existing backend multi-phase changes are preserved.
No staging, commit, push, remote creation or migration changes.

## Backend files created/updated

- `package.json`
- `README.md`
- `docs/database/migrations.md`
- `docs/phase-6-implementation.md`
- `docs/android/parser-contract.md`
- `scripts/parser-protocol-vectors.mjs`
- `scripts/parser-sandbox-bridge.mjs`
- `scripts/test-phase-7.mjs`
- `tests/parser-android-vector.test.ts`
- `docs/android/parser-v1-vector.json`
- `docs/android/architecture.md`
- `docs/android/pairing.md`
- `docs/android/crypto.md`
- `docs/android/protocol-v1.md`
- `docs/android/offline-queue.md`
- `docs/android/retry-policy.md`
- `docs/android/testing.md`
- `docs/android/security.md`
- `docs/privacy/android-parser-privacy.md`
- `docs/phase-7-implementation.md`
- `docs/phase-7-files.md`

## Android source/configuration/documentation

All files are new and untracked in the separate local Android repository. Ignored toolchains,
local.properties, build outputs, APKs and caches are excluded.

- `.gitignore`
- `README.md`
- `app/build.gradle.kts`
- `app/schemas/com.ekbotix.ekpayparser.data.QueueDatabase/1.json`
- `app/src/androidTest/java/com/ekbotix/ekpayparser/KeyStorageTest.kt`
- `app/src/debug/res/xml/network_security_config.xml`
- `app/src/main/AndroidManifest.xml`
- `app/src/main/java/com/ekbotix/ekpayparser/ParserApplication.kt`
- `app/src/main/java/com/ekbotix/ekpayparser/crypto/AndroidParserKeyStore.kt`
- `app/src/main/java/com/ekbotix/ekpayparser/data/QueueDatabase.kt`
- `app/src/main/java/com/ekbotix/ekpayparser/diagnostics/SafeDiagnostics.kt`
- `app/src/main/java/com/ekbotix/ekpayparser/repository/ParserRepository.kt`
- `app/src/main/java/com/ekbotix/ekpayparser/storage/DeviceState.kt`
- `app/src/main/java/com/ekbotix/ekpayparser/storage/ProtectedStorage.kt`
- `app/src/main/java/com/ekbotix/ekpayparser/ui/MainActivity.kt`
- `app/src/main/java/com/ekbotix/ekpayparser/workers/SyncWorker.kt`
- `app/src/main/res/drawable/ic_parser.xml`
- `app/src/main/res/values/styles.xml`
- `app/src/main/res/xml/data_extraction_rules.xml`
- `app/src/main/res/xml/network_security_config.xml`
- `app/src/test/java/com/ekbotix/ekpayparser/ManifestPolicyTest.kt`
- `app/src/test/java/com/ekbotix/ekpayparser/RepositoryTest.kt`
- `build.gradle.kts`
- `core/build.gradle.kts`
- `core/src/main/kotlin/com/ekbotix/ekpayparser/crypto/ParserKeyStore.kt`
- `core/src/main/kotlin/com/ekbotix/ekpayparser/model/Models.kt`
- `core/src/main/kotlin/com/ekbotix/ekpayparser/network/SandboxApi.kt`
- `core/src/main/kotlin/com/ekbotix/ekpayparser/protocol/Protocol.kt`
- `core/src/main/kotlin/com/ekbotix/ekpayparser/repository/RetryPolicy.kt`
- `core/src/test/kotlin/com/ekbotix/ekpayparser/ProtocolTest.kt`
- `core/src/test/kotlin/com/ekbotix/ekpayparser/SandboxIntegrationTest.kt`
- `core/src/test/resources/parser-v1-vector.json`
- `docs/android/architecture.md`
- `docs/android/crypto.md`
- `docs/android/offline-queue.md`
- `docs/android/pairing.md`
- `docs/android/parser-v1-vector.json`
- `docs/android/protocol-v1.md`
- `docs/android/retry-policy.md`
- `docs/android/security.md`
- `docs/android/testing.md`
- `docs/api/internal-parser-api.md`
- `docs/architecture/parser-protocol.md`
- `docs/phase-7-files.md`
- `docs/phase-7-implementation.md`
- `docs/privacy/android-parser-privacy.md`
- `docs/security/parser-replay-protection.md`
- `gradle.properties`
- `gradle/wrapper/gradle-wrapper.jar`
- `gradle/wrapper/gradle-wrapper.properties`
- `gradlew`
- `gradlew.bat`
- `local.properties.example`
- `scripts/check-sandbox.mjs`
- `settings.gradle.kts`
