# Bounded retry / terminal handling

Network IOException/timeouts, 5xx and 409 retry_request are retryable. Eight attempts
maximum, 30s doubling backoff capped at one hour, minimum next attempt persisted. No
second automatic OkHttp connection retry or redirects; one HTTP attempt per queue attempt.
Worker scheduling/OS can delay delivery beyond backoff. Transient processing is serialized.

2xx accepted; 400/404/413/other 409 permanent; protocol/signature/request conflicts are not
blindly retried. 401 pauses all identity work for operator review, including current item,
because Phase 6's generic error does not disclose revoked versus bad signature/time/key.
No automatic key replacement/reactivation. Explicit/local confirmed revoked state is
terminal and requires a new server public identity. Candidate pairing blocks all ingestion
until confirmed success; queue for another identity never silently rebinds.

Wrong/corrupt key storage immediately sets re_pair_required and pauses pending work.
No fake server clock or expanding freshness window; operator verifies local time and
backend enrollment. Logs preserve safe status/queue state only, not error stack/body.
