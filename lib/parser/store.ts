import "server-only";
import { createPrivilegedSupabase } from "@/lib/supabase/admin";
import type { ParserStore } from "./handler";
import type { SourceIdentity } from "@/lib/ingestion/adapter";
export function parserStore(): ParserStore {
  const client=createPrivilegedSupabase();
  const rpc=async(name:string,args:Record<string,unknown>)=>{const {data,error}=await client.rpc(name,args);if(error)throw error;return data;};
  return {
    async source(id){const {data,error}=await client.from('parser_devices').select('id,public_id,merchant_id,environment,provider,provider_account_id,source_type,is_synthetic,status,secret_key_version,signing_public_key').eq('public_id',id).maybeSingle();
      if(error)throw error;if(!data)return null;
      return {...data,signing_public_key:Buffer.from(String(data.signing_public_key??'').replace(/^\\x/,''),'hex')} as SourceIdentity;},
    evidence(h,keyHash,bodyHash,fields){return rpc('ingest_synthetic_evidence',{p_source_public_id:h.device_id,p_key_version:h.key_version,p_verified_key_hash:keyHash,p_timestamp:new Date(h.timestamp).toISOString(),
      p_nonce:h.nonce,p_ingestion_id:h.ingestion_id,p_message_hash:h.message_hash,p_body_digest:bodyHash,p_fields:fields});},
    heartbeat(h,keyHash,bodyHash,metadata){return rpc('parser_heartbeat',{p_device_public_id:h.device_id,p_key_version:h.key_version,p_key_hash:keyHash,p_timestamp:new Date(h.timestamp).toISOString(),
      p_nonce:h.nonce,p_ingestion_id:h.ingestion_id,p_body_digest:bodyHash,p_metadata:metadata});},
  };
}
