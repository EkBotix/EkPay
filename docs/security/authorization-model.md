# Authorization model

Identity comes from server-verified Supabase Auth, never browser-supplied user ID
or user_metadata. Membership roles come from merchant_members on each request.
Merchant selection is checked against those memberships and active tenant status.
Server actions authorize independently; role-aware navigation is only presentation.

| Ability | Owner | Admin | Developer | Viewer |
| --- | --- | --- | --- | --- |
| Read payment/transaction/masked provider data | Yes | Yes | Yes | Yes |
| Read API-key metadata/webhook config | Yes | Yes | Yes | No |
| Create/revoke API keys | Yes | Yes | No | No |
| Team/audit dashboard | Yes | Yes | No | No |
| Change team/provider/webhook configuration in this UI | No | No | No | No |

Bootstrap makes only the authenticated confirmed user an owner. Ordinary client
membership mutations remain forbidden. New membership trigger rejects identity
reassignment and last-owner deletion/demotion, serialized on merchant row. Team
management remains read-only; future invitations/role changes must use owner-only
trusted transactions, preserve an owner, audit atomically and revalidate at DB level.
Admins must not grant owner role through a future API.

Service-role RPC parameters are a trust boundary: only the server sends the
verified actor ID. DB RPC independently validates its membership/role; it does
not independently verify an Auth token passed to the service-role connection.
Do not expose these RPCs through a generic proxy. No production API-key auth exists.
