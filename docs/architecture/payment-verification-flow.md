# Phase 4 implemented synthetic flow

Expected intent → normalized synthetic evidence → service-only DB evaluation →
immutable match → optional authoritative transaction → safe event/audit.
Only test environment behind disabled DBA gate; no real ingestion or webhook delivery.
The detail UI reads actual flags/reasons and masked account, with empty/error states.
See [exact engine rules](payment-verification-engine.md) and [state machine](payment-state-machine.md).

Earlier design notes follow; future real-source behavior is not enabled.

# Verification flow — development foundation

Expected Payment → Evidence Detected → Verification Checks (provider, amount, receiver, transaction ID, time window) → Verified / Manual Review / Failed / Expired.

Phase 3 creates only expected-payment records. Structural UI labels evidence ingestion and checks disabled/not evaluated, never fabricates success. No caller transaction ID is accepted as proof. Future observations require authenticated trusted ingestion and deterministic comparison; customer claims and SMS alone do not establish authoritative provider truth.

Conceptual state progression: created → pending → verified, manual_review, failed or expired. Existing DB states are preserved; public API cannot set any state and initially writes created. Effective expiry is computed without persisted worker state and never means paid. Verified state remains subject to the applied authoritative-transaction DB guard. Future transition/worker behavior needs separate authorization and review.

Customer funds would flow directly to merchant-owned provider accounts. EkPay intends to receive evidence/data and notify merchant systems; all live ingress, verification and notification remains disabled. See compliance launch gate; architecture itself establishes no regulatory exemption.
