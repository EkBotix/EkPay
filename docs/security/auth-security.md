# Auth security status

Implemented: cookie SSR client split, claim refresh proxy, current getUser checks,
confirmed/non-anonymous requirement, server validation, generic auth errors,
fixed callback destination, dynamic private pages and security headers.
Server Components do not write cookies; proxy refreshes before render. Writable
action/callback clients propagate cookie writes without masking setter errors.

Headers: nosniff, frame DENY, no-referrer and disabled camera/microphone/geolocation.
No speculative CSP is added. Auth callback/referrer handling reduces code exposure;
HTTPS deployment and origin settings remain operator responsibilities.
Secret values are not printed or included in error messages/audits.

Supabase Auth handles passwords and provider rate limits. This work does not
configure SMTP, CAPTCHA, MFA, recovery, production allowlists or account quotas.
No live signup/email/password test was performed. Verify these on an isolated
test environment before launching registration. Publishable key is public by
design and relies on RLS; service-role credential is server-only and isolated.

Browser-accessible SSR tokens are not HttpOnly; XSS would threaten sessions. Avoid
untrusted HTML, prevent secret capture by analytics and evaluate a tested CSP
before production launch. Deleted/sign-out sessions also need provider/token
lifetime consideration; getUser is used for current account-sensitive checks.
