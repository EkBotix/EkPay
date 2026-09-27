# Payment intents and receipts

Phase 3 migration 20260927165346_development_payment_intent_api.sql is applied.
Its tenant/environment uniqueness, composite account FK and immutable receipt remain.
Phase 4 removes inherited live defaults from intent/account creation: environment must
be explicit, existing values unchanged. The new state guard prevents terminal revival
and review auto-approval; verified remains transaction-backed and immutable. See
[state machine](../architecture/payment-state-machine.md). Earlier Phase 3 design follows.

New api_idempotency_keys stores immutable hashes, intent linkage and timestamp. RLS enabled; all PUBLIC/anon/authenticated/service_role table privileges revoked. Only definer RPC owner writes it. Deferred FK permits reservation before intent insertion in one transaction; commit cannot retain orphan/cross-environment receipt.

Existing RLS is preserved, not weakened. Authenticated dashboard can read environment metadata but cannot write intents/evidence/transactions. Existing trusted service-role table grants are not broadened; new API exposes only create/read RPCs. Existing privileged verification infrastructure is not enabled through them. Intent tenant/environment update guard is invoker and PUBLIC execute revoked.

Events check gains payment_intent.created while retaining all previous allowed event types. Subscription/delivery remains unchanged and disabled. No key lookup index needed: prefix already uniquely indexed. Environment references validate all existing rows during apply; live empty baseline was inspected read-only, recheck before human-approved apply.
