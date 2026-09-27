# Android key protection and compatibility findings

minSdk 28 (Android 9) supports the Keystore AES-GCM protection used by sandbox fallback.
Native Ed25519 is attempted only on API 33+ using AndroidKeyStore EC generator with
ECGenParameterSpec(ed25519), DIGEST_NONE, SIGN/VERIFY. Success requires correct 32-byte raw
SPKI and functioning 64-byte signature. API level alone never establishes usable native
or hardware-backed Ed25519. Probe failure deletes partial native alias and fails closed
unless explicit sandbox fallback consent exists.

Android 13 AOSP adds Curve25519/Ed25519 handling in its
[Keystore generator](https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/android13-release/keystore/java/android/security/keystore2/AndroidKeyStoreKeyPairGeneratorSpi.java).
Hardware support depends on algorithm/device; review
[Android Keystore](https://developer.android.com/privacy-and-security/keystore).
These sources support capability probing, not universal OEM/StrongBox coverage. No
connected emulator/device was available to establish a device/API support matrix.

ParserKeyStore exposes generate/sign/publicKey/delete/protection only, no private export.
Native keys are non-exportable. Consented software fallback uses Bouncy Castle lightweight
Ed25519, encrypting the seed with a separate non-exportable Android Keystore AES-256 key,
random GCM IV and alias-bound authenticated data, atomic no-backup files. Never plaintext,
preferences key bytes or server key generation. Decrypted material necessarily appears
in the process temporarily and is vulnerable to process compromise; arrays are cleared
where accessible, no guaranteed managed-runtime zeroization. No production fallback claim.

Missing/corrupt seed/wrap key fails closed. Device backups/transfers excluded; uninstall/
Keystore loss requires new owner/admin registration or reviewed re-pairing. Hardware-
backed native-only commercial policy could require a narrower tested API/OEM matrix
(raising minSdk alone is insufficient). RFC 8032 public test seed is used only in tests;
vector artifacts contain public key/signature and synthetic facts, no real/device key.
