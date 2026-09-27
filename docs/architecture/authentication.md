# Authentication implementation

Phase 2 uses pinned @supabase/ssr and supabase-js packages. Browser clients use
only the public URL/publishable key; request-scoped server clients use the same
key plus SSR cookies and RLS. A separate server-only privileged client is used
only for API-key management RPCs, without browser cookies or persisted sessions.

Next.js 16 `proxy.ts` refreshes/verifies claims and copies renewed cookies to both
the request and response. Pages/actions independently call getUser for a current
Auth record, reject anonymous/unconfirmed accounts and resolve live memberships.
Cookie contents/getSession are never treated as proof of identity. React.cache
deduplicates reads within a request, not across users.

Password sign-up/sign-in/out use server actions with Zod validation. Sign-up
responds generically regardless of account existence; sign-in has a generic
credential/confirmation/unavailability error. `/auth/callback` exchanges a PKCE
code and redirects only to a fixed local destination. No social auth or recovery
flow is implemented. Auth settings, confirmation templates, SMTP/redirect allowlist
and rate limits still need operator verification; no real account was created/tested.

Supabase SSR cookies are browser-accessible for the supported browser client;
they are SameSite=Lax and Secure in production, not claimed to be HttpOnly.
The merchant preference cookie is HttpOnly. Auth data remains dynamic/private,
no-store. XSS prevention and provider protections remain necessary.

Reference: [Supabase SSR guidance](https://supabase.com/docs/guides/auth/server-side/creating-a-client).
