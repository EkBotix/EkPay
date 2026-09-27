# Synthetic verification engine

Phase 4 is transaction evidence verification software, development/pre-launch.
No real ingestion source, provider call, customer confirmation or external webhook
is implemented. The only decision engine is the service-role-only database RPC
`public.verify_payment_evidence(intent_uuid,evidence_uuid)`; there is no HTTP route.
The private DBA-controlled policy starts disabled and cannot be changed by service
role. Even when enabled in disposable tests, the engine rejects live objects.

Rule `ekpay-verification-synthetic-v1` evaluates merchant, environment, provider,
exact integer amount/currency, account ID AND receiver identity hash, transaction
reference presence/consumption, source trust, time and current intent eligibility.
Individual booleans, reasons and rule version remain explainable in immutable matches.
No fuzzy scoring, AI, frontend redirect or customer transaction ID proves payment.

Verified requires all checks, active merchant/account, synthetic provider_api evidence,
created/pending unexpired intent, no conflicting reference facts and at most one
plausible target. Conflicts compare tenant/environment/account/amount/currency/receiver/
provider time globally within provider+reference. Multiple plausible intents include
manual_review targets and never select the first row. Identical duplicate observations
are harmless; a consumed reference still cannot create another transaction.

Decision order is deliberate: provider/amount/receiver mismatch or missing reference
is failed; relevant conflict/ambiguity/untrusted source/consumed reference/manual-review
state/missing provider time is manual_review; other time/state failures are failed.
Missing target returns no_match without an invalid FK-backed match/event/audit.
Unknown evidence and cross-tenant/environment calls are permission errors, not decisions.
A failed observation does not cancel an otherwise eligible intent; expired targets
are persisted expired. Manual_review transitions eligible targets to review, never verified.

Time policy is centrally defined by this immutable SQL rule version: zero early/late
tolerance; provider time is inclusive [intent.created_at,intent.expires_at] and no later
than DB clock. The intent must still be unexpired at decision/insertion. Missing time
requires review. No client clock is consulted. Future tolerance changes require a new
reviewed rule version/migration, not an unversioned environment override.

RPC writes match, optional transaction, intent transition, events and system audit
atomically. Repeated (intent,evidence,rule) returns the recorded decision, including
failed/review decisions, without duplicate events/audits. A later change does not rewrite
history; operator resolution is deliberately absent. Evidence arriving AFTER committed
verification cannot retroactively undo it; future ingestion/dispute controls need review.

See [concurrency](../security/verification-concurrency.md), [state machine](payment-state-machine.md)
and [trust boundary](../security/evidence-trust-model.md).
