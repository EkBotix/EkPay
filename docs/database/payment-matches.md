# Payment matches

Existing immutable matches gain explicit environment, merchant/environment/source/eligibility
booleans, decision_outcome and bounded reason_codes. Existing provider/amount/receiver/
transaction/time booleans remain. Matched requires every check and verified outcome.
Composite FKs bind both intent and evidence to tenant/environment. Unique(intent,evidence,
algorithm_version) provides stable replay. Service/client direct INSERT revoked.

Rule version uses existing algorithm_version. Decisions are append-only and replay returns
the original result, not a mutable reevaluation. Manual_review is never an authoritative
transaction; reviewed_by/review_reason remain future trusted reviewer identity fields.
Tenant members read evaluated flags/reasons/history; index supports chronological detail.
