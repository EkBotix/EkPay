import { requireMerchantAccess, requireUser } from "@/lib/merchant-context";
import { RegisterParserForm, ParserDeviceActions } from "@/components/parser-device-form";
export default async function ParserDevicesPage(){
  const merchant=await requireMerchantAccess(),{client}=await requireUser();
  const [devices,accounts]=await Promise.all([
    client.from('parser_devices').select('public_id,display_name,status,environment,provider,provider_account_id,secret_key_version,created_at,paired_at,last_seen_at,last_authenticated_at,app_version,protocol_version').eq('merchant_id',merchant.merchantId).order('created_at',{ascending:false}).limit(50),
    client.from('provider_accounts').select('id,provider,account_number_masked').eq('merchant_id',merchant.merchantId).eq('environment','test').eq('is_active',true),
  ]);
  const manage=['owner','admin'].includes(merchant.role)&&process.env.NODE_ENV!=='production'&&process.env.EKPAY_PARSER_MANAGEMENT_ENABLED==='true';
  return <><p className="eyebrow">TEST / DEVELOPMENT · Parser Devices</p><h1>Parser devices</h1><div className="notice">Real Android/SMS integration is disabled. Management and ingestion are default-off. Revoked identities cannot be restored.</div>
    {devices.error||accounts.error?<div className="notice">Device records are unavailable.</div>:<>
      {manage?<RegisterParserForm merchantId={merchant.merchantId} accounts={accounts.data??[]}/>:<p>Device management is disabled or unavailable to your role.</p>}
      {!devices.data?.length?<section className="panel">No parser devices registered.</section>:null}
      {devices.data?.map(d=><article key={d.public_id} className="panel"><h2>{d.display_name}</h2><p>{d.status.replaceAll('_',' ')} · {d.environment} · {d.provider}</p>
        <p>Device: {d.public_id}</p><p>Account: {accounts.data?.find(a=>a.id===d.provider_account_id)?.account_number_masked??'Unavailable'}</p>
        <p>Key version: {d.secret_key_version} · Protocol: {d.protocol_version}</p><p>Created: {d.created_at} · Paired: {d.paired_at??'Pending'}</p>
        <p>Last seen: {d.last_seen_at??'Never'} · Last authenticated: {d.last_authenticated_at??'Never'}</p><p>App: {d.app_version??'Unknown'}</p>
        {manage&&d.status!=='revoked'?<ParserDeviceActions merchantId={merchant.merchantId} deviceId={d.public_id} version={d.secret_key_version}/>:d.status==='revoked'?<strong>Revoked permanently</strong>:null}
      </article>)}{devices.data?.length===50?<p>Showing the latest 50 devices.</p>:null}
    </>}</>;
}
