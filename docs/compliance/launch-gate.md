## Phase 6 additional blockers

Distributed per-device quotas + IP secondary abuse signal and strong pairing attempt
limits remain PRE-PRODUCTION BLOCKERS. Parser endpoints return 404 in production even
if env flag is true; private parser policy and all ingestion/verification policies remain
off. Hosted Auth/PostgREST/dashboard browser tests, log/APM redaction, sensitive-action
MFA/re-auth, Android Ed25519/Keystore device compatibility, encrypted offline queue,
real-source provenance and narrow consent/store permissions require separate review.
Migration PASS only concerns disabled synthetic infrastructure; it clears no launch gate.

# Commercial launch gate

Phase 5 synthetic ingestion does not clear provenance/regulatory launch gates. Real SMS,
Android/provider adapters, real customer data, payment verification, external merchant webhooks
and BD21topup remain disabled. Both synthetic flags and private DBA policies remain OFF on
public deployments. Ed25519 proves key possession, not authentic provider-origin evidence.

DRAFT / NOT LEGAL ADVICE — BLOCKED / Development only.

- Qualified written Bangladesh regulatory/legal classification, any required approvals and review of current Bangladesh Bank warnings.
- Merchant/provider contract and account-use authorization, ownership verification; no assumption personal/agent accounts are permissible.
- Distributed merchant/key-aware limits, quotas, monitoring and incident response.
- Isolated hosted Auth/PostgREST end-to-end tests and independent security review.
- Stable external HMAC secret, key-version rotation, TLS, logs/APM redaction, MFA/re-auth policy.
- Encryption/KMS, provenance-authenticated ingestion, real-source verification and canonical receiver/provider transaction namespace review. Phase 4's synthetic-only engine does not clear this gate.
- Privacy/consent, retention, deletion, dispute/complaint handling and merchant terms.
- Signed SSRF-safe webhook design and operational review before any delivery.

None of these gates is waived by migration PASS. EKPAY_DEVELOPMENT_API_ENABLED remains false on public deployments. Human schema approval is separate from commercial launch approval.

The Phase 4 DBA verification_policy must remain disabled on public deployments.
No server env flag or browser setting can enable it. Native PostgreSQL tests do not
replace isolated hosted PostgreSQL 17.6/Auth/PostgREST review; real integrations remain blocked.

Non-custodial or software-only architecture does not itself establish regulatory exemption. Regulatory classification must be confirmed against applicable Bangladesh law, Bangladesh Bank rules/guidance, and qualified regulatory/legal advice before commercial launch.
