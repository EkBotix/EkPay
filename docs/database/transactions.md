# Authoritative transactions

Phase 4 adds explicit test/live environment and fixed rule_version. Composite tenant/env
FKs bind intent/evidence/match. Existing unique intent/evidence/match and global provider+
transaction reference constraints remain; global provider namespace is an unconfirmed
conservative assumption, not a claim about actual providers.

Only service-role RPC may insert using SECURITY DEFINER; direct service/client INSERT
is revoked. Existing immutable trigger blocks UPDATE/DELETE even for normal trusted DB
writes. Validator adds default-disabled policy, synthetic test provider_api trust, explicit
environment, all match flags, current eligible/unexpired target and strict DB time checks,
while preserving earlier provider/account/amount/currency/receiver/source/reviewer guards.

AFTER INSERT synchronizes intent verified/verified_at and records exactly one payment.verified
event with environment/evidence/rule metadata. Match, transaction, intent, event and decision
audit share the RPC transaction; any failure rolls all back. Tenant members read via RLS.
No real payment verification, recovery/reversal, balances or fund-handling features exist.
