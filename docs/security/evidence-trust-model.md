# Evidence trust model

Current Phase 5 source boundary: [trusted ingestion](../architecture/evidence-ingestion.md)
adds synthetic signed-source authentication before normalization and service-only persistence.
The Phase 4 fixture helper below is not the authoritative ingress. Neither normalizer alone
proves source authenticity; actual source integrations remain disabled.

`lib/verification/evidence.ts` is a server-only strict synthetic fixture normalizer.
It throws outside NODE_ENV=test and is not imported by any application ingestion route.
It requires explicit test environment, tenant/account UUIDs, known source/provider,
positive safe integer BDT minor units, precomputed 64-hex receiver/sender/message hashes,
ingestion UUID and ISO timestamp (or explicit null). Transaction references trim and
uppercase to the bounded DB grammar; timestamps normalize UTC. Metadata permits only
a short fixture_label and is not persisted as broad raw evidence. Unknown fields and
caller-supplied trust/status/raw SMS/secrets are rejected.

Normalization is NOT authentication. trust_state is assigned synthetic by the fixture
helper, never a customer assertion. Real SMS parser/provider API authentication, receiver
canonicalization and encrypted raw payload retention remain unimplemented. sms_parser
rows still require existing device/request provenance, but no real parser adapter exists.
Manual/untrusted/SMS sources never auto-verify in this rule. Only synthetic provider_api
test evidence can pass source_trusted, behind a default-disabled DBA policy.

Fixtures use invented labels, hashes, encrypted-placeholder strings and FIXTURE references;
no phone/account numbers or genuine provider transaction IDs. Native test harness creates
its own random-password loopback cluster; no external connection URL is accepted. No helper
can activate hosted policy through an env flag or service-role call. Never enable the policy
on public deployments or feed it real account/payment data.
