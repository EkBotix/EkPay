"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireMerchantRole, requireUser } from "@/lib/merchant-context";
export type ParserResult={message:string;token?:string;deviceId?:string;expiresAt?:string};
function enabled(){return process.env.NODE_ENV!=='production'&&process.env.EKPAY_PARSER_MANAGEMENT_ENABLED==='true';}
export async function registerParserDevice(_previous:ParserResult,form:FormData):Promise<ParserResult>{
  if(!enabled())return {message:'Synthetic parser management is disabled.'};
  const parsed=z.strictObject({merchant:z.uuid(),account:z.uuid(),name:z.string().trim().min(1).max(64)}).safeParse({merchant:form.get('merchantId'),account:form.get('accountId'),name:form.get('name')});
  if(!parsed.success)return {message:'Invalid registration.'};
  try{await requireMerchantRole(parsed.data.merchant,['owner','admin']);const {client}=await requireUser();
    const {data,error}=await client.rpc('register_parser_device',{p_merchant_id:parsed.data.merchant,p_account_id:parsed.data.account,p_name:parsed.data.name});
    if(error||!data)return {message:'Registration unavailable.'};revalidatePath('/dashboard/parser-devices');
    return {message:'Save the one-time pairing token now.',token:data.pairing_token,deviceId:data.device_id,expiresAt:data.expires_at};
  }catch{return {message:'Registration unavailable.'};}
}
export async function issueParserPairing(_previous:ParserResult,form:FormData):Promise<ParserResult>{
  if(!enabled())return {message:'Synthetic parser management is disabled.'};
  const parsed=z.strictObject({merchant:z.uuid(),device:z.uuid(),version:z.coerce.number().int().min(0).max(2147483646)}).safeParse({merchant:form.get('merchantId'),device:form.get('deviceId'),version:form.get('version')});
  if(!parsed.success)return {message:'Invalid request.'};
  try{await requireMerchantRole(parsed.data.merchant,['owner','admin']);const {client}=await requireUser();
    const {data,error}=await client.rpc('issue_parser_pairing',{p_device_public_id:parsed.data.device,p_expected_version:parsed.data.version});
    if(error||!data)return {message:'Pairing unavailable.'};revalidatePath('/dashboard/parser-devices');
    return {message:'New token invalidates the previous token. Save it now.',token:data.pairing_token,deviceId:data.device_id,expiresAt:data.expires_at};
  }catch{return {message:'Pairing unavailable.'};}
}
export async function revokeParserDevice(_previous:ParserResult,form:FormData):Promise<ParserResult>{
  if(!enabled())return {message:'Synthetic parser management is disabled.'};
  const parsed=z.strictObject({merchant:z.uuid(),device:z.uuid()}).safeParse({merchant:form.get('merchantId'),device:form.get('deviceId')});
  if(!parsed.success)return {message:'Invalid request.'};
  try{await requireMerchantRole(parsed.data.merchant,['owner','admin']);const {client}=await requireUser();
    const {error}=await client.rpc('revoke_parser_device',{p_device_public_id:parsed.data.device});if(error)return {message:'Revocation unavailable.'};
    revalidatePath('/dashboard/parser-devices');return {message:'Device revoked permanently. Re-enrollment requires a new identity.'};
  }catch{return {message:'Revocation unavailable.'};}
}
