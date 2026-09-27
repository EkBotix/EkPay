# Raw payload handling

No raw SMS/provider payload persistence in Phase 5. Synthetic bodies contain invented
non-sensitive references/hashes/amounts; retained only in local process memory during tests.
No KMS runtime exists, so no fabricated encryption or plaintext fallback is implemented.
Raw payload/encrypted-reference/secret fields are rejected by the strict ingestion body.

Existing ekpay_private.evidence_payloads remains restricted ciphertext + external key reference,
append-only, inaccessible to ordinary tenant users. Real raw retention needs reviewed application
encryption/KMS/key-version/consent/retention policy before use. No secret/private key material is
stored by this phase. Synthetic account encryption placeholders are plainly fixtures, not claims
of runtime encryption. Production/test account details must never be used in fixtures.

Public evidence: normalized safe facts and provenance only. Receipts contain body/semantic hashes,
nonce and source timestamps, never body/signature. Audit/events contain safe source/request IDs,
state/key version/normalization version, no raw bytes, receiver hashes, account numbers or keys.
Errors from orchestration expose classes invalid_source/invalid_evidence/disabled, not raw Zod
inputs. Future logging/APM must preserve these restrictions; no request-body logging added.
