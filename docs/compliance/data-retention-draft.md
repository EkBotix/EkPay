# Data retention — DRAFT

No retention scheduler or legal retention period is implemented. This document
is an engineering proposal, not a legal requirement or deletion guarantee.

| Data | Proposed direction; approval still needed |
| --- | --- |
| Raw encrypted SMS/provider payload | Minimize collection; choose a short troubleshooting window |
| Verified transactions and minimal evidence metadata | Retain for reconciliation/disputes; duration not yet set |
| Parser nonce/ingestion/message identities | Preserve replay rejection for the supported replay horizon |
| Events and delivery attempts | Retain for support/replay; bound response excerpts |
| Audit metadata/IP/user-agent | Minimize fields; agree investigation window |
| Signing/encryption keys | Retain decrypt/verify capability for retained data; retire deliberately |

Append-only triggers and RESTRICT FKs intentionally prevent routine deletion.
Any future erasure must use a reviewed privileged workflow that preserves minimal
replay tombstones and financial provenance where justified, accounts for backups,
and records the action without exposing removed sensitive data. Do not promise
cryptographic erasure before evaluating shared key domains and KMS/backups.

Before launch: approve periods and owners, define merchant offboarding and data
requests, test deletion/backup expiry, and assess jurisdiction-specific obligations
with qualified counsel. The empty baseline is not a production retention system.
