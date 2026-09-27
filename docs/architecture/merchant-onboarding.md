# Atomic merchant onboarding

`/onboarding` requires a verified, confirmed non-anonymous account and no existing
membership. The server validates name/normalized slug and calls bootstrap_merchant
with the authenticated SSR client. No caller user ID is accepted.

The new migration's SECURITY DEFINER RPC derives auth.uid(), verifies the Auth
record's confirmation/non-anonymous state, validates fields, and serializes the
user's first bootstrap through a transaction advisory lock. Merchant, owner
membership and merchant.created audit row are inserted atomically. Audit failure
rolls back all three. Unique slug rejects collisions; errors do not reveal who
owns the unavailable slug.

An identical owner/name/slug retry returns the existing merchant without duplicate
audit history. Different requests from users with existing membership are denied.
Creating additional merchants/invitations is deferred. RPC has empty search_path,
qualified application tables, revoked PUBLIC/anon/service EXECUTE, and authenticated
EXECUTE only. Browser direct RPC is safe by the same database identity checks.

The onboarding RPC/migration remains unapplied. UI returns unavailable rather
than trying to bypass current merchant/member RLS. Synthetic local tests verify
success, unauthenticated/unconfirmed denial, duplicate slug and rollback.
