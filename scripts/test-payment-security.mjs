// Local, disposable PostgreSQL only. Never connects to Supabase.
// node scripts/test-payment-security.mjs <path-to-pglite-package>
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pglitePath = process.argv[2] || process.env.EKPAY_PGLITE_PATH || path.join(scriptDir, '../node_modules/@electric-sql/pglite');
const { PGlite } = await import(pathToFileURL(path.join(pglitePath, 'dist/index.js')));
const { pgcrypto } = await import(pathToFileURL(path.join(pglitePath, 'dist/contrib/pgcrypto.js')));
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const qid = (n) => `'${uid(n)}'`;
const hash = 'a'.repeat(64);
let checks = 0;
async function main() {
  const db = new PGlite({ extensions: { pgcrypto } });
  const sql = (s) => db.exec(s);
  async function denied(s, code) {
    await assert.rejects(sql(s), (e) => e.code === code, s);
    checks++;
  }
  async function scalar(s, expected) {
    assert.equal((await db.query(s)).rows[0].v, expected, s);
    checks++;
  }
  try {
    await sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
      CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN; END $$;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;`);
    await sql(fs.readFileSync(path.join(scriptDir, '../supabase/migrations/20260927072955_init_ekpay_core.sql'), 'utf8'));
    const migration = fs.readFileSync(path.join(scriptDir, '../supabase/migrations/20260927082848_core_payment_security_infrastructure.sql'), 'utf8');
    await sql(migration);
    checks++;
    await sql(`INSERT INTO auth.users VALUES (${qid(1)}),(${qid(2)}),(${qid(3)}),(${qid(4)});
      INSERT INTO public.merchants(id,name,slug) VALUES (${qid(10)},'A','a'),(${qid(20)},'B','b');
      INSERT INTO public.merchant_members(merchant_id,user_id,role) VALUES
        (${qid(10)},${qid(1)},'owner'),(${qid(20)},${qid(2)},'owner'),
        (${qid(10)},${qid(3)},'viewer'),(${qid(10)},${qid(4)},'developer');
      INSERT INTO public.merchant_brands(id,merchant_id,name) VALUES (${qid(11)},${qid(10)},'A'),(${qid(21)},${qid(20)},'B');
      INSERT INTO public.provider_accounts(id,merchant_id,brand_id,provider,account_type,account_number_masked,account_number_encrypted,receiver_identity_hash,account_encryption_key_reference)
        VALUES (${qid(12)},${qid(10)},${qid(11)},'bkash','merchant','***','TEST-CIPHERTEXT','${hash}','test-key-v1'),
        (${qid(22)},${qid(20)},${qid(21)},'bkash','merchant','***','TEST-CIPHERTEXT','${hash}','test-key-v1');`);
    const intent = (id, account = 12, brand = 11, provider = 'bkash') => `INSERT INTO public.payment_intents
      (id,merchant_id,brand_id,provider_account_id,public_id,merchant_reference,amount_minor,provider,created_at,expires_at)
      VALUES (${qid(id)},${qid(10)},${qid(brand)},${qid(account)},'p${id}','r${id}',100,'${provider}',now()-interval '1 minute',now()+interval '10 minutes')`;
    await denied(intent(30,22), '23503');
    await denied(intent(30,12,21), '23503');
    await denied(intent(30,12,11,'nagad'), '23503');
    await denied(`UPDATE public.provider_accounts SET brand_id=${qid(21)} WHERE id=${qid(12)}`, '23503');
    await sql(intent(30));
    await sql(intent(31));
    await denied(`INSERT INTO public.payment_intents(merchant_id,provider_account_id,public_id,merchant_reference,amount_minor)
      VALUES (${qid(10)},${qid(12)},'null-provider','null-provider',100)`,'23514');
    await sql(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid(1)}', false)`);
    await scalar('SELECT count(*)::int v FROM public.merchants', 1);
    await scalar('SELECT count(*)::int v FROM public.provider_accounts WHERE merchant_id=' + qid(20), 0);
    await denied('SELECT account_number_encrypted FROM public.provider_accounts', '42501');
    await denied('SELECT receiver_identity_hash FROM public.provider_accounts', '42501');
    await denied('SELECT account_encryption_key_reference FROM public.provider_accounts', '42501');
    for (const table of ['merchants','merchant_members','merchant_brands','provider_accounts','payment_intents','payment_evidence','payment_matches','transactions','events','audit_logs','webhook_deliveries','parser_devices','parser_requests','webhook_endpoints']) {
      await denied(`TRUNCATE public.${table}`, '42501');
    }
    await denied(intent(32), '42501');
    await denied(`UPDATE public.payment_intents SET status='verified',verified_at=now() WHERE id=${qid(30)}`, '42501');
    await denied(`UPDATE public.merchant_members SET role='owner'`, '42501');
    for (const table of ['payment_evidence','payment_matches','transactions','events','audit_logs','webhook_deliveries','parser_requests']) {
      await denied(`INSERT INTO public.${table} DEFAULT VALUES`, '42501');
      await denied(`UPDATE public.${table} SET merchant_id=${qid(20)}`, '42501');
      await denied(`DELETE FROM public.${table}`, '42501');
    }
    await denied('SELECT * FROM ekpay_private.webhook_secrets', '42501');
    await denied('SELECT * FROM ekpay_private.evidence_payloads', '42501');
    await denied('SELECT secret_hash FROM public.parser_devices', '42501');
    await sql(`INSERT INTO public.webhook_endpoints(merchant_id,url,event_subscriptions) VALUES (${qid(10)},'https://example.com/hook',ARRAY['payment.verified']);`);
    await denied('UPDATE public.webhook_endpoints SET enabled=true', '42501');
    await sql(`SELECT set_config('request.jwt.claim.sub', '${uid(3)}', false)`);
    await scalar('SELECT count(*)::int v FROM public.webhook_endpoints',0);
    await denied(`INSERT INTO public.webhook_endpoints(merchant_id,url,event_subscriptions) VALUES (${qid(10)},'https://example.com/x',ARRAY['payment.verified'])`, '42501');
    await denied(`INSERT INTO public.merchant_brands(merchant_id,name) VALUES (${qid(10)},'viewer-write')`, '42501');
    await sql(`SELECT set_config('request.jwt.claim.sub', '${uid(4)}', false)`);
    await scalar('SELECT count(*)::int v FROM public.webhook_endpoints',1);
    await scalar("WITH changed AS (UPDATE public.webhook_endpoints SET url='https://example.com/dev' RETURNING id) SELECT count(*)::int v FROM changed",0);
    await sql('RESET ROLE; SET ROLE anon');
    await denied('SELECT * FROM public.transactions', '42501');
    await denied('INSERT INTO public.events DEFAULT VALUES', '42501');
    await denied(`SELECT public.is_merchant_member(${qid(10)})`, '42501');
    await sql('RESET ROLE; SET ROLE service_role');
    await sql(`INSERT INTO public.parser_devices(id,merchant_id,secret_hash,signing_public_key) VALUES (${qid(40)},${qid(10)},'${hash}',decode('${hash}','hex'))`);
    const receipt = (id, ingestion, nonce, mh=hash, time='now()') => `INSERT INTO public.parser_requests
      (id,merchant_id,device_id,key_version,nonce,ingestion_id,message_hash,request_timestamp)
      VALUES (${qid(id)},${qid(10)},${qid(40)},1,'${nonce}',${qid(ingestion)},'${mh}',${time})`;
    await sql(receipt(41,42,'abcdefghijklmnop'));
    await denied(receipt(43,44,'abcdefghijklmnop','b'.repeat(64)), '23505');
    await denied(receipt(43,44,'different-nonce-12'), '23505');
    await denied(receipt(43,44,'different-nonce-12','b'.repeat(64),"now()-interval '6 minutes'"), '23514');
    await sql(`UPDATE public.parser_devices SET status='disabled' WHERE id=${qid(40)}`);
    await denied(receipt(43,44,'different-nonce-12','b'.repeat(64)), '23514');
    const parserEvidence = `INSERT INTO public.payment_evidence(id,merchant_id,provider_account_id,provider,source,provider_transaction_id,
      amount_minor,receiver_identity_hash,ingestion_id,message_hash,device_id,parser_request_id,provider_timestamp)
      VALUES (${qid(45)},${qid(10)},${qid(12)},'bkash','sms_parser','TXP',100,'${hash}',${qid(42)},'${hash}',${qid(40)},${qid(41)},now())`;
    await denied(parserEvidence, '23514');
    await sql(`UPDATE public.parser_devices SET status='active',revoked_at=NULL WHERE id=${qid(40)}`);
    await sql(parserEvidence);
    await denied(parserEvidence, '23505');
    await denied(`UPDATE public.parser_devices SET secret_hash='${'b'.repeat(64)}' WHERE id=${qid(40)}`,'23514');
    await sql(`UPDATE public.parser_devices SET secret_key_version=2,signing_public_key=decode('${'b'.repeat(64)}','hex') WHERE id=${qid(40)}`);
    await denied(receipt(43,44,'different-nonce-12','b'.repeat(64)), '23514');
    await denied(`UPDATE public.parser_devices SET secret_key_version=1 WHERE id=${qid(40)}`,'23514');
    await sql(`UPDATE public.parser_devices SET status='revoked',revoked_at=now() WHERE id=${qid(40)}`);
    await denied(`UPDATE public.parser_devices SET status='active',revoked_at=NULL WHERE id=${qid(40)}`,'23514');
    await denied(receipt(43,44,'different-nonce-12','b'.repeat(64)).replace(",1,'different",",2,'different"),'23514');
    const evidence = (id, tx='TX1', amount=100, rh=hash) => `INSERT INTO public.payment_evidence
      (id,merchant_id,provider_account_id,provider,source,provider_transaction_id,amount_minor,receiver_identity_hash,ingestion_id,message_hash,provider_timestamp)
      VALUES (${qid(id)},${qid(10)},${qid(12)},'bkash','provider_api','${tx}',${amount},'${rh}',${qid(id+100)},'${id.toString(16).padStart(64,'0')}',now())`;
    await sql(evidence(50));
    await sql(evidence(51,'TX2',99));
    await sql(evidence(52,'TX3',100,'b'.repeat(64)));
    await denied(parserEvidence.replace(qid(41), 'NULL').replace(qid(45),qid(46)),'23514');
    const match = (id,intentId,evidenceId) => `INSERT INTO public.payment_matches
      (id,merchant_id,payment_intent_id,payment_evidence_id,algorithm_version,provider_match,amount_match,receiver_match,transaction_id_match,time_match,status)
      VALUES (${qid(id)},${qid(10)},${qid(intentId)},${qid(evidenceId)},'v1',true,true,true,true,true,'matched')`;
    await sql(match(60,30,50)); await sql(match(61,31,51)); await sql(match(62,31,52));
    const tx = (id,intentId,evidenceId,matchId,providerTx) => `INSERT INTO public.transactions
      (id,merchant_id,payment_intent_id,payment_evidence_id,payment_match_id,provider_account_id,provider,provider_transaction_id,amount_minor,verification_source,verified_at)
      VALUES (${qid(id)},${qid(10)},${qid(intentId)},${qid(evidenceId)},${qid(matchId)},${qid(12)},'bkash','${providerTx}',100,'provider_api',clock_timestamp())`;
    await denied(tx(70,31,51,61,'TX2'), '23514');
    await denied(tx(70,31,52,62,'TX3'), '23514');
    await sql(tx(70,30,50,60,'TX1'));
    await scalar(`SELECT status v FROM public.payment_intents WHERE id=${qid(30)}`, 'verified');
    await scalar(`SELECT count(*)::int v FROM public.events WHERE object_id=${qid(70)}`, 1);
    await denied(tx(71,30,50,60,'TX1'), '23514');
    await sql(evidence(53,'TX1')); await sql(match(63,31,53));
    await denied(tx(71,31,53,63,'TX1'), '23505');
    await denied(`UPDATE public.payment_intents SET amount_minor=101 WHERE id=${qid(30)}`, '23514');
    // service_role itself has no update/delete privilege on append-only tables.
    await denied(`DELETE FROM public.transactions`, '42501');
    await sql('RESET ROLE');
    await denied(`INSERT INTO public.payment_matches(merchant_id,payment_intent_id,payment_evidence_id,algorithm_version,
      provider_match,amount_match,receiver_match,transaction_id_match,time_match,status,reviewed_by,review_reason)
      VALUES (${qid(10)},${qid(31)},${qid(50)},'v1',true,true,true,true,true,'matched',${qid(2)},'test-review')`,'23503');
    await sql(`INSERT INTO public.audit_logs(merchant_id,actor_type,actor_id,action,target_type,target_id)
      VALUES (${qid(10)},'user',${qid(1)},'payment.review','payment_intent',${qid(30)})`); checks++;
    await denied(`INSERT INTO public.audit_logs(merchant_id,actor_type,actor_id,action,target_type,target_id)
      VALUES (${qid(20)},'user',${qid(2)},'payment.review','payment_intent',${qid(30)})`,'23514');
    await denied(`INSERT INTO public.audit_logs(merchant_id,actor_type,actor_id,action,target_type,target_id)
      VALUES (${qid(10)},'user',${qid(2)},'payment.review','payment_intent',${qid(30)})`,'23514');
    await denied(`INSERT INTO public.audit_logs(merchant_id,actor_type,actor_id,action,target_type,target_id)
      VALUES (${qid(20)},'parser_device',${qid(40)},'device.check','brand',${qid(21)})`,'23514');
    await denied(`INSERT INTO public.audit_logs(merchant_id,actor_type,actor_id,action,target_type,target_id)
      VALUES (${qid(10)},'api_key',${qid(1)},'api.check','merchant',${qid(10)})`,'23514');
    await denied(`UPDATE public.transactions SET amount_minor=101`, '23514');
    await denied(`DELETE FROM public.payment_evidence`, '23514');
    await denied(`INSERT INTO public.events(merchant_id,event_type,object_type,object_id,idempotency_key)
      VALUES (${qid(20)},'payment.verified','transaction',${qid(70)},gen_random_uuid())`, '23514');
    await sql(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${uid(2)}', false)`);
    for (const table of ['transactions','events','payment_matches']) await scalar(`SELECT count(*)::int v FROM public.${table}`,0);
    await scalar('SELECT count(id)::int v FROM public.payment_evidence',0);
    await sql('RESET ROLE');
    await denied(`INSERT INTO public.payment_matches(merchant_id,payment_intent_id,payment_evidence_id,algorithm_version,
      provider_match,amount_match,receiver_match,transaction_id_match,time_match,status)
      VALUES (${qid(20)},${qid(31)},${qid(50)},'v1',true,true,true,true,true,'matched')`,'23503');
    await denied(`INSERT INTO public.payment_matches(merchant_id,payment_intent_id,payment_evidence_id,algorithm_version,
      provider_match,amount_match,receiver_match,transaction_id_match,time_match,status)
      VALUES (${qid(10)},${qid(31)},${qid(50)},'v1',true,false,true,true,true,'matched')`,'23514');
    await sql(`INSERT INTO public.webhook_endpoints(id,merchant_id,url,event_subscriptions)
      VALUES (${qid(80)},${qid(20)},'https://example.com/b',ARRAY['payment.verified']);`);
    await sql(`INSERT INTO public.webhook_endpoints(id,merchant_id,url,event_subscriptions)
      VALUES (${qid(81)},${qid(10)},'https://example.com/a',ARRAY['payment.verified']);
      INSERT INTO ekpay_private.webhook_secrets(merchant_id,endpoint_id,version,ciphertext,key_reference)
      VALUES (${qid(10)},${qid(81)},1,decode('aa','hex'),'test-key-reference'),
        (${qid(20)},${qid(80)},1,decode('bb','hex'),'test-key-reference');`);
    const delivery = `INSERT INTO public.webhook_deliveries(merchant_id,endpoint_id,event_id,attempt_number,secret_version,endpoint_url,
      status,http_response_code,duration_ms,delivered_at)
      SELECT ${qid(10)},${qid(81)},id,1,1,'https://example.com/a','delivered',200,10,now() FROM public.events LIMIT 1`;
    await sql(delivery); checks++;
    await denied(delivery,'23505');
    await denied(`UPDATE public.webhook_deliveries SET duration_ms=11`,'23514');
    await denied(delivery.replace("'delivered',200", "'delivered',500"),'23514');
    await denied(delivery.replace("id,1,1,", "id,2,9,"),'23503');
    await denied(`INSERT INTO public.webhook_deliveries(merchant_id,endpoint_id,event_id,attempt_number,secret_version,endpoint_url,status,duration_ms)
      SELECT ${qid(10)},${qid(80)},id,1,1,'https://example.com/b','permanent_failure',10 FROM public.events LIMIT 1`,'23503');
    await denied(`INSERT INTO public.webhook_deliveries(merchant_id,endpoint_id,event_id,attempt_number,secret_version,endpoint_url,status,duration_ms)
      SELECT ${qid(20)},${qid(80)},id,1,1,'https://example.com/b','permanent_failure',10 FROM public.events LIMIT 1`,'23503');
    await denied(`INSERT INTO ekpay_private.evidence_payloads(merchant_id,evidence_id,ciphertext,key_reference)
      VALUES (${qid(20)},${qid(50)},decode('aa','hex'),'test-key-reference')`,'23503');
    await denied(`INSERT INTO public.payment_intents(merchant_id,public_id,merchant_reference,amount_minor,status,verified_at)
      VALUES (${qid(10)},'forged','forged',100,'verified',now())`,'23514');
    await scalar(`SELECT count(*)::int v FROM pg_class WHERE relnamespace IN ('public'::regnamespace,'ekpay_private'::regnamespace) AND relkind='r' AND NOT relrowsecurity`,0);
    await scalar(`SELECT has_function_privilege('anon','public.ekpay_validate_transaction()','EXECUTE') v`,false);
    await scalar(`SELECT count(*)::int v FROM information_schema.role_table_grants
      WHERE table_schema IN ('public','ekpay_private') AND grantee IN ('PUBLIC','anon','authenticated')
      AND privilege_type IN ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN','DELETE')`,0);
    await scalar(`SELECT count(*)::int v FROM pg_class WHERE relnamespace IN ('public'::regnamespace,'ekpay_private'::regnamespace) AND relkind='S'`,0);
    await scalar(`SELECT count(*)::int v FROM pg_proc WHERE pronamespace='public'::regnamespace
      AND proname LIKE 'ekpay_%' AND (prosecdef OR has_function_privilege('anon',oid,'EXECUTE') OR has_function_privilege('authenticated',oid,'EXECUTE'))`,0);
    console.log(`PASS: migrations executed locally; ${checks} security checks passed.`);
  } finally { await db.close(); }
}
main().catch((e) => { console.error(e.message); process.exitCode=1; });
