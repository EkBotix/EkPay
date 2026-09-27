# Android sandbox pairing / rotation

Welcome, Not Paired, Pair, Pairing Success and Status flows use public UUID, token and
expected current version (0 first enrollment). The current Phase 6 flow is dashboard-
authorized re-pairing, not signed old-key rotation. App generates a new candidate key,
submits exact Phase 6 public-key/token-bound proof using /sandbox/parser/pair on the local
disposable bridge. This is NOT a hosted EkPay endpoint or protocol change.

Pair body uses exact Phase 6 strict fields: device_id, expected_version, pairing_token,
public_key and proof_signature. Protocol version is bound by the pairing domain; safe
metadata goes in the subsequent signed heartbeat because adding it to strict Phase 6
pair input would be rejected. No backend/service/API-key credential reaches the app.

Only confirmed matching device/version+1 response promotes the candidate. Token is never
persisted (including failure/rotation), cleared from screen after each attempt; transient
JVM/HTTP strings cannot guarantee immediate memory erasure. Pending alias survives crash;
uncertain success stops ingestion and requires owner-approved fresh-token/version review.
Existing active/recovery keys remain until confirmed next success, then retired locally.
Lost key never auto-generates a replacement for the same identity.

Generic token errors deliberately do not enumerate expired/used/existing key states.
Network errors preserve candidate and require another authorized token. Generic 401 is
paused identity, not affirmative remote revocation; backend Phase 6 deliberately hides
that distinction. Actual revoked identities are terminal and need new registration/key.
