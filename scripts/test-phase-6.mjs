// Local-only simulator: disposable loopback PostgreSQL, temporary in-memory keys.
// No remote URL, real payment messages, Android device, or provider calls.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,generateKeyPairSync,sign} from 'node:crypto';
import {withPostgres} from './testing/postgres.mjs';
import {sha256} from '../lib/ingestion/protocol.ts';
import {parserCanonical,paths} from '../lib/parser/protocol.ts';
import {pairSyntheticParser,pairingCanonical} from '../lib/parser/pairing.ts';
import {createParserHandler,evidenceMessageHash} from '../lib/parser/handler.ts';
let checks=0,races=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
const keys=()=>{const k=generateKeyPairSync('ed25519');return {...k,raw:k.publicKey.export({type:'spki',format:'der'}).subarray(-32)};};
const pairSQL='SELECT public.consume_parser_pairing($1,$2,$3,$4) v';
const evidenceSQL='SELECT public.ingest_synthetic_evidence($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) v';
const heartbeatSQL='SELECT public.parser_heartbeat($1,$2,$3,$4,$5,$6,$7,$8::jsonb) v';
Object.assign(process.env,{NODE_ENV:'test',EKPAY_PARSER_INGESTION_ENABLED:'true'});
await withPostgres(async({db,connect})=>{
  const service=await connect();await service.query('SET ROLE service_role');
  const denied=async(c,q,p,code)=>{await assert.rejects(c.query(q,p),e=>e.code===code);checks++;};
  async function auth(u){const c=await connect();await c.query('SET ROLE authenticated');await c.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[u]);return c;}
  async function fixture(){
    const m=randomUUID(),a=randomUUID(),users={};
    await db.query("INSERT INTO public.merchants(id,name,slug) VALUES($1,'Synthetic parser',$2)",[m,'parser-'+m]);
    for(const role of ['owner','admin','developer','viewer']){
      const u=randomUUID();await db.query('INSERT INTO auth.users(id,email_confirmed_at) VALUES($1,now())',[u]);
      await db.query('INSERT INTO public.merchant_members(merchant_id,user_id,role) VALUES($1,$2,$3)',[m,u,role]);users[role]=u;
    }
    await db.query(`INSERT INTO public.provider_accounts(id,merchant_id,environment,provider,account_type,account_number_masked,account_number_encrypted,receiver_identity_hash,account_encryption_key_reference)
      VALUES($1,$2,'test','bkash','merchant','synthetic','synthetic-placeholder',$3,'fixture-only')`,[a,m,'a'.repeat(64)]);
    return {m,a,users,owner:await auth(users.owner),admin:await auth(users.admin)};
  }
  async function register(f,c=f.owner){return (await c.query("SELECT public.register_parser_device($1,$2,'Synthetic device') v",[f.m,f.a])).rows[0].v;}
  const consume=c=>async(d,h,k,v)=>(await c.query(pairSQL,[d,h,Buffer.from(k),v])).rows[0].v;
  function pairing(d,k){const hash=sha256(d.pairing_token);return {device_id:d.device_id,expected_version:d.key_version,pairing_token:d.pairing_token,public_key:k.raw.toString('base64url'),proof_signature:sign(null,pairingCanonical(d.device_id,d.key_version,hash,k.raw),k.privateKey).toString('hex')};}
  async function source(f){const d=await register(f),k=keys();await pairSyntheticParser(pairing(d,k),consume(service));return {...f,...d,...k,key_version:1};}
  const store=c=>({
    async source(id){return (await c.query('SELECT * FROM public.parser_devices WHERE public_id=$1',[id])).rows[0]??null;},
    async evidence(h,key,body,fields){return (await c.query(evidenceSQL,[h.device_id,h.key_version,key,new Date(h.timestamp).toISOString(),h.nonce,h.ingestion_id,h.message_hash,body,JSON.stringify(fields)])).rows[0].v;},
    async heartbeat(h,key,body,fields){return (await c.query(heartbeatSQL,[h.device_id,h.key_version,key,new Date(h.timestamp).toISOString(),h.nonce,h.ingestion_id,body,JSON.stringify(fields)])).rows[0].v;},
  });
  function envelope(s,kind='evidence',fields,delta={}){
    fields??=kind==='heartbeat'?{app_version:'synthetic-1',protocol_version:1,android_version:'simulated',device_model:'simulator',locale:'en',timezone:'UTC'}:
      {provider:'bkash',provider_transaction_id:'SYNTHETIC_'+randomUUID().replaceAll('-','').toUpperCase(),amount_minor:10000,currency:'BDT',receiver_identity_hash:'a'.repeat(64),sender_identity_hash:null,provider_timestamp:new Date().toISOString()};
    const body=Buffer.from(JSON.stringify(fields));
    const h={protocol:'1',device_id:s.device_id,key_version:s.key_version,timestamp:Date.now(),nonce:randomBytes(16).toString('base64url'),ingestion_id:randomUUID(),message_hash:kind==='heartbeat'?sha256(body):evidenceMessageHash(fields),signature:'0'.repeat(128),...delta};
    h.signature=sign(null,parserCanonical(h,paths[kind],body),s.privateKey).toString('hex');return {h,body,fields,kind};
  }
  function request(p,changes={}){const h=p.h;return new Request('http://localhost'+paths[p.kind],{method:'POST',headers:{'Content-Type':'application/json','EkPay-Parser-Protocol':h.protocol,'X-EkPay-Device-Id':h.device_id,'X-EkPay-Key-Version':String(h.key_version),'X-EkPay-Timestamp':String(h.timestamp),'X-EkPay-Nonce':h.nonce,'X-EkPay-Ingestion-Id':h.ingestion_id,'X-EkPay-Message-Hash':h.message_hash,'X-EkPay-Signature':h.signature},body:p.body,...changes});}
  async function send(p,status=200,c=service){const r=await createParserHandler(p.kind,()=>store(c))(request(p));eq(r.status,status);return r.json();}
  async function count(table,where,p){return Number((await db.query(`SELECT count(*) n FROM public.${table} WHERE ${where}`,p)).rows[0].n);}
  const f=await fixture(),other=await fixture();
  await denied(f.owner,"SELECT public.register_parser_device($1,$2,'Synthetic')",[f.m,f.a],'42501');
  await denied(service,'UPDATE ekpay_private.parser_policy SET enabled=true',[],'42501');
  await db.query('UPDATE ekpay_private.parser_policy SET enabled=true; UPDATE ekpay_private.ingestion_policy SET enabled=true');
  for(const role of ['viewer','developer'])await denied(await auth(f.users[role]),"SELECT public.register_parser_device($1,$2,'Synthetic')",[f.m,f.a],'42501');
  await denied(other.owner,"SELECT public.register_parser_device($1,$2,'Synthetic')",[f.m,f.a],'42501');
  await denied(f.owner,"SELECT public.register_parser_device($1,$2,'Synthetic')",[f.m,other.a],'42501');
  const liveAccount=randomUUID();await db.query(`INSERT INTO public.provider_accounts(id,merchant_id,environment,provider,account_type,account_number_masked,account_number_encrypted,receiver_identity_hash,account_encryption_key_reference)
    VALUES($1,$2,'live','bkash','merchant','synthetic','synthetic-placeholder',$3,'fixture-only')`,[liveAccount,f.m,'b'.repeat(64)]);
  await denied(f.owner,"SELECT public.register_parser_device($1,$2,'Synthetic')",[f.m,liveAccount],'42501');
  const adminDevice=await register(f,f.admin);eq(adminDevice.status,'pending_pairing');
  const d=await register(f),k=keys();eq(d.key_version,0);
  eq((await db.query('SELECT token_hash FROM ekpay_private.parser_pairing_tokens WHERE token_hash=$1',[sha256(d.pairing_token)])).rowCount,1);
  await assert.rejects(pairSyntheticParser({...pairing(d,k),proof_signature:'0'.repeat(128)},consume(service)));checks++;
  for(const public_key of ['invalid','A'.repeat(43),'_'.repeat(43)]){await assert.rejects(pairSyntheticParser({...pairing(d,k),public_key},consume(service)));checks++;}
  await denied(service,pairSQL,[d.device_id,sha256('wrong'),k.raw,0],'42501');
  await db.query("UPDATE ekpay_private.parser_pairing_tokens SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1",[sha256(d.pairing_token)]);
  await denied(service,pairSQL,[d.device_id,sha256(d.pairing_token),k.raw,0],'42501');
  const refreshed=(await f.owner.query('SELECT public.issue_parser_pairing($1,0) v',[d.device_id])).rows[0].v;
  eq((await pairSyntheticParser(pairing(refreshed,k),consume(service))).key_version,1);
  await denied(service,pairSQL,[d.device_id,sha256(refreshed.pairing_token),keys().raw,0],'42501');
  await denied(service,pairSQL,[adminDevice.device_id,sha256(adminDevice.pairing_token),k.raw,0],'23505');
  // Token authority is rechecked at consumption, not only issuance.
  await db.query("UPDATE public.merchant_members SET role='viewer' WHERE merchant_id=$1 AND user_id=$2",[f.m,f.users.admin]);
  await denied(service,pairSQL,[adminDevice.device_id,sha256(adminDevice.pairing_token),keys().raw,0],'42501');
  await db.query("UPDATE public.merchant_members SET role='admin' WHERE merchant_id=$1 AND user_id=$2",[f.m,f.users.admin]);
  const sourceRow=(await db.query('SELECT * FROM public.parser_devices WHERE public_id=$1',[d.device_id])).rows[0];
  eq(sourceRow.secret_hash,null);eq(sourceRow.created_by,f.users.owner);eq(sourceRow.status,'active');
  const s={...f,...d,...k,key_version:1},p=envelope(s),accepted=await send(p);eq(accepted.state,'accepted');
  eq((await send(p)).evidence_id,accepted.evidence_id);
  eq((await send(envelope(s,'evidence',p.fields,{ingestion_id:p.h.ingestion_id}))).evidence_id,accepted.evidence_id);
  eq(await count('payment_evidence','merchant_id=$1',[f.m]),1);
  eq((await db.query('SELECT last_authenticated_at IS NOT NULL v FROM public.parser_devices WHERE public_id=$1',[s.device_id])).rows[0].v,true);
  await send(envelope(s,'evidence',{...p.fields,amount_minor:10001},{nonce:p.h.nonce}),409);
  await send(envelope(s,'evidence',{...p.fields,amount_minor:10001},{ingestion_id:p.h.ingestion_id}),409);
  for(const delta of [{key_version:2},{device_id:randomUUID()},{timestamp:Date.now()-301000},{timestamp:Date.now()+301000}])await send(envelope(s,'evidence',undefined,delta),401);
  await send({...p,h:{...p.h,signature:'0'.repeat(128)}},401);
  await send({...p,body:Buffer.from(JSON.stringify({...p.fields,amount_minor:123}))},401);
  await send({...p,h:{...p.h,protocol:'2'}},400);
  await send({...p,h:{...p.h,nonce:'short'}},400);
  await send({...p,body:Buffer.alloc(4097,32)},413);
  for(const field of [{merchant_id:f.m},{environment:'live'},{raw_sms:'forbidden'},{provider:'nagad'}])await send(envelope(s,'evidence',{...p.fields,...field}),400);
  const beat=envelope(s,'heartbeat');eq((await send(beat)).accepted,true);eq((await send(beat)).reused,true);
  const health=(await db.query('SELECT app_version,protocol_version FROM public.parser_devices WHERE public_id=$1',[s.device_id])).rows[0];eq(health,{app_version:'synthetic-1',protocol_version:1});
  await send(envelope(s,'heartbeat',{app_version:'sim',protocol_version:1,imei:'forbidden'}),400);
  await send({...beat,h:{...beat.h,signature:sign(null,parserCanonical(beat.h,paths.evidence,beat.body),s.privateKey).toString('hex')}},401);
  const token=(await f.admin.query('SELECT public.issue_parser_pairing($1,1) v',[s.device_id])).rows[0].v,newKey=keys();
  eq((await pairSyntheticParser(pairing(token,newKey),consume(service))).key_version,2);
  await send(p,401);await send(envelope({...s,...newKey,key_version:2},'heartbeat'));
  await denied(db,'UPDATE public.parser_devices SET secret_key_version=1 WHERE public_id=$1',[s.device_id],'23514');
  const reuse=(await f.owner.query('SELECT public.issue_parser_pairing($1,2) v',[s.device_id])).rows[0].v;
  await denied(service,pairSQL,[s.device_id,sha256(reuse.pairing_token),k.raw,2],'23505');
  await denied(other.owner,'SELECT public.revoke_parser_device($1)',[s.device_id],'42501');
  eq((await f.owner.query('SELECT public.revoke_parser_device($1) v',[s.device_id])).rows[0].v.reused,false);
  eq((await f.owner.query('SELECT public.revoke_parser_device($1) v',[s.device_id])).rows[0].v.reused,true);
  await send(envelope({...s,...newKey,key_version:2},'heartbeat'),401);
  await denied(f.owner,'SELECT public.issue_parser_pairing($1,2)',[s.device_id],'23505');
  await denied(db,"UPDATE public.parser_devices SET status='active' WHERE public_id=$1",[s.device_id],'23514');
  eq(await count('payment_evidence','id=$1',[accepted.evidence_id]),1);
  for(const role of ['anon','authenticated','service_role']){
    const c=role==='service_role'?service:await connect();if(role!=='service_role')await c.query(`SET ROLE ${role}`);
    await denied(c,"INSERT INTO public.parser_devices(merchant_id) VALUES($1)",[f.m],'42501');
    await denied(c,"UPDATE public.parser_devices SET status='active'",[],'42501');
    await denied(c,'SELECT token_hash FROM ekpay_private.parser_pairing_tokens',[],'42501');
  }
  const viewer=await auth(f.users.viewer);eq((await viewer.query('SELECT public_id,status FROM public.parser_devices WHERE merchant_id=$1',[f.m])).rowCount,2);
  eq((await viewer.query('SELECT public_id FROM public.parser_devices WHERE merchant_id=$1',[other.m])).rowCount,0);
  for(const q of ['SELECT signing_public_key FROM public.parser_devices','SELECT * FROM public.parser_requests'])await denied(viewer,q,[],'42501');
  const audits=JSON.stringify((await db.query("SELECT metadata FROM public.audit_logs WHERE action LIKE 'parser.%'")).rows);
  for(const secret of [d.pairing_token,refreshed.pairing_token,token.pairing_token,reuse.pairing_token,k.raw.toString('hex'),beat.h.signature,beat.h.nonce])eq(audits.includes(secret),false);
  const newDefiners=(await db.query("SELECT proname,proconfig,has_function_privilege('anon',p.oid,'EXECUTE') anon FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN ('register_parser_device','issue_parser_pairing','consume_parser_pairing','revoke_parser_device','parser_heartbeat','ekpay_record_parser_key','ekpay_parser_request_health')")).rows;
  eq(newDefiners.length,7);for(const fn of newDefiners){eq(fn.proconfig,['search_path=""']);eq(fn.anon,false);}
  // Failure late in a pairing rolls back key claim, token consumption, status and revision.
  const rb=await register(f),rbKey=keys();
  await db.query(`CREATE FUNCTION public.fixture_pair_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture rollback' USING ERRCODE='P0001'; END $$;
    CREATE TRIGGER fixture_pair_failure BEFORE INSERT ON public.audit_logs FOR EACH ROW WHEN(NEW.action='parser.device_paired') EXECUTE FUNCTION public.fixture_pair_failure()`);
  await denied(service,pairSQL,[rb.device_id,sha256(rb.pairing_token),rbKey.raw,0],'P0001');
  eq((await db.query('SELECT status,secret_key_version,management_revision FROM public.parser_devices WHERE public_id=$1',[rb.device_id])).rows[0],{status:'pending_pairing',secret_key_version:0,management_revision:'0'});
  eq((await db.query('SELECT count(*)::int n FROM ekpay_private.parser_key_history WHERE fingerprint=$1',[sha256(rbKey.raw)])).rows[0].n,0);
  await db.query('DROP TRIGGER fixture_pair_failure ON public.audit_logs; DROP FUNCTION public.fixture_pair_failure()');
  eq((await pairSyntheticParser(pairing(rb,rbKey),consume(service))).key_version,1);
  const isolated=await fixture(),healthSource=await source(isolated),healthRequest=envelope(healthSource,'heartbeat');
  await db.query('UPDATE public.provider_accounts SET is_active=false WHERE id=$1',[isolated.a]);
  await send(healthRequest,401);
  await db.query('UPDATE public.provider_accounts SET is_active=true WHERE id=$1',[isolated.a]);
  await db.query("UPDATE public.merchants SET status='suspended' WHERE id=$1",[isolated.m]);
  await send(healthRequest,401);
  eq(await count('parser_requests','merchant_id=$1',[isolated.m]),0);
  await isolated.owner.end();await isolated.admin.end();
  async function blocked(p2,p1){const end=Date.now()+6000;while(Date.now()<end){if((await db.query('SELECT $1::int=ANY(pg_blocking_pids($2::int)) v',[p1,p2])).rows[0].v)return;await new Promise(r=>setTimeout(r,10));}throw Error('blocking barrier not reached');}
  async function race(isolation,kind){
    const f=await fixture();let a,b,p,q,k1=keys(),k2=keys();
    if(['pair','key uniqueness'].includes(kind)){a=await register(f);b=kind==='pair'?a:await register(f);if(kind==='key uniqueness')k2=k1;}
    else{a=await source(f);b=a;}
    if(kind==='rotate'){a={...a,...(await f.owner.query('SELECT public.issue_parser_pairing($1,1) v',[a.device_id])).rows[0].v};b=a;}
    const c1=await connect(),c2=await connect();for(const c of [c1,c2])await c.query(`BEGIN ISOLATION LEVEL ${isolation}; SET LOCAL ROLE service_role`);
    await c2.query('SELECT count(*) FROM public.parser_devices');
    const pid1=(await c1.query('SELECT pg_backend_pid() p')).rows[0].p,pid2=(await c2.query('SELECT pg_backend_pid() p')).rows[0].p;
    const pair=(c,d,k)=>c.query(pairSQL,[d.device_id,sha256(d.pairing_token),k.raw,d.key_version]);
    let second;
    if(['pair','key uniqueness','rotate'].includes(kind)){await pair(c1,a,k1);second=()=>pair(c2,b,k2);}
    else if(kind==='revoke'||kind==='revoke heartbeat'){
      await c1.query('SET LOCAL ROLE authenticated');await c1.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[f.users.owner]);await c1.query('SELECT public.revoke_parser_device($1)',[a.device_id]);
      p=envelope(a,kind==='revoke heartbeat'?'heartbeat':'evidence');second=()=>store(c2)[p.kind](p.h,sha256(a.raw),sha256(p.body),p.fields);
    }else if(kind==='ingestion before revoke'){
      p=envelope(a);await store(c1).evidence(p.h,sha256(a.raw),sha256(p.body),p.fields);
      await c2.query('SET LOCAL ROLE authenticated');await c2.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[f.users.owner]);
      second=()=>c2.query('SELECT public.revoke_parser_device($1)',[a.device_id]);
    }else{
      p=envelope(a,kind==='heartbeat'?'heartbeat':'evidence');q=envelope(a,p.kind,p.fields,{...(kind==='nonce'?{nonce:p.h.nonce}:{ingestion_id:p.h.ingestion_id})});
      const persist=(c,v)=>store(c)[v.kind](v.h,sha256(a.raw),sha256(v.body),v.fields);
      await persist(c1,p);second=()=>persist(c2,q);
    }
    const pending=second().then(v=>({v}),error=>({error}));await blocked(pid2,pid1);
    await c1.query(kind==='rollback'?'ROLLBACK':'COMMIT');const result=await pending;
    if(result.error){assert.ok(['40001','40P01','23505','42501'].includes(result.error.code),result.error.message);checks++;await c2.query('ROLLBACK');}
    else await c2.query('COMMIT');
    if(['pair','key uniqueness','rotate'].includes(kind)){
      assert.ok(result.error,'two competing key activations must not both succeed');checks++;
      eq((await db.query('SELECT count(*)::int n FROM ekpay_private.parser_key_history WHERE merchant_id=$1 AND retired_at IS NULL',[f.m])).rows[0].n,1);
      eq((await db.query('SELECT secret_key_version FROM public.parser_devices WHERE public_id=$1',[a.device_id])).rows[0].secret_key_version,kind==='rotate'?2:1);
    }else{
      if(kind.startsWith('revoke'))assert.ok(result.error);
      if(result.error && kind==='ingestion before revoke')await f.owner.query('SELECT public.revoke_parser_device($1)',[a.device_id]);
      else if(result.error && !['revoke','revoke heartbeat','nonce'].includes(kind))await store(service)[q.kind](q.h,sha256(a.raw),sha256(q.body),q.fields);
      eq(await count('payment_evidence','merchant_id=$1',[f.m]),['revoke','revoke heartbeat','heartbeat'].includes(kind)?0:1);
      eq(await count('parser_requests','merchant_id=$1 AND retry_of IS NULL',[f.m]),kind.startsWith('revoke')?0:1);
      if(kind.startsWith('revoke')||kind==='ingestion before revoke')await send(envelope(a),401);
    }
    await Promise.all([c1.end(),c2.end(),f.owner.end(),f.admin.end()]);
    races++;console.log(`PASS: ${isolation}: parser ${kind}; ${result.error?.code??'serialized/idempotent'}`);
  }
  for(const isolation of ['READ COMMITTED','REPEATABLE READ','SERIALIZABLE'])
    for(const kind of ['pair','key uniqueness','rotate','revoke','revoke heartbeat','ingestion before revoke','nonce','ingestion id','heartbeat','rollback'])await race(isolation,kind);
  console.log(`PASS: Phase 6 ${checks} assertions; ${races} real multi-session races; synthetic simulator only`);
});
