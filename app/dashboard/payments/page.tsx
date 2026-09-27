import Link from "next/link";
import { effectiveIntentState, requestTime } from "@/lib/verification";
import { requireMerchantAccess, requireUser } from "@/lib/merchant-context";
const states = [
  "created",
  "pending",
  "manual_review",
  "verified",
  "failed",
  "expired",
];
export default async function Payments({
  searchParams,
}: {
  searchParams: Promise<{ environment?: string; status?: string; q?: string }>;
}) {
  const merchant = await requireMerchantAccess();
  const { client } = await requireUser();
  const filter = await searchParams;
  const now = await requestTime();
  const environment = filter.environment === "live" ? "live" : "test";
  let query = client
    .from("payment_intents")
    .select(
      "public_id,merchant_reference,amount_minor,currency,provider,status,environment,expires_at,created_at",
    )
    .eq("merchant_id", merchant.merchantId)
    .eq("environment", environment);
  if (states.includes(filter.status ?? ""))
    query = query.eq("status", filter.status!);
  if (filter.q && filter.q.length <= 128)
    query = query.eq("merchant_reference", filter.q);
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(50);
  return (
    <>
      <p className="eyebrow">Expected payments</p>
      <h1>Verification workspace</h1>
      <p>
        Expected amounts are records, not proof of receipt. No live verification
        is enabled.
      </p>
      <form className="filter-bar">
        <label>
          Environment
          <select name="environment" defaultValue={environment}>
            <option value="test">Test</option>
            <option value="live">Live — logical only</option>
          </select>
        </label>
        <label>
          Stored status
          <select name="status" defaultValue={filter.status}>
            <option value="">All states</option>
            {states.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Exact reference
          <input name="q" maxLength={128} defaultValue={filter.q} />
        </label>
        <button>Filter records</button>
      </form>
      {error ? (
        <div className="notice">
          Records unavailable. Phase 3 schema or service access may be
          incomplete.
        </div>
      ) : !data?.length ? (
        <div className="panel empty-state">
          <h2>No expected-payment records</h2>
          <p>
            Create synthetic intents through the development API after schema
            review and isolated setup.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Reference</th>
                <th>Expected amount</th>
                <th>Provider</th>
                <th>State</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => {
                const state = effectiveIntentState(
                  row.status,
                  row.expires_at,
                  now,
                );
                return (
                  <tr key={row.public_id}>
                    <td>
                      <Link href={`/dashboard/payments/${row.public_id}`}>
                        {row.merchant_reference}
                      </Link>
                    </td>
                    <td>
                      {(Number(row.amount_minor) / 100).toFixed(2)}{" "}
                      {row.currency}
                    </td>
                    <td>{row.provider}</td>
                    <td>
                      <span className="status-badge">
                        {state.replaceAll("_", " ")}
                      </span>
                    </td>
                    <td>
                      {new Date(row.created_at).toLocaleString("en-GB", {
                        timeZone: "Asia/Dhaka",
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <small>
            Up to 50 recent records. Expiry is derived; status filter uses
            stored state.
          </small>
        </div>
      )}
    </>
  );
}
