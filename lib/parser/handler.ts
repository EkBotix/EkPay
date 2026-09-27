import "server-only";
import { z } from "zod";
import { sha256 } from "@/lib/ingestion/protocol";
import { SyntheticEvidenceAdapter, type NormalizedFields, type SourceIdentity } from "@/lib/ingestion/adapter";
import { PARSER_BODY_LIMIT, PARSER_CLOCK_WINDOW_MS, paths, parseParserHeaders, parserCanonical, ed25519Verify, type ParserHeaders } from "./protocol";
export const heartbeatSchema = z.strictObject({app_version:z.string().max(32),protocol_version:z.literal(1),android_version:z.string().max(32).optional(),
  device_model:z.string().max(64).optional(),locale:z.string().max(16).optional(),timezone:z.string().max(40).optional()});
export type Heartbeat = z.output<typeof heartbeatSchema>;
export interface ParserStore {
  source(publicId: string): Promise<SourceIdentity | null>;
  evidence(h: ParserHeaders, keyHash: string, bodyHash: string, fields: NormalizedFields): Promise<unknown>;
  heartbeat(h: ParserHeaders, keyHash: string, bodyHash: string, metadata: Heartbeat): Promise<unknown>;
}
// Versioned order, stable payment facts only; no receive time/nonce/app metadata.
export function evidenceMessageHash(v: NormalizedFields) {
  return sha256(JSON.stringify({provider:v.provider,provider_transaction_id:v.provider_transaction_id,amount_minor:v.amount_minor,currency:v.currency,
    receiver_identity_hash:v.receiver_identity_hash,sender_identity_hash:v.sender_identity_hash,provider_timestamp:v.provider_timestamp}));
}
export function createParserHandler(kind: keyof typeof paths, getStore: () => ParserStore) {
  return async function handle(request: Request): Promise<Response> {
    const respond = (status: number, value: unknown) => Response.json(value, { status, headers: {"Cache-Control":"no-store"} });
    if (process.env.NODE_ENV !== "test" || process.env.EKPAY_PARSER_INGESTION_ENABLED !== "true") return respond(404, {error:"not_available"});
    if (request.method !== "POST" || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return respond(400,{error:"invalid_request"});
    if (Number(request.headers.get("content-length"))>PARSER_BODY_LIMIT) return respond(413,{error:"invalid_request"});
    let raw: Buffer, h: ParserHeaders;
    try {
      h=parseParserHeaders(request.headers);
      const reader=request.body?.getReader(); if(!reader) return respond(400,{error:"invalid_request"});
      const pieces: Uint8Array[]=[]; let size=0;
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>PARSER_BODY_LIMIT){await reader.cancel();return respond(413,{error:"invalid_request"});}pieces.push(value);}
      raw=Buffer.concat(pieces);
    } catch { return respond(400,{error:"invalid_request"}); }
    try {
      const store=getStore(), source=await store.source(h.device_id);
      if(!source || !SyntheticEvidenceAdapter.validateSource(source) || source.secret_key_version!==h.key_version || Math.abs(Date.now()-h.timestamp)>PARSER_CLOCK_WINDOW_MS ||
        !ed25519Verify(source.signing_public_key,parserCanonical(h,paths[kind],raw),h.signature)) return respond(401,{error:"invalid_device_request"});
      const hash=sha256(source.signing_public_key), bodyHash=sha256(raw);
      let result: unknown;
      if(kind==='evidence'){
        let normalized: NormalizedFields;try{normalized=SyntheticEvidenceAdapter.normalize(raw);}catch{return respond(400,{error:"invalid_request"});}
        if(normalized.provider!==source.provider || evidenceMessageHash(normalized)!==h.message_hash) return respond(400,{error:"invalid_request"});
        result=await store.evidence(h,hash,bodyHash,normalized);
      }else{
        let metadata: Heartbeat;try{metadata=heartbeatSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)));}catch{return respond(400,{error:"invalid_request"});}
        if(h.message_hash!==bodyHash) return respond(400,{error:"invalid_request"});
        result=await store.heartbeat(h,hash,bodyHash,metadata);
      }
      return respond(200,result);
    } catch(error) {
      const code=(error as {code?:string}).code;
      return respond(code==='23505'?409:code==='42501'?401:code==='40001'||code==='40P01'?409:500,{error:code==='23505'?'request_conflict':code==='42501'?'invalid_device_request':code==='40001'||code==='40P01'?'retry_request':'internal_error'});
    }
  };
}
