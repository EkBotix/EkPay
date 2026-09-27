import { notFound } from "next/navigation";
import { requireMerchantAccess, requireUser } from "@/lib/merchant-context";
import { ApiKeyForm, RevokeKeyForm } from "@/components/api-key-form";
import { canManageKeys } from "@/lib/validation";
type Definition = {
  title: string;
  table: string;
  columns: string;
  roles?: string[];
  empty: string;
};
const definitions: Record<string, Definition> = {
  evidence: {
    title: "Verification evidence",
    table: "payment_evidence",
    columns:
      "provider,source,amount_minor,currency,provider_timestamp,created_at",
    empty: "No verification evidence recorded.",
  },
  "event-logs": {
    title: "Developer event logs",
    table: "events",
    columns: "event_type,object_type,created_at",
    roles: ["owner", "admin", "developer"],
    empty: "No developer events recorded.",
  },
  payments: {
    title: "Payments",
    table: "payment_intents",
    columns:
      "public_id,merchant_reference,amount_minor,currency,status,created_at",
    empty: "No payment intents recorded.",
  },
  transactions: {
    title: "Transactions",
    table: "transactions",
    columns:
      "provider,provider_transaction_id,amount_minor,currency,verified_at",
    empty: "No verified transactions recorded.",
  },
  "provider-accounts": {
    title: "Provider accounts",
    table: "provider_accounts",
    columns:
      "provider,account_type,account_number_masked,verification_mode,is_active,created_at",
    empty: "No provider accounts configured.",
  },
  webhooks: {
    title: "Webhooks",
    table: "webhook_endpoints",
    columns: "url,enabled,event_subscriptions,created_at",
    roles: ["owner", "admin", "developer"],
    empty: "No webhook endpoints configured.",
  },
  developers: {
    title: "Developers",
    table: "api_keys",
    columns:
      "id,name,prefix,environment,abilities,created_at,last_used_at,status",
    roles: ["owner", "admin", "developer"],
    empty: "No API keys created.",
  },
  team: {
    title: "Team",
    table: "merchant_members",
    columns: "user_id,role,created_at",
    roles: ["owner", "admin"],
    empty: "No team memberships available.",
  },
  "audit-logs": {
    title: "Audit logs",
    table: "audit_logs",
    columns: "action,actor_type,target_type,target_id,created_at",
    roles: ["owner", "admin"],
    empty: "No audit events recorded.",
  },
};
export default async function SectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const merchant = await requireMerchantAccess();
  if (section === "api-docs") {
    if (merchant.role === "viewer")
      return (
        <div className="notice">
          Your role cannot access developer documentation.
        </div>
      );
    return (
      <>
        <p className="eyebrow">Developer reference · Pre-launch</p>
        <h1>Development API</h1>
        <div className="notice">
          Default-disabled. Test and live are isolated data environments;
          neither enables real verification.
        </div>
        <div className="card-grid">
          <section className="panel">
            <h2>Create expected payment</h2>
            <code>POST /api/v1/payment-intents</code>
            <p>
              Ability: payment_intents:create. Required Idempotency-Key, 8–128
              safe characters. Integer BDT minor units.
            </p>
          </section>
          <section className="panel">
            <h2>Read expected payment</h2>
            <code>GET /api/v1/payment-intents/&#123;id&#125;</code>
            <p>
              Ability: payment_intents:read. Only the key&apos;s merchant and
              environment. Created/pending never means paid.
            </p>
          </section>
        </div>
        <section className="panel">
          <h2>Authentication</h2>
          <code>Authorization: Bearer ek_test_REPLACE_ME</code>
          <p>
            Header only. No query or cookie credentials. Keys shown once;
            owners/admins manage them.
          </p>
          <h2>Request</h2>
          <pre>
            {JSON.stringify(
              {
                amount: 82000,
                currency: "BDT",
                reference: "ORDER-12345",
                provider: "bkash",
                provider_account_id: "REPLACE_WITH_SYNTHETIC_ACCOUNT_UUID",
                metadata: {},
              },
              null,
              2,
            )}
          </pre>
          <p>
            Never submit merchant_id, environment, status or verification proof.
            Metadata is limited to 4 KiB and 20 keys. Default expiry: 30
            minutes; maximum: 24 hours.
          </p>
          <h2>Errors and retries</h2>
          <p>
            401 invalid_api_key; 403 insufficient_scope; 409
            idempotency_conflict; 404 resource_not_found. Reuse the same key and
            semantic body after network uncertainty. A changed body requires a
            new idempotency key and reference.
          </p>
          <p>
            Distributed rate limits and regulatory review are pre-production
            launch blockers. Full API, security and compliance specifications
            are in the repository docs.
          </p>
        </section>
      </>
    );
  }
  if (section === "settings")
    return (
      <>
        <p className="eyebrow">Settings</p>
        <h1>Merchant details</h1>
        <div className="panel">
          <dl>
            <dt>Name</dt>
            <dd>{merchant.name}</dd>
            <dt>Slug</dt>
            <dd>{merchant.slug}</dd>
            <dt>Your role</dt>
            <dd>{merchant.role}</dd>
          </dl>
          <p>Merchant and team changes are read-only in this phase.</p>
        </div>
      </>
    );
  if (!Object.hasOwn(definitions, section)) notFound();
  const definition = definitions[section];
  if (!definition) notFound();
  if (definition.roles && !definition.roles.includes(merchant.role))
    return (
      <div className="panel">
        <h1>Restricted</h1>
        <p>Your current role cannot access this section.</p>
      </div>
    );
  const { client } = await requireUser();
  const { data, error } = await client
    .from(definition.table)
    .select(definition.columns)
    .eq("merchant_id", merchant.merchantId)
    .order("created_at", { ascending: false })
    .limit(50);
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const columns = definition.columns.split(",").filter((c) => c !== "id");
  return (
    <>
      <p className="eyebrow">Merchant workspace</p>
      <h1>{definition.title}</h1>
      {(section === "evidence" || section === "event-logs") && (
        <div className="notice">
          Development records only. Evidence ingestion, authoritative
          verification and webhook delivery are disabled.
        </div>
      )}
      {section === "provider-accounts" && (
        <div className="notice">
          <p>
            Account setup is not available yet. Existing masked accounts appear
            below.
          </p>
          <p>
            Providers: bKash · Nagad · Rocket · Upay. Types: personal · agent ·
            merchant. Modes: sms · provider_api · manual · hybrid.
          </p>
          <button disabled>Add provider account — unavailable</button>
        </div>
      )}
      {section === "webhooks" && (
        <div className="notice">
          Endpoint configuration is read-only here. Webhook sending is not
          enabled.
        </div>
      )}
      {section === "team" && (
        <div className="notice">
          Memberships are read-only. Invitations and role changes are not
          enabled.
        </div>
      )}
      {error ? (
        <div className="panel" role="status">
          <h2>Unavailable</h2>
          <p>
            This section could not be loaded. Application setup or service
            access may be incomplete.
          </p>
        </div>
      ) : rows.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c}>{c.replaceAll("_", " ")}</th>
                ))}
                {section === "developers" && canManageKeys(merchant.role) && (
                  <th>Action</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={String(row.id ?? index)}>
                  {columns.map((c) => (
                    <td key={c}>
                      {row[c] === null
                        ? "—"
                        : Array.isArray(row[c])
                          ? (row[c] as string[]).join(", ")
                          : String(row[c])}
                    </td>
                  ))}
                  {section === "developers" && canManageKeys(merchant.role) && (
                    <td>
                      {row.status === "active" ? (
                        <RevokeKeyForm
                          merchantId={merchant.merchantId}
                          keyId={String(row.id)}
                        />
                      ) : (
                        "Revoked"
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <small>Showing up to 50 recent records.</small>
        </div>
      ) : (
        <div className="panel empty-state">
          <h2>{definition.empty}</h2>
          <p>Records will appear here when available for this merchant.</p>
        </div>
      )}
      {section === "developers" && canManageKeys(merchant.role) && (
        <ApiKeyForm merchantId={merchant.merchantId} />
      )}
      {section === "developers" && !canManageKeys(merchant.role) && (
        <p>
          Your developer role can read key metadata. Ask an owner or admin to
          create or revoke a key.
        </p>
      )}
    </>
  );
}
