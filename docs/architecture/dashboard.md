# Merchant dashboard

Routes: `/dashboard`, `/dashboard/payments`, `/dashboard/transactions`,
`/dashboard/provider-accounts`, `/dashboard/webhooks`, `/dashboard/developers`,
`/dashboard/team`, `/dashboard/audit-logs`, `/dashboard/settings`.

A protected dynamic layout supplies membership-checked merchant context,
navigation, role badge, merchant switcher and sign-out. Section routes repeat
authorization rather than trusting layout visibility. Read queries use the user
SSR client/RLS, explicit safe columns and merchant filter, with up to 50 recent
rows. Unknown sections return not-found. Restricted, unavailable, loading and
empty states are distinct; no fabricated metrics or records are displayed.

Owner/admin can create/revoke API keys. Developer can read key metadata and webhook
configuration. Viewers cannot access developer/webhook sections; team/audit UI is
owner/admin only. Settings, team, provider accounts and webhooks are read-only.
Provider-account creation stays disabled until application encryption/KMS exists.

Merchant cookie is a preference, not authorization: every selection is checked
against live memberships/active status. Stale implicit preferences fall back to
an active membership; an explicit unauthorized merchant ID fails closed.
Dashboard uses request-time reads, private/no-store responses and no user-data
cross-request cache. Authenticated UI walkthrough requires a safe test Auth setup
and the reviewed Phase 2 migration; it was not tested with production writes.
