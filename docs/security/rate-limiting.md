# Rate limiting — PRE-PRODUCTION BLOCKER

No production-grade distributed limiter is implemented. Default-disabled API must stay private in development. In-memory/IP-only limits would not satisfy distributed/key-aware protection, so no misleading limiter is claimed.

Proposed design, not active configuration: globally bounded authentication-failure budget plus edge IP/ASN and hashed credential-identifier budgets; do not persist/log full Authorization values. For authenticated requests enforce both merchant/environment and individual key counters: create target 30/minute (burst 10), reads 120/minute (burst 30), configurable per reviewed plan. Also cap concurrent requests, daily object quota and key count.

Use atomic shared counters with bounded TTL, fail-closed policy for write-limit backend outages, 429 stable rate_limited contract and Retry-After. Validate multi-region/proxy attribution, rotating-key circumvention, invalid-prefix spray and memory cardinality. Thresholds above are starting design targets requiring load/abuse tests.

Launch gate includes edge body/time limits, authentication failure monitoring, key/merchant-aware limits and alerts, quota review, dashboards and incident response. CORS is not authorization or abuse protection.
