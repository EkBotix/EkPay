import Link from "next/link";
import {
  getUserMerchants,
  requireMerchantAccess,
  AccessError,
} from "@/lib/merchant-context";
import { signOut } from "@/app/actions/auth";
import { switchMerchant } from "@/app/actions/merchant";
export const dynamic = "force-dynamic";
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let merchant;
  try {
    merchant = await requireMerchantAccess();
  } catch (error) {
    if (!(error instanceof AccessError)) throw error;
    return (
      <main className="auth-page">
        <div className="panel">
          <h1>Workspace unavailable</h1>
          <p>
            Your membership may be restricted, or the service may be
            unavailable. Try again later or contact your merchant owner.
          </p>
          <Link href="/login">Return to sign in</Link>
          <form action={signOut}>
            <button className="secondary">Sign out</button>
          </form>
        </div>
      </main>
    );
  }
  const memberships = await getUserMerchants();
  const links = [
    ["", "Overview"],
    ["payments", "Payments / Verification"],
    ["transactions", "Transactions"],
        ["provider-accounts", "Provider accounts"],
        ["parser-devices", "Parser devices"],
    ["evidence", "Verification evidence"],
    ["settings", "Settings"],
  ];
  if (merchant.role !== "viewer")
    links.push(
      ["webhooks", "Webhooks"],
      ["developers", "API keys"],
      ["api-docs", "API docs"],
      ["event-logs", "Event logs"],
    );
  if (merchant.role === "owner" || merchant.role === "admin")
    links.push(["team", "Team"], ["audit-logs", "Audit logs"]);
  return (
    <div className="workspace">
      <aside className="sidebar">
        <Link href="/dashboard" className="brand">
          EK<span>PAY</span>
        </Link>
        <p className="eyebrow">Merchant workspace</p>
        <form action={switchMerchant} className="merchant-switch">
          <label>
            Current merchant
            <select name="merchantId" defaultValue={merchant.merchantId}>
              {memberships
                .filter((m) => m.status === "active")
                .map((m) => (
                  <option key={m.merchantId} value={m.merchantId}>
                    {m.name}
                  </option>
                ))}
            </select>
          </label>
          <button className="secondary">Switch</button>
        </form>
        <nav aria-label="Merchant navigation">
          {links.map(([path, label]) => (
            <Link key={path} href={`/dashboard${path ? "/" + path : ""}`}>
              {label}
            </Link>
          ))}
        </nav>
        <form action={signOut}>
          <button className="secondary">Sign out</button>
        </form>
      </aside>
      <div className="workspace-content">
        <header className="workspace-header">
          <div>
            <small>Development / Pre-launch workspace</small>
            <strong>{merchant.name}</strong>
          </div>
          <span className="role-tag">{merchant.role}</span>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
