# Privacy policy — DRAFT, NOT PUBLISHED

This technical draft describes the current development state and proposed schema.
It is not legal advice, an operational privacy promise or evidence of compliance.
The reviewed live core tables were empty; no operational customer payment flow
was demonstrated. Operator identity, privacy contact, legal basis, applicable
jurisdiction and user-request procedure must be supplied/reviewed before publication.

The intended product verifies payments to merchant-owned accounts and notifies
merchant integrations. Proposed data includes merchant/member identities, payment
amounts/references/provider IDs, account display/ciphertext, parser request hashes,
encrypted evidence, device public keys/token hashes, webhook config and delivery
metadata, and audit IP/user-agent fields. Raw SMS should be minimized, encrypted
before storage and unavailable to normal dashboard users.

Intended sharing is limited to the authorized merchant, trusted verification
operators and necessary infrastructure services; merchant endpoints receive only
sanitized subscribed events. Infrastructure transfer locations, processor terms
and actual access procedures are not verified here. Do not claim data is never
shared, instantly erased or automatically anonymized.

No wallet custody, certifications or regulatory approvals are asserted. Retention,
access/correction/deletion handling, breach communication and support contacts
remain operational decisions. See [retention draft](data-retention-draft.md).
