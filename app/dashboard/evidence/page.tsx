import { requireMerchantAccess, requireUser } from "@/lib/merchant-context";

export default async function EvidencePage() {
  const merchant = await requireMerchantAccess();
  const { client } = await requireUser();
  const evidence = await client.from("payment_evidence")
    .select("id,environment,provider,source,amount_minor,currency,provider_transaction_id,created_at,source_device_id,source_key_version,source_timestamp,authentication_method,normalization_version")
    .eq("merchant_id", merchant.merchantId).order("created_at", { ascending: false }).limit(50);
  const ids = (evidence.data ?? []).map(e => e.id);
  const matches = ids.length ? await client.from("payment_matches")
    .select("payment_evidence_id,decision_outcome,created_at")
    .eq("merchant_id", merchant.merchantId).in("payment_evidence_id", ids).order("created_at", { ascending: false }).limit(250) : { data: [], error: null };
  return <>
    <p className="eyebrow">TEST / DEVELOPMENT · Transaction evidence</p>
    <h1>Verification evidence</h1>
    <div className="notice">Synthetic ingestion is disabled by default. Real sources and payment verification are not active.</div>
    {evidence.error || matches.error ? <div className="notice">Evidence history is unavailable. No result is inferred.</div> : !evidence.data?.length ?
      <section className="panel"><p>No evidence recorded. No observations are inferred from pending payment intents.</p></section> :
      evidence.data.map(row => {
        const outcomes = [...new Set(matches.data?.filter(m => m.payment_evidence_id === row.id).map(m => m.decision_outcome))];
        return <article className="panel" key={row.id}>
          <h2>{row.provider} · {(Number(row.amount_minor) / 100).toFixed(2)} {row.currency}</h2>
          <p>Environment: {row.environment} · Source: {row.source}</p>
          <p>Transaction reference: {row.provider_transaction_id ? `••••${row.provider_transaction_id.slice(-4)}` : "Missing"}</p>
          <p>Received: {row.created_at} · Source timestamp: {row.source_timestamp ?? "Not recorded"}</p>
          <p>Source identity: {row.source_device_id ?? "Legacy fixture / unattested"} · Key version: {row.source_key_version ?? "Unavailable"}</p>
          <p>Authentication: {row.authentication_method ?? "Not attested"}</p>
          <p>Normalization: {row.normalization_version ?? "Legacy fixture"}</p>
          <p>Recorded decisions: {outcomes.length ? outcomes.join(", ") : "Verification pending / not evaluated"}</p>
        </article>;
      })}
    {evidence.data?.length === 50 ? <p>Showing the latest 50 evidence records.</p> : null}
    {matches.data?.length === 250 ? <p>Showing up to 250 evaluations; additional decisions may exist.</p> : null}
  </>;
}
