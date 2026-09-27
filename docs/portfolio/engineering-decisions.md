## Phase 6 decisions

One device/one account for least privilege; dashboard-authorized re-pairing instead of
autonomous rotation; global retired-key uniqueness instead of reusable enrollment;
actual source-row writes instead of lock-only stale-snapshot assumptions; generic
authentication errors; normalized stable message hash separate from raw-body digest;
no public pairing transport until distributed abuse limits; hard production-off parser
routes even with flag true. SQL trusts service crypto attestation; not SMS provenance.

# Engineering decisions

Phase 5 chooses disposable local transport over HTTP, reuses parser registry/receipts, and
stores no raw payload because KMS is absent. Synthetic source/context authentication precedes
normalization; DB rechecks key/identity/freshness. Actual source revision writes protect stale
snapshots. Fresh-nonce retries reference one primary ingestion ID; message duplicates retain
receipts and conflicting observations are not silently discarded. Core matching stays adapter-
independent. No real SMS/provider integration or signing private key storage.

Phase 4 removes inherited live defaults rather than guessing environment. A DB-owner
policy starts disabled, with no service/client activation grant; engine rejects live.
Strict zero-skew time rule is versioned. Global provider reference uniqueness remains
conservative/unconfirmed. Ambiguity goes to review, never first-match selection.
Actual private revision writes serialize reference and tenant predicates; failed stale
transactions retry fresh. Normal service role cannot insert matches/transactions.
The synthetic engine adds no real ingestion/payment or webhooks. Earlier default-live
and pending-migration notes below are historical Phase 3/2 observations.

Phase 3 public positioning: Transaction Verification & Merchant Automation
Software, development/pre-launch. Default-off server gate; logical live is data
isolation, not provider activation. Reuse existing HMAC pepper/helper. Unique
receipt reservation is the concurrency barrier; normalized JSONB fingerprint,
intent/event/audit are atomic. No raw request is audited. Legacy environments
default live; references are unique within merchant/environment. Expiry is an
effective read state, never a payment outcome.

UI research (2026-09-27): screened all 22 supplied names via grouped public search;
authenticated dashboards were not entered. Selected general patterns from
[UddoktaPay payments](https://docs.uddoktapay.com/payments) (indexed list/filter docs),
[PipraPay reference](https://docs.piprapay.com/reference/overview) (indexed developer/key
navigation) and [ZiniPay docs](https://zinipay.com/docs) (endpoint/contract grouping).
Direct UddoktaPay/PipraPay fetches returned 403/502; indexed observations are not
screenshot-level inspection. BohudurPay/AsthaPay public developer docs were also
screened. Other names lacked reliable UI evidence; not all dashboards were inspected.

Original teal/minimal layout: expected-payment table, environment/status filters,
exact-reference search, safe labels, separate evidence/check/outcome sections and
API keys/docs/event navigation. Explicit empty/error/loading states; lists cap 50.
No fabricated metrics, branding/assets/source clones, checkout/collection/refund/
settlement features, query credentials, auto-verification or regulatory promises.
Reference products' regulatory claims are not endorsed or used as precedent.

Historical Phase 1/2 notes below:

Phase 2 decisions: owner/admin manage API keys; developer reads metadata; viewer
denied. User SSR/RLS handles reads and auth-derived onboarding; service-only RPCs
handle generated-key writes after independent server and DB role checks. HMAC
with an external stable pepper is used for high-entropy bearer keys. Onboarding
allows a first merchant only, with retry serialization and atomic audit. Team/
provider/webhook changes remain disabled; last-owner guard protects future writes.
Existing applied history is not rewritten; third migration remains pending review.

| Decision | Reason and tradeoff |
| --- | --- |
| Direct-to-merchant funds | Verification/notification MVP avoids wallet/custody features |
| Composite tenant FKs plus RLS | Integrity also applies to trusted writes; more indexes/DDL |
| Server-only verification | Browser/customer input cannot create authoritative records |
| Append-only observations/matches/history | Preserves provenance; retention/corrections require explicit workflows |
| Integer BDT minor units | Avoids floating-point amount ambiguity |
| Public metadata/private ciphertext split | Reduces broad dashboard exposure; server/KMS integration required |
| Ed25519 parser design | Store public key rather than a recoverable private signing key; enrolled device authenticity does not prove provider origin |
| Global(provider,transaction ID) unique key | Fail closed against cross-tenant replay; may reject legitimate namespace collisions |
| Immutable completed webhook attempts | Auditable history; durable claim queue remains separate future work |
| Local PostgreSQL security tests | Executable role/constraint evidence without production writes; not real Supabase or multi-session coverage |

Provider-ID evidence assessment (2026-09-27): provider-domain searches did not
establish an explicit global namespace guarantee for all four providers. The
bKash developer Search Transaction page could not be fetched in this environment;
third-party summaries were not treated as authoritative contracts. Therefore
global uniqueness is an **MVP policy assumption**, not a fact about providers.
Do not weaken it to merchant/account UUID alone: duplicate registration of one
physical receiver would then allow the same payment to verify twice. Keep the
conservative key, surface conflicts for trusted review and confirm provider
contracts before enabling real verification. If proven account-scoped IDs are
required, introduce a canonical globally deduplicated receiver namespace first,
then migrate the unique key with an explicitly reviewed data plan.

No exactly-once external delivery or guaranteed fraud prevention is claimed.
