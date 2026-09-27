import assert from "node:assert/strict";
import {randomUUID,generateKeyPairSync,sign} from "node:crypto";
import {withPostgres} from "./testing/postgres.mjs";
import {canonicalSignedMessage,sha256} from "../lib/ingestion/protocol.ts";
import {ingestSyntheticEvidence,handoffSyntheticVerification,authenticateEvidenceSource} from "../lib/ingestion/ingest.ts";
let checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
const sql="SELECT public.ingest_synthetic_evidence($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) v";
Object.assign(process.env,{NODE_ENV:"test",EKPAY_SYNTHETIC_INGESTION_ENABLED:"true",EKPAY_AUTO_VERIFY_SYNTHETIC_EVIDENCE:"false"});
await withPostgres(async({db,connect})=>{
  const service=await connect();await service.query("SET ROLE service_role");
  const denied=async(c,query,params,code)=>{await assert.rejects(c.query(query,params),e=>e.code===code);checks++;};
  const store=c=>({
    async source(id){return (await c.query("SELECT * FROM public.parser_devices WHERE public_id=$1",[id])).rows[0]??null;},
    async persist(r,keyHash,bodyHash,fields){return (await c.query(sql,[r.source_public_id,r.key_version,keyHash,new Date(r.timestamp_ms).toISOString(),r.nonce,r.ingestion_id,r.message_hash,bodyHash,JSON.stringify(fields)])).rows[0].v;},
    async verify(i,e){return (await c.query("SELECT public.verify_payment_evidence($1,$2) v",[i,e])).rows[0].v;},
  });
  async function fixture(provider="bkash",environment="test"){
    const m=randomUUID(),u=randomUUID(),a=randomUUID();
    await db.query("INSERT INTO auth.users(id,email_confirmed_at) VALUES($1,now())",[u]);
    await db.query("INSERT INTO public.merchants(id,name,slug) VALUES($1,'Synthetic',$2)",[m,"fixture-"+m]);
    await db.query("INSERT INTO public.merchant_members(merchant_id,user_id,role) VALUES($1,$2,'owner')",[m,u]);
    await db.query(`INSERT INTO public.provider_accounts(id,merchant_id,environment,provider,account_type,account_number_masked,account_number_encrypted,receiver_identity_hash,account_encryption_key_reference)
      VALUES($1,$2,$5,$3,'merchant','synthetic','synthetic-placeholder',$4,'fixture-only')`,[a,m,provider,"a".repeat(64),environment]);
    return {m,u,a,provider,environment};
  }
  async function source(f,{kind="provider_api",synthetic=true}={}){
    const id=randomUUID(),pub=randomUUID(),keys=generateKeyPairSync("ed25519"),pubkey=keys.publicKey.export({type:"spki",format:"der"}).subarray(-32);
    // DBA-only legacy regression fixture; normal Phase 6 registration/pairing uses RPCs.
    await db.query(`INSERT INTO public.parser_devices(id,public_id,merchant_id,environment,provider,provider_account_id,source_type,is_synthetic,secret_hash,signing_public_key,status,secret_key_version,paired_at)
      VALUES($1,$2,$3,$8,$4,$5,$9,$10,$6,$7,'active',1,clock_timestamp())`,[id,pub,f.m,f.provider,f.a,sha256("unused-legacy-fixture"+id),pubkey,f.environment,kind,synthetic]);
    return {...f,id,pub,...keys,pubkey};
  }
  function envelope(s,changes={},header={}){
    const fields={provider:s.provider,provider_transaction_id:"FIXTURE_"+randomUUID().replaceAll("-","").toUpperCase(),amount_minor:10000,currency:"BDT",
      receiver_identity_hash:"a".repeat(64),sender_identity_hash:null,provider_timestamp:new Date().toISOString(),...changes};
    const body=Buffer.from(JSON.stringify(fields));
    const r={source_public_id:s.pub,key_version:1,timestamp_ms:Date.now(),nonce:randomUUID(),ingestion_id:randomUUID(),message_hash:sha256(body),signature:"0".repeat(128),...header};
    r.signature=sign(null,canonicalSignedMessage(r,body),s.privateKey).toString("hex");
    return {r,body,fields};
  }
  const send=(s,p,c=service)=>ingestSyntheticEvidence(store(c),p.r,p.body);
  async function count(table,where,params){return Number((await db.query(`SELECT count(*) n FROM public.${table} WHERE ${where}`,params)).rows[0].n);}
  async function intent(s,amount=10000){const id=randomUUID();await db.query(`INSERT INTO public.payment_intents(id,merchant_id,environment,provider,provider_account_id,amount_minor,public_id,merchant_reference,status,created_at,expires_at)
    VALUES($1,$2,'test',$3,$4,$5,$6,$6,'created',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour')`,[id,s.m,s.provider,s.a,amount,"pi_"+id.replaceAll("-","")]);return id;}
  const s=await source(await fixture()),p=envelope(s);
  await denied(service,sql,[s.pub,1,sha256(s.pubkey),new Date(p.r.timestamp_ms).toISOString(),p.r.nonce,p.r.ingestion_id,p.r.message_hash,sha256(p.body),JSON.stringify(p.fields)],"42501");
  await db.query("UPDATE ekpay_private.ingestion_policy SET enabled=true");
  for(const role of ["anon","authenticated"]){const c=await connect();await c.query(`SET ROLE ${role}`);await denied(c,sql,[s.pub,1,sha256(s.pubkey),new Date().toISOString(),p.r.nonce,p.r.ingestion_id,p.r.message_hash,sha256(p.body),JSON.stringify(p.fields)],"42501");}
  for(const table of ["payment_evidence","parser_requests"]) eq((await db.query("SELECT has_table_privilege('service_role',$1,'INSERT') v",["public."+table])).rows[0].v,false);
  await denied(service,"UPDATE ekpay_private.ingestion_policy SET enabled=true",[],"42501");
  Object.assign(process.env,{NODE_ENV:"production"});await assert.rejects(send(s,p),/disabled/);checks++;
  Object.assign(process.env,{NODE_ENV:"test",EKPAY_SYNTHETIC_INGESTION_ENABLED:"false"});await assert.rejects(send(s,p),/disabled/);checks++;
  Object.assign(process.env,{EKPAY_SYNTHETIC_INGESTION_ENABLED:"true"});
  const first=await send(s,p);eq(first.state,"accepted");eq((await send(s,p)).evidence_id,first.evidence_id);
  eq(await count("payment_evidence","merchant_id=$1",[s.m]),1);eq(await count("parser_requests","merchant_id=$1",[s.m]),1);
  const sameId=envelope(s,p.fields,{ingestion_id:p.r.ingestion_id,message_hash:p.r.message_hash});
  eq((await send(s,sameId)).evidence_id,first.evidence_id);eq(await count("parser_requests","merchant_id=$1",[s.m]),2);
  const duplicate=envelope(s,p.fields,{message_hash:p.r.message_hash});eq((await send(s,duplicate)).state,"duplicate");eq(await count("payment_evidence","merchant_id=$1",[s.m]),1);
  const reordered={...p,body:Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(p.fields).reverse())))};
  reordered.r={...p.r,signature:sign(null,canonicalSignedMessage(p.r,reordered.body),s.privateKey).toString("hex")};
  eq((await send(s,reordered)).evidence_id,first.evidence_id);
  for(const changes of [{amount_minor:1.5},{provider:"bad"},{currency:"USD"},{provider_transaction_id:"lowercase"},{merchant_id:randomUUID()},{environment:"live"},{raw_sms:"not-allowed"}]){
    await assert.rejects(send(s,envelope(s,changes)));checks++;
  }
  for(const delta of [{signature:"0".repeat(128)},{key_version:2},{timestamp_ms:Date.now()-301000},{timestamp_ms:Date.now()+301000},{source_public_id:randomUUID()}]){
    await assert.rejects(send(s,{...p,r:{...p.r,...delta}}));checks++;
  }
  for(const header of [{nonce:p.r.nonce},{ingestion_id:p.r.ingestion_id},{message_hash:p.r.message_hash}]){
    const q=envelope(s,{...p.fields,amount_minor:10001},header);await assert.rejects(send(s,q),e=>e.code==="23505");checks++;
  }
  // DB freshness and key binding independently reject stale server attestations.
  await denied(service,sql,[s.pub,2,sha256(s.pubkey),new Date().toISOString(),randomUUID(),randomUUID(),sha256("fixture"),sha256(p.body),JSON.stringify(p.fields)],"42501");
  await denied(service,sql,[s.pub,1,sha256(s.pubkey),new Date(Date.now()-301000).toISOString(),randomUUID(),randomUUID(),sha256("fixture"),sha256(p.body),JSON.stringify(p.fields)],"42501");
  const nagad=await source(await fixture("nagad"));eq((await send(nagad,envelope(nagad))).state,"accepted");
  for(const unsupported of [await source(await fixture("bkash","live")),await source(await fixture(),{synthetic:false}),await source(await fixture(),{kind:"parser_device"})]){
    const q=envelope(unsupported);await assert.rejects(send(unsupported,q),/invalid_source/);checks++;
    await denied(service,sql,[unsupported.pub,1,sha256(unsupported.pubkey),new Date().toISOString(),q.r.nonce,q.r.ingestion_id,q.r.message_hash,sha256(q.body),JSON.stringify(q.fields)],"42501");
  }
  const cross=await source(await fixture());const crossP=envelope(cross,p.fields,{ingestion_id:p.r.ingestion_id,message_hash:p.r.message_hash});await assert.rejects(send(cross,crossP),e=>e.code==="23505");checks++;
  const revoked=await source(await fixture()),rev=envelope(revoked);
  await authenticateEvidenceSource(store(service),rev.r,rev.body);
  await db.query("UPDATE public.parser_devices SET status='revoked',revoked_at=clock_timestamp() WHERE id=$1",[revoked.id]);
  await assert.rejects(send(revoked,rev),/invalid_source/);checks++;
  await denied(service,sql,[revoked.pub,1,sha256(revoked.pubkey),new Date().toISOString(),rev.r.nonce,rev.r.ingestion_id,rev.r.message_hash,sha256(rev.body),JSON.stringify(rev.fields)],"42501");
  await denied(db,"UPDATE public.parser_devices SET status='active',revoked_at=NULL WHERE id=$1",[revoked.id],"23514");
  await denied(db,"UPDATE public.parser_devices SET merchant_id=$2 WHERE id=$1",[s.id,cross.m],"23514");
  await denied(db,"UPDATE public.parser_devices SET environment='live' WHERE id=$1",[s.id],"23514");
  const keys=generateKeyPairSync("ed25519"),newKey=keys.publicKey.export({type:"spki",format:"der"}).subarray(-32);
  await denied(db,"UPDATE public.parser_devices SET signing_public_key=$2 WHERE id=$1",[s.id,newKey],"23514");
  await db.query("UPDATE public.parser_devices SET signing_public_key=$2,secret_key_version=2 WHERE id=$1",[s.id,newKey]);
  await assert.rejects(send(s,p),/invalid_source/);checks++;
  await denied(db,"UPDATE public.parser_devices SET secret_key_version=1 WHERE id=$1",[s.id],"23514");
  eq((await send({...s,privateKey:keys.privateKey},envelope({...s,privateKey:keys.privateKey},{},{key_version:2}))).state,"accepted");
  const detail=(await db.query("SELECT * FROM public.payment_evidence WHERE id=$1",[first.evidence_id])).rows[0];
  eq(detail.source_device_id,s.id);eq(detail.authentication_method,"ed25519-synthetic-v1");eq(detail.normalization_version,"ekpay-evidence-normalization-synthetic-v1");
  const reader=await connect();await reader.query("SET ROLE authenticated");await reader.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[s.u]);
  eq((await reader.query("SELECT normalization_version FROM public.payment_evidence WHERE id=$1",[first.evidence_id])).rowCount,1);
  await denied(reader,"SELECT ciphertext FROM ekpay_private.evidence_payloads",[],"42501");
  eq((await reader.query("SELECT count(*)::int n FROM public.payment_evidence WHERE merchant_id=$1",[cross.m])).rows[0].n,0);
  await denied(db,"UPDATE public.payment_evidence SET source_key_version=99 WHERE id=$1",[first.evidence_id],"23514");
  // Separate ingestion commit survives disabled handoff and late verification failure.
  const hand=await source(await fixture()),hi=await intent(hand),hp=envelope(hand),he=await send(hand,hp);
  await assert.rejects(handoffSyntheticVerification(store(service),hi,he.evidence_id),/disabled/);checks++;
  Object.assign(process.env,{EKPAY_AUTO_VERIFY_SYNTHETIC_EVIDENCE:"true"});
  await assert.rejects(handoffSyntheticVerification(store(service),hi,he.evidence_id),e=>e.code==="42501");checks++;
  eq(await count("payment_evidence","id=$1",[he.evidence_id]),1);
  await db.query("UPDATE ekpay_private.verification_policy SET enabled=true");
  eq((await handoffSyntheticVerification(store(service),hi,he.evidence_id)).outcome,"verified");
  eq((await handoffSyntheticVerification(store(service),hi,he.evidence_id)).reused,true);
  eq(await count("transactions","payment_intent_id=$1",[hi]),1);
  const conflictSource=await source(await fixture()),target=await intent(conflictSource),base=envelope(conflictSource);
  const ce=await send(conflictSource,base);await send(conflictSource,envelope(conflictSource,{...base.fields,amount_minor:10001}));
  eq((await handoffSyntheticVerification(store(service),target,ce.evidence_id)).outcome,"manual_review");
  eq(await count("transactions","payment_intent_id=$1",[target]),0);
  const rollbackSource=await source(await fixture()),rollbackPayload=envelope(rollbackSource);
  await db.query(`CREATE FUNCTION public.fixture_ingestion_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic rollback' USING ERRCODE='P0001'; END $$;
    CREATE TRIGGER fixture_ingestion_failure BEFORE INSERT ON public.audit_logs FOR EACH ROW WHEN(NEW.action='evidence.ingested') EXECUTE FUNCTION public.fixture_ingestion_failure()`);
  await assert.rejects(send(rollbackSource,rollbackPayload),e=>e.code==="P0001");checks++;
  for(const table of ["payment_evidence","parser_requests","events"])eq(await count(table,"merchant_id=$1",[rollbackSource.m]),0);
  await db.query("DROP TRIGGER fixture_ingestion_failure ON public.audit_logs; DROP FUNCTION public.fixture_ingestion_failure()");
  eq((await send(rollbackSource,rollbackPayload)).state,"accepted");

  async function blocked(p2,p1){const end=Date.now()+6000;while(Date.now()<end){if((await db.query("SELECT $1::int=ANY(pg_blocking_pids($2::int)) v",[p1,p2])).rows[0].v)return;await new Promise(r=>setTimeout(r,10));}throw Error("blocking barrier not reached");}
  async function race(isolation,kind){
    const a=await source(await fixture()),b=kind==="two sources"?await source(a):a;
    const i=await intent(a),one=envelope(a);let two=envelope(b,one.fields);
    if(kind==="same id"||kind==="rollback")two=envelope(b,one.fields,{ingestion_id:one.r.ingestion_id,message_hash:one.r.message_hash});
    if(kind==="same nonce")two=envelope(b,{...one.fields,provider_transaction_id:"FIXTURE_OTHER"},{nonce:one.r.nonce});
    if(kind==="same message")two=envelope(b,one.fields,{message_hash:one.r.message_hash});
    if(kind==="two sources")two=envelope(b,{...one.fields,amount_minor:10001});
    const c1=await connect(),c2=await connect();for(const c of [c1,c2])await c.query(`BEGIN ISOLATION LEVEL ${isolation}; SET LOCAL ROLE service_role`);
    await c2.query("SELECT count(*) FROM public.parser_devices");
    const pid1=(await c1.query("SELECT pg_backend_pid() p")).rows[0].p,pid2=(await c2.query("SELECT pg_backend_pid() p")).rows[0].p;
    let winner;
    if(kind==="revoke"||kind==="rotate"){
      await c1.query("RESET ROLE");
      if(kind==="revoke")await c1.query("UPDATE public.parser_devices SET status='revoked',revoked_at=clock_timestamp() WHERE id=$1",[a.id]);
      else await c1.query("UPDATE public.parser_devices SET secret_key_version=2,signing_public_key=$2 WHERE id=$1",[a.id,generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).subarray(-32)]);
      await c1.query("SET LOCAL ROLE service_role");
    }else winner=await send(a,one,c1);
    const pending=send(b,two,c2).then(v=>({v}),error=>({error}));await blocked(pid2,pid1);
    await c1.query(kind==="rollback"?"ROLLBACK":"COMMIT");const result=await pending;
    if(result.error){assert.ok(["40001","40P01","23505","42501"].includes(result.error.code),result.error.message);await c2.query("ROLLBACK");
      if(!["same nonce","revoke","rotate"].includes(kind))await send(b,two);
    }else await c2.query("COMMIT");
    const n=await count("payment_evidence","merchant_id=$1",[a.m]);eq(n,["revoke","rotate"].includes(kind)?0:kind==="two sources"?2:1);
    if(winner&&kind!=="rollback"){
      if(kind==="two sources")eq((await handoffSyntheticVerification(store(service),i,winner.evidence_id)).outcome,"manual_review");
      else{eq((await handoffSyntheticVerification(store(service),i,winner.evidence_id)).outcome,"verified");eq((await handoffSyntheticVerification(store(service),i,winner.evidence_id)).reused,true);}
    }
    eq(await count("transactions","merchant_id=$1",[a.m]),["same id","same nonce","same message"].includes(kind)?1:0);
    console.log(`PASS: ${isolation}: ingestion ${kind}; ${result.error?.code??"serialized"}; evidence=${n}`);
  }
  for(const isolation of ["READ COMMITTED","REPEATABLE READ","SERIALIZABLE"])
    for(const kind of ["same id","same nonce","same message","two sources","revoke","rotate","rollback"])await race(isolation,kind);
  for(const isolation of ["READ COMMITTED","REPEATABLE READ","SERIALIZABLE"]){
    const a=await source(await fixture()),i=await intent(a),p=envelope(a),accepted=await send(a,p);
    const c1=await connect(),c2=await connect();for(const c of [c1,c2])await c.query(`BEGIN ISOLATION LEVEL ${isolation}; SET LOCAL ROLE service_role`);
    await c2.query("SELECT count(*) FROM public.payment_intents");
    const pid1=(await c1.query("SELECT pg_backend_pid() p")).rows[0].p,pid2=(await c2.query("SELECT pg_backend_pid() p")).rows[0].p;
    eq((await handoffSyntheticVerification(store(c1),i,accepted.evidence_id)).outcome,"verified");
    const pending=handoffSyntheticVerification(store(c2),i,accepted.evidence_id).then(v=>({v}),error=>({error}));
    await blocked(pid2,pid1);await c1.query("COMMIT");const result=await pending;
    if(result.error){eq(result.error.code,"40001");await c2.query("ROLLBACK");eq((await handoffSyntheticVerification(store(service),i,accepted.evidence_id)).reused,true);}else{await c2.query("COMMIT");eq(result.v.reused,true);}
    eq(await count("transactions","payment_intent_id=$1",[i]),1);eq(await count("payment_evidence","merchant_id=$1",[a.m]),1);
    console.log(`PASS: ${isolation}: ingestion -> simultaneous duplicate verification handoff, one transaction`);
  }
  const safe=(await db.query("SELECT string_agg(payload::text,' ') v FROM public.events WHERE event_type LIKE 'evidence.%'")).rows[0].v+
    (await db.query("SELECT string_agg(metadata::text,' ') v FROM public.audit_logs WHERE action LIKE 'evidence.%'")).rows[0].v;
  eq(/raw_sms|signature|secret_hash|signing_public_key|receiver_identity_hash|synthetic-placeholder/.test(safe),false);
  eq((await db.query("SELECT has_function_privilege('authenticated','public.ingest_synthetic_evidence(uuid,integer,text,timestamptz,text,uuid,text,text,jsonb)','EXECUTE') v")).rows[0].v,false);
  console.log(`PASS: Phase 5 ${checks} security/ingestion checks, 24 real races, synthetic Ed25519 only.`);
});
