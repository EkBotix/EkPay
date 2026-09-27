"use client";
import { useActionState } from "react";
import { registerParserDevice, issueParserPairing, revokeParserDevice, type ParserResult } from "@/app/actions/parser-devices";
function TokenResult({state}:{state:ParserResult}){return <>
  {state.message?<p role="status">{state.message}</p>:null}
  {state.token?<div className="secret-box"><strong>Shown once · Synthetic pairing only</strong><p>Device: {state.deviceId}</p><p>Expires: {state.expiresAt}</p><p className="secret-value">{state.token}</p>
    <button type="button" onClick={()=>window.location.reload()}>Saved — dismiss</button></div>:null}
</>;}
export function RegisterParserForm({merchantId,accounts}:{merchantId:string;accounts:{id:string;provider:string;account_number_masked:string}[]}){
  const [state,action,pending]=useActionState(registerParserDevice,{message:''});
  return <section className="panel"><h2>Register synthetic device</h2>{!state.token?<form action={action} className="form-stack">
    <input type="hidden" name="merchantId" value={merchantId}/><label>Display name<input name="name" required maxLength={64}/></label>
    <label>One test provider account<select name="accountId" required>{accounts.map(a=><option key={a.id} value={a.id}>{a.provider} · {a.account_number_masked}</option>)}</select></label>
    <button disabled={pending||!accounts.length}>{pending?'Registering…':'Register'}</button></form>:null}<TokenResult state={state}/></section>;
}
export function ParserDeviceActions({merchantId,deviceId,version}:{merchantId:string;deviceId:string;version:number}){
  const [pairState,pairAction,pairPending]=useActionState(issueParserPairing,{message:''});
  const [revokeState,revokeAction,revokePending]=useActionState(revokeParserDevice,{message:''});
  return <><form action={pairAction}><input type="hidden" name="merchantId" value={merchantId}/><input type="hidden" name="deviceId" value={deviceId}/><input type="hidden" name="version" value={version}/>
    <button className="secondary" disabled={pairPending||Boolean(pairState.token)}>{version?'Authorize rotation / new token':'Replace pairing token'}</button></form><TokenResult state={pairState}/>
    <form action={revokeAction}><input type="hidden" name="merchantId" value={merchantId}/><input type="hidden" name="deviceId" value={deviceId}/><button className="secondary" disabled={revokePending}>Revoke permanently</button></form><p role="status">{revokeState.message}</p></>;
}
