# Payment-intent API architecture

Request → development gate → strict Bearer parse → unique candidate lookup → shared HMAC verification → current key/merchant/scope context → bounded strict body → service-only transactional RPC → safe projection.

Two SECURITY DEFINER RPCs: api_create_payment_intent(uuid,text,jsonb) and api_read_payment_intent(uuid,text). Both set search_path='', qualify application references, revoke PUBLIC/anon/authenticated execute, grant only service_role. No caller merchant or actor is accepted. Internal ekpay_private.require_api_key and intent_api_json are invoker helpers with no client/service execute grants. Function owner can invoke them within the privileged RPC.

Unique database receipt is the concurrency barrier. RPC derives tenant/environment and verifies provider account linkage. One transaction creates receipt, created intent, payment_intent.created event and API-key actor audit. Audit/event payload contains only intent/key public identifiers, environment and timestamps; arbitrary request metadata never enters audit/event payload.

GET derives effective expiry and performs no worker/provider calls. UI uses user SSR/RLS, not service role. No payment_evidence/transaction/verified mutation endpoint exists. Read-only dashboard separates expectation, provenance/checks and outcome. Database schema is infrastructure, not licensed/approved payment operation.
