import Link from "next/link";
import { requireMerchantAccess } from "@/lib/merchant-context";
export default async function DashboardPage() {
  const merchant = await requireMerchantAccess();
  return (
    <>
      <p className="eyebrow">Overview</p>
      <h1>Your merchant workspace</h1>
      <p>
        Review expected-payment records for {merchant.name}. This is development
        infrastructure; live verification and provider connections are disabled.
      </p>
      <div className="card-grid">
        <section className="panel">
          <h2>Payment records</h2>
          <p>View recorded payment intents and verified transaction history.</p>
          <Link href="/dashboard/payments">View payments →</Link>
        </section>
        <section className="panel">
          <h2>Provider accounts</h2>
          <p>View your masked merchant-owned provider accounts.</p>
          <Link href="/dashboard/provider-accounts">View accounts →</Link>
        </section>
        {merchant.role !== "viewer" && (
          <section className="panel">
            <h2>Developer settings</h2>
            <p>
              Manage scoped credentials and review development API
              documentation.
            </p>
            <Link href="/dashboard/developers">Open developer settings →</Link>
          </section>
        )}
      </div>
      <div className="notice">
        No live payment verification, parser ingestion or webhook sending is
        enabled in this phase.
      </div>
    </>
  );
}
