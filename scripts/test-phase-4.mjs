import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { withPostgres } from "./testing/postgres.mjs";

let checks = 0;
const rpc = "SELECT public.verify_payment_evidence($1,$2) v";
const hash = (value) => createHash("sha256").update(value).digest("hex");
await withPostgres(async ({ db, connect }) => {
  const service = await connect();
  await service.query("SET ROLE service_role");
  const denied = async (c, sql, params, code) => {
    await assert.rejects(c.query(sql, params), (e) => e.code === code);
    checks++;
  };
  const eq = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  async function fixture({ environment = "test", provider = "bkash" } = {}) {
    const merchant = randomUUID(), user = randomUUID(), account = randomUUID();
    await db.query("INSERT INTO auth.users(id,email_confirmed_at) VALUES($1,now())", [user]);
    await db.query("INSERT INTO public.merchants(id,name,slug) VALUES($1,'Synthetic fixture',$2)", [merchant, "fixture-" + merchant]);
    await db.query("INSERT INTO public.merchant_members(merchant_id,user_id,role) VALUES($1,$2,'owner')", [merchant,user]);
    await db.query(`INSERT INTO public.provider_accounts(id,merchant_id,environment,provider,account_type,account_number_masked,
      account_number_encrypted,receiver_identity_hash,account_encryption_key_reference)
      VALUES($1,$2,$3,$4,'merchant','synthetic account','synthetic ciphertext',$5,'fixture-only')`, [account,merchant,environment,provider,"a".repeat(64)]);
    return {merchant,user,account,environment,provider};
  }
  async function intent(f, { amount = 10000, state = "created", expires = "1 hour", environment = f.environment, account = f.account, provider = f.provider } = {}) {
    const id = randomUUID();
    await db.query(`INSERT INTO public.payment_intents(id,merchant_id,environment,provider_account_id,provider,public_id,merchant_reference,
      amount_minor,status,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp()-interval '1 minute',clock_timestamp()+$10::interval)`,
      [id,f.merchant,environment,account,provider,"pi_"+id.replaceAll("-",""),"fixture-"+id,amount,state,expires]);
    return id;
  }
  async function evidence(f, { amount = 10000, reference = "FIXTURE_" + randomUUID().replaceAll("-","").toUpperCase(),
    receiver = "a".repeat(64), timestamp = "clock_timestamp()", trust = "synthetic", source = "provider_api" } = {}, client = db) {
    // timestamp SQL is exclusively from constants in this local test source, never external input.
    const id = randomUUID();
    await client.query(`INSERT INTO public.payment_evidence(id,merchant_id,environment,provider_account_id,provider,source,provider_transaction_id,
      amount_minor,receiver_identity_hash,provider_timestamp,ingestion_id,message_hash,trust_state)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,${timestamp},$10,$11,$12)`,
      [id,f.merchant,f.environment,f.account,f.provider,source,reference,amount,receiver,randomUUID(),hash(id),trust]);
    return id;
  }
  const verify = async (i,e,c=service) => (await c.query(rpc,[i,e])).rows[0].v;
  async function state(i) { return (await db.query("SELECT status FROM public.payment_intents WHERE id=$1",[i])).rows[0].status; }
  async function count(table, where, params) { return Number((await db.query(`SELECT count(*) n FROM public.${table} WHERE ${where}`,params)).rows[0].n); }
  const f = await fixture(), i = await intent(f), e = await evidence(f);
  await denied(service,rpc,[i,e],"42501");
  await denied(service,"UPDATE ekpay_private.verification_policy SET enabled=true",[],"42501");
  for (const role of ["anon","authenticated"]) {
    const c = await connect(); await c.query(`SET ROLE ${role}`);
    await denied(c,rpc,[i,e],"42501");
    for (const table of ["payment_evidence","payment_matches","transactions"])
      eq((await db.query("SELECT has_table_privilege($1,$2,'INSERT') v",[role,"public."+table])).rows[0].v,false);
  }
  for (const table of ["payment_matches","transactions"])
    eq((await db.query("SELECT has_table_privilege('service_role',$1,'INSERT') v",["public."+table])).rows[0].v,false);
  eq((await db.query("SELECT count(*)::int v FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('payment_intents','provider_accounts') AND column_name='environment' AND column_default IS NOT NULL")).rows[0].v,0);
  await denied(db,`INSERT INTO public.payment_intents(merchant_id,public_id,merchant_reference,amount_minor) VALUES($1,$2,$2,100)`,[f.merchant,randomUUID()],"23502");
  await db.query("UPDATE ekpay_private.verification_policy SET enabled=true"); // Only local DBA; no remote connection support.
  const first = await verify(i,e);
  eq(first.outcome,"verified"); eq(await state(i),"verified");
  const retry = await verify(i,e);
  eq(retry.transaction_id,first.transaction_id); eq(retry.reused,true);
  eq(await count("transactions","payment_intent_id=$1",[i]),1);
  eq(await count("events","event_type='payment.verified' AND object_id=$1",[first.transaction_id]),1);
  eq(await count("audit_logs","action='payment.verification_decided' AND target_id=$1",[first.match_id]),1);
  const match = (await db.query("SELECT * FROM public.payment_matches WHERE id=$1",[first.match_id])).rows[0];
  for(const key of ["merchant_match","environment_match","provider_match","amount_match","receiver_match","transaction_id_match","time_match","source_trusted","intent_eligible"]) eq(match[key],true);
  for(const sql of ["UPDATE public.payment_intents SET status='pending' WHERE id=$1", "UPDATE public.payment_intents SET amount_minor=99 WHERE id=$1", "DELETE FROM public.payment_intents WHERE id=$1"])
    await denied(db,sql,[i],"23514");
  for(const table of ["transactions","payment_matches","payment_evidence"]) {
    const id = table==="transactions" ? first.transaction_id : table==="payment_matches" ? first.match_id : e;
    await denied(db,`UPDATE public.${table} SET id=id WHERE id=$1`,[id],"23514");
    await denied(db,`DELETE FROM public.${table} WHERE id=$1`,[id],"23514");
  }
  eq((await verify(randomUUID(),e)).outcome,"no_match");
  for(const [name, overrides, outcome] of [
    ["wrong amount",{amount:10001},"failed"], ["wrong receiver",{receiver:"b".repeat(64)},"failed"],
    ["old timestamp",{timestamp:"clock_timestamp()-interval '2 minutes'"},"failed"],
    ["future timestamp",{timestamp:"clock_timestamp()+interval '1 second'"},"failed"],
    ["missing timestamp",{timestamp:"NULL"},"manual_review"], ["missing trx",{reference:null},"failed"],
    ["untrusted",{trust:"untrusted"},"manual_review"], ["manual evidence",{source:"manual"},"manual_review"],
  ]) {
    const x=await fixture(), target=await intent(x), observation=await evidence(x,overrides);
    eq((await verify(target,observation)).outcome,outcome); eq(await count("transactions","payment_intent_id=$1",[target]),0);
    if(outcome==="manual_review") eq(await state(target),"manual_review");
    else eq(await state(target),"created"); // A rejected observation cannot cancel a valid intent.
    console.log(`PASS: ${name} -> ${outcome}, no authoritative transaction`);
  }
  const wrongProvider=await fixture({provider:"nagad"});
  const otherAccount=randomUUID();
  await db.query(`INSERT INTO public.provider_accounts(id,merchant_id,environment,provider,account_type,account_number_masked,account_number_encrypted,receiver_identity_hash,account_encryption_key_reference)
    VALUES($1,$2,'test','bkash','merchant','synthetic','synthetic',$3,'fixture-only')`,[otherAccount,wrongProvider.merchant,"a".repeat(64)]);
  eq((await verify(await intent(wrongProvider,{provider:"bkash",account:otherAccount}),await evidence(wrongProvider))).outcome,"failed");
  const other=await fixture();
  const wrongAccount=randomUUID();
  await db.query(`INSERT INTO public.provider_accounts(id,merchant_id,environment,provider,account_type,account_number_masked,account_number_encrypted,receiver_identity_hash,account_encryption_key_reference)
    VALUES($1,$2,'test','bkash','merchant','synthetic','synthetic',$3,'fixture-only')`,[wrongAccount,other.merchant,"a".repeat(64)]);
  const wrongAccountIntent=await intent(other);
  eq((await verify(wrongAccountIntent,await evidence({...other,account:wrongAccount}))).outcome,"failed");
  eq(await count("transactions","payment_intent_id=$1",[wrongAccountIntent]),0);
  await denied(service,rpc,[await intent(other),e],"42501");
  const live=await fixture({environment:"live"}), liveIntent=await intent(live), liveEvidence=await evidence(live);
  await denied(service,rpc,[liveIntent,liveEvidence],"42501");
  const liveAccount=randomUUID();
  await db.query(`INSERT INTO public.provider_accounts(id,merchant_id,environment,provider,account_type,account_number_masked,account_number_encrypted,receiver_identity_hash,account_encryption_key_reference)
    VALUES($1,$2,'live','bkash','merchant','synthetic','synthetic',$3,'fixture-only')`,[liveAccount,f.merchant,"a".repeat(64)]);
  await denied(service,rpc,[await intent(f,{environment:"live",account:liveAccount}),e],"42501");
  for(const status of ["failed","expired","manual_review"]) {
    const x=await fixture(), target=await intent(x,{state:status}), observation=await evidence(x);
    eq((await verify(target,observation)).outcome,status==="manual_review"?"manual_review":"failed");
    eq(await state(target),status); eq(await count("transactions","payment_intent_id=$1",[target]),0);
    await denied(db,"UPDATE public.payment_intents SET status='pending' WHERE id=$1",[target],"23514");
  }
  const expired=await fixture(), expiredIntent=await intent(expired,{expires:"-1 second"});
  eq((await verify(expiredIntent,await evidence(expired))).outcome,"failed"); eq(await state(expiredIntent),"expired");
  const ambiguous=await fixture(), a1=await intent(ambiguous), a2=await intent(ambiguous), ae=await evidence(ambiguous);
  eq((await verify(a1,ae)).outcome,"manual_review"); eq((await verify(a2,ae)).outcome,"manual_review");
  eq(await count("transactions","merchant_id=$1",[ambiguous.merchant]),0);
  const conflict=await fixture(), ci=await intent(conflict), ref="FIXTURE_"+randomUUID().replaceAll("-","").toUpperCase();
  const ce=await evidence(conflict,{reference:ref}); await evidence(conflict,{reference:ref,amount:10001});
  eq((await verify(ci,ce)).outcome,"manual_review"); eq(await count("transactions","merchant_id=$1",[conflict.merchant]),0);
  const consumed=await intent(f);
  eq((await verify(consumed,e)).outcome,"manual_review"); eq(await count("transactions","payment_evidence_id=$1",[e]),1);
  // RLS safe detail reads and restricted account/hash material.
  const reader=await connect(); await reader.query("SET ROLE authenticated");
  await reader.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[f.user]);
  eq((await reader.query("SELECT count(*)::int n FROM public.payment_matches WHERE merchant_id=$1",[other.merchant])).rows[0].n,0);
  await denied(reader,"SELECT receiver_identity_hash FROM public.payment_evidence",[],"42501");
  await denied(reader,"SELECT account_number_encrypted FROM public.provider_accounts",[],"42501");
  eq((await reader.query("SELECT environment,trust_state FROM public.payment_evidence WHERE id=$1",[e])).rowCount,1);
  const secrets=(await db.query("SELECT coalesce(string_agg(payload::text,' '),'') value FROM public.events")).rows[0].value+
    (await db.query("SELECT coalesce(string_agg(metadata::text,' '),'') value FROM public.audit_logs WHERE action='payment.verification_decided'")).rows[0].value;
  eq(/synthetic ciphertext|receiver_identity_hash|api_key_secret|raw_sms|message_hash/.test(secrets),false);
  eq((await db.query(`SELECT bool_and(p.proconfig @> ARRAY['search_path=""'] AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE')) v
    FROM pg_proc p WHERE p.proname IN ('verify_payment_evidence','ekpay_serialize_verification_inputs')`)).rows[0].v,true);
  // Force a late failure: transaction, intent, match and events must all roll back.
  const rollback=await fixture(), ri=await intent(rollback), re=await evidence(rollback);
  await db.query(`CREATE FUNCTION public.fixture_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture rollback' USING ERRCODE='P0001'; END $$;
    CREATE TRIGGER fixture_reject_audit BEFORE INSERT ON public.audit_logs FOR EACH ROW WHEN(NEW.action='payment.verification_decided') EXECUTE FUNCTION public.fixture_reject_audit()`);
  await denied(service,rpc,[ri,re],"P0001");
  eq(await state(ri),"created"); eq(await count("transactions","payment_intent_id=$1",[ri]),0);
  eq(await count("payment_matches","payment_intent_id=$1",[ri]),0); eq(await count("events","merchant_id=$1 AND event_type<>'payment.evidence_received'",[rollback.merchant]),0);
  await db.query("DROP TRIGGER fixture_reject_audit ON public.audit_logs; DROP FUNCTION public.fixture_reject_audit()");
  eq((await verify(ri,re)).outcome,"verified");

  async function waitBlocked(waiter, blocker) {
    const until=Date.now()+6000;
    while(Date.now()<until) {
      if((await db.query("SELECT $1::int=ANY(pg_blocking_pids($2::int)) v",[blocker,waiter])).rows[0].v) return;
      await new Promise(r=>setTimeout(r,10));
    }
    throw new Error("race did not reach a real database blocking barrier");
  }
  async function race(isolation, scenario) {
    const x=await fixture(), target=await intent(x), observation=await evidence(x);
    let secondIntent=target, secondEvidence=observation;
    if(scenario==="two intents") secondIntent=await intent(x,{amount:10001});
    if(scenario==="ambiguous") secondIntent=await intent(x);
    if(scenario==="duplicate reference") {
      const row=(await db.query("SELECT provider_transaction_id,provider_timestamp FROM public.payment_evidence WHERE id=$1",[observation])).rows[0];
      secondEvidence=await evidence(x,{reference:row.provider_transaction_id,timestamp:`(SELECT provider_timestamp FROM public.payment_evidence WHERE id='${observation}')`});
      secondIntent=await intent(x); // Starts after evidence time: not an ambiguous target.
      await db.query("UPDATE public.payment_intents SET created_at=clock_timestamp() WHERE id=$1",[secondIntent]);
    }
    const c1=await connect(),c2=await connect();
    for(const c of [c1,c2]) await c.query(`BEGIN ISOLATION LEVEL ${isolation}; SET LOCAL ROLE service_role`);
    // Establish both snapshots BEFORE the winner's actual serialization write.
    await c2.query("SELECT count(*) FROM public.payment_intents");
    const p1=(await c1.query("SELECT pg_backend_pid() p")).rows[0].p;
    const p2=(await c2.query("SELECT pg_backend_pid() p")).rows[0].p;
    if(scenario==="expire" || scenario==="review")
      await c1.query("UPDATE public.payment_intents SET status=$2 WHERE id=$1",[target,scenario==="expire"?"expired":"manual_review"]);
    else if(scenario==="new conflict") {
      const ref=(await db.query("SELECT provider_transaction_id FROM public.payment_evidence WHERE id=$1",[observation])).rows[0].provider_transaction_id;
      // DBA-only fixture insertion; Phase 5 revokes normal server direct INSERT.
      await c1.query("RESET ROLE");
      await evidence(x,{reference:ref,amount:10001},c1);
      await c1.query("SET LOCAL ROLE service_role");
    } else if(scenario==="new candidate") {
      const newId=randomUUID();
      await c1.query(`INSERT INTO public.payment_intents(merchant_id,environment,provider_account_id,provider,public_id,merchant_reference,amount_minor,created_at,expires_at)
        VALUES($1,'test',$2,'bkash',$3,$3,10000,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour')`,[x.merchant,x.account,"pi_"+newId.replaceAll("-","")]);
    } else eq((await verify(target,observation,c1)).outcome,scenario==="ambiguous"?"manual_review":"verified");
    const pending=(scenario==="verify wins expire"||scenario==="verify wins review"
      ? c2.query("UPDATE public.payment_intents SET status=$2 WHERE id=$1",[target,scenario==="verify wins expire"?"expired":"manual_review"])
      : verify(secondIntent,secondEvidence,c2)).then(v=>({v}),error=>({error}));
    await waitBlocked(p2,p1);
    await c1.query(scenario==="rollback"?"ROLLBACK":"COMMIT");
    const result=await pending;
    if(result.error) {
      assert.ok(["40001","40P01",...((scenario.startsWith("verify wins"))?["23514"]:[])].includes(result.error.code),result.error.message);
      await c2.query("ROLLBACK");
      // Whole transaction retry with a fresh snapshot is safe.
      if(!scenario.startsWith("verify wins")) await verify(secondIntent,secondEvidence);
    } else await c2.query("COMMIT");
    const n=await count("transactions","merchant_id=$1",[x.merchant]);
    eq(n,["ambiguous","expire","review","new conflict","new candidate"].includes(scenario)?0:1);
    eq(await count("events","merchant_id=$1 AND event_type='payment.verified'",[x.merchant]),n);
    if(scenario==="same"||scenario==="rollback") {
      eq(await count("payment_matches","merchant_id=$1",[x.merchant]),1);
      eq(await count("audit_logs","merchant_id=$1 AND action='payment.verification_decided'",[x.merchant]),1);
    }
    eq(await count("payment_intents","merchant_id=$1 AND status='verified'",[x.merchant]),n);
    console.log(`PASS: ${isolation}: ${scenario}; ${result.error?.code??"serialized/replayed"}; transactions=${n}`);
  }
  for(const isolation of ["READ COMMITTED","REPEATABLE READ","SERIALIZABLE"])
    for(const scenario of ["same","two intents","ambiguous","duplicate reference","expire","review","verify wins expire","verify wins review","rollback","new conflict","new candidate"])
      await race(isolation,scenario);
  console.log(`PASS: Phase 4 native PostgreSQL: ${checks} checks, 33 real multi-session races; synthetic fixtures only.`);
});
