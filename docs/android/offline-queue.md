# Durable synthetic queue

Room schema v1 stores ingestion UUID (primary key), public device binding, path, AES-GCM
encrypted normalized body, created time, attempt count, next attempt, safe error and state.
No private key/token/signature/nonce in Room. Operational indexes/status remain plaintext
app-private metadata; payload encryption is not full database encryption. Android backup
and transfer disabled. Queue items cannot move to a new device identity automatically.

Max 100 retained rows; pending items older than 24h become permanent errors. Non-pending
rows older than 24h pruned during enqueue/sync; no background deletion promise while app
remains paused/off forever. Unique WorkManager immediate/15-minute periodic tasks with
network constraint use one repository mutex (single app process). DB evidence identity is
the final duplicate guard across ambiguous network completion or crash before local commit.

Offline enqueue retains logical facts and ingestion ID. Send-time timestamp/nonce/signature
are fresh; retry never generates a new logical message. Exponential next-attempt timestamp
is persisted. 15-minute periodic scheduling means actual retry can occur later than its
minimum next-attempt time; no exact alarm/realtime delivery promise. OS/OEM battery limits
and kill/reboot behavior require instrumentation testing.
