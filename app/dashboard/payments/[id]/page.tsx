import { notFound } from "next/navigation";
import { effectiveIntentState, requestTime } from "@/lib/verification";
import { requireMerchantAccess, requireUser } from "@/lib/merchant-context";
import { publicIdSchema } from "@/lib/api/contract";

export default async function PaymentDetail({ params }: { params: Promise<{ id: string }> }) {
  const merchant = await requireMerchantAccess();
  const { client } = await requireUser();
  const { id } = await params;
  if (!publicIdSchema.safeParse(id).success) notFound();
  const { data, error } = await client.from("payment_intents")
    .select("id,public_id,merchant_reference,amount_minor,currency,provider,provider_account_id,status,environment,created_at,expires_at,verified_at")
    .eq("merchant_id", merchant.merchantId).eq("public_id", id).maybeSingle();
  if (error) return <div className="notice">Verification record is unavailable.</div>;
  if (!data) notFound();
  const [account, matches, transaction] = await Promise.all([
    client.from("provider_accounts").select("account_number_masked,display_name")
      .eq("merchant_id", merchant.merchantId).eq("id", data.provider_account_id).maybeSingle(),
    client.from("payment_matches")
      .select("id,payment_evidence_id,algorithm_version,provider_match,amount_match,receiver_match,transaction_id_match,time_match,merchant_match,environment_match,source_trusted,intent_eligible,decision_outcome,reason_codes,created_at")
      .eq("merchant_id", merchant.merchantId).eq("payment_intent_id", data.id).eq("environment", data.environment)
      .order("created_at", { ascending: true }).limit(50),
    client.from("transactions").select("id,verified_at,rule_version")
      .eq("merchant_id", merchant.merchantId).eq("payment_intent_id", data.id).eq("environment", data.environment).maybeSingle(),
  ]);
  const evidenceIds = [...new Set((matches.data ?? []).map(m => m.payment_evidence_id))];
  const evidence = evidenceIds.length ? await client.from("payment_evidence")
    .select("id,source,trust_state,provider_timestamp,created_at")
    .eq("merchant_id", merchant.merchantId).eq("environment", data.environment).in("id", evidenceIds) : { data: [], error: null };
  const unavailable = account.error || matches.error || transaction.error || evidence.error;
  const state = effectiveIntentState(data.status, data.expires_at, await requestTime());
  const checks = [
    ["merchant_match", "Merchant"], ["environment_match", "Environment"], ["provider_match", "Provider"],
    ["amount_match", "Exact amount / currency"], ["receiver_match", "Receiver / account"],
    ["transaction_id_match", "Transaction ID present / unused"], ["time_match", "Provider time window"],
    ["source_trusted", "Source trust"], ["intent_eligible", "Intent eligibility"],
  ] as const;
  return <>
    <p className="eyebrow">{data.environment} / Transaction evidence verification</p>
    <h1>{data.merchant_reference}</h1>
    <div className="notice">Development / pre-launch. Test results use synthetic evidence. Real ingestion and verification remain disabled.</div>
    <section className="panel">
      <h2>Expected payment</h2>
      <p>{(Number(data.amount_minor) / 100).toFixed(2)} {data.currency} · {data.provider}</p>
      <p>Receiver: {account.data?.account_number_masked ?? "Unavailable"}</p>
      <p>Reference: {data.public_id}</p>
      <p>Created: {data.created_at} · Expires: {data.expires_at ?? "Unspecified"}</p>
      <span className="status-badge">{state.replaceAll("_", " ")}</span>
    </section>
    {unavailable ? <div className="notice">Verification history is unavailable. No outcome is inferred from missing data.</div> : <>
      <section className="panel">
        <h2>Verification timeline</h2>
        <p>Expected payment → Evidence detected → Match evaluated → Recorded decision</p>
        {!matches.data?.length ? <p>No evidence has been evaluated for this intent. A pending intent does not prove payment.</p> : null}
        {matches.data?.map(match => {
          const observation = evidence.data?.find(e => e.id === match.payment_evidence_id);
          return <article key={match.id} className="panel">
            <h3>{match.decision_outcome.replaceAll("_", " ")} · {match.created_at}</h3>
            <p>Evidence: {match.payment_evidence_id} · Source: {observation?.source ?? "Unavailable"} · Trust: {observation?.trust_state ?? "Unavailable"}</p>
            <p>Evidence received: {observation?.created_at ?? "Unavailable"} · Provider timestamp: {observation?.provider_timestamp ?? "Missing"}</p>
            <p>Rule: {match.algorithm_version}</p>
            <ul>{checks.map(([key, label]) => <li key={key}>{label}: {match[key] ? "Pass" : "Not satisfied"}</li>)}</ul>
            <p>Reasons: {match.reason_codes.length ? match.reason_codes.join(", ") : "All required checks satisfied"}</p>
          </article>;
        })}
        {matches.data?.length === 50 ? <p>Showing the first 50 evaluations.</p> : null}
      </section>
      <section className="panel">
        <h2>Authoritative result</h2>
        {transaction.data ? <p>Transaction: {transaction.data.id} · Verified: {transaction.data.verified_at} · Rule: {transaction.data.rule_version}</p>
          : <p>No authoritative transaction. Manual review is not verification.</p>}
      </section>
    </>}
  </>;
}
