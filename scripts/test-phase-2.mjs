import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "node:fs";
import assert from "node:assert/strict";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const q = (n) => `'${id(n)}'`;
const db = new PGlite({ extensions: { pgcrypto } });
let checks = 0;
async function denied(sql, code) {
  await assert.rejects(db.exec(sql), (e) => e.code === code, sql);
  checks++;
}
async function scalar(sql, value) {
  assert.equal((await db.query(sql)).rows[0].v, value, sql);
  checks++;
}
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email_confirmed_at timestamptz,is_anonymous boolean DEFAULT false);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;`);
  for (const file of [
    "20260927072955_init_ekpay_core.sql",
    "20260927082848_core_payment_security_infrastructure.sql",
    "20260927090644_auth_merchant_bootstrap_api_keys.sql",
  ])
    await db.exec(
      fs.readFileSync(
        new URL("../supabase/migrations/" + file, import.meta.url),
        "utf8",
      ),
    );
  await db.exec(`INSERT INTO auth.users(id,email_confirmed_at) VALUES (${q(1)},now()),(${q(2)},now()),(${q(3)},now()),(${q(4)},now()),(${q(5)},NULL);
    SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${id(1)}',false);`);
  const a = (
    await db.query(
      "SELECT public.bootstrap_merchant('Merchant A','merchant-a') AS id",
    )
  ).rows[0].id;
  await scalar(
    `SELECT count(*)::int v FROM public.merchant_members WHERE merchant_id='${a}' AND user_id=${q(1)} AND role='owner'`,
    1,
  );
  await scalar(
    "SELECT public.bootstrap_merchant('Merchant A','merchant-a') v",
    a,
  );
  await denied(
    "SELECT public.bootstrap_merchant('Another','another')",
    "42501",
  );
  await denied(
    `INSERT INTO public.merchant_members(merchant_id,user_id,role) VALUES ('${a}',${q(2)},'owner')`,
    "42501",
  );
  await denied(
    "INSERT INTO public.merchants(name,slug) VALUES ('Unsafe','unsafe')",
    "42501",
  );
  await db.exec(`SELECT set_config('request.jwt.claim.sub','${id(2)}',false)`);
  await denied(
    "SELECT public.bootstrap_merchant('Merchant B','merchant-a')",
    "23505",
  );
  const b = (
    await db.query(
      "SELECT public.bootstrap_merchant('Merchant B','merchant-b') AS id",
    )
  ).rows[0].id;
  await db.exec(`SELECT set_config('request.jwt.claim.sub','${id(5)}',false)`);
  await denied(
    "SELECT public.bootstrap_merchant('Unconfirmed','unconfirmed')",
    "42501",
  );
  await db.exec("SELECT set_config('request.jwt.claim.sub','',false)");
  await denied(
    "SELECT public.bootstrap_merchant('No Auth','no-auth')",
    "42501",
  );
  await db.exec("RESET ROLE");
  await db.exec(`CREATE FUNCTION public.test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action='merchant.created' AND EXISTS (SELECT 1 FROM public.merchants WHERE id=NEW.merchant_id AND slug='partial-failure') THEN RAISE EXCEPTION 'test failure' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER test_partial_failure BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.test_audit_failure();
    SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${id(3)}',false)`);
  await denied(
    "SELECT public.bootstrap_merchant('Partial','partial-failure')",
    "23514",
  );
  await db.exec("RESET ROLE");
  await scalar(
    "SELECT count(*)::int v FROM public.merchants WHERE slug='partial-failure'",
    0,
  );
  await scalar(
    `SELECT count(*)::int v FROM public.merchant_members WHERE user_id=${q(3)}`,
    0,
  );
  await db.exec(`DROP TRIGGER test_partial_failure ON public.audit_logs;
    INSERT INTO public.merchant_members(merchant_id,user_id,role) VALUES ('${a}',${q(3)},'viewer'),('${a}',${q(4)},'developer');
    SET ROLE service_role;`);
  const create = (actor, merchant, key, scope = "transactions:read") =>
    `SELECT public.create_merchant_api_key(${q(actor)},'${merchant}',${q(key)},'SDK','ek_test_${key.toString(16).padStart(16, "0")}','${key.toString(16).padStart(64, "0")}','test',ARRAY['${scope}'])`;
  await db.exec(create(1, a, 10));
  checks++;
  await denied(create(1, b, 11), "42501");
  await denied(create(3, a, 11), "42501");
  await denied(create(4, a, 11), "42501");
  await denied(create(1, a, 11, "unknown:scope"), "23514");
  await scalar(
    `SELECT count(*)::int v FROM public.api_keys WHERE id=${q(11)}`,
    0,
  );
  await denied(`INSERT INTO public.api_keys DEFAULT VALUES`, "42501");
  await denied(`UPDATE public.api_keys SET status='revoked'`, "42501");
  await db.exec(
    `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${id(1)}',false)`,
  );
  await scalar("SELECT count(id)::int v FROM public.api_keys", 1);
  await denied("SELECT secret_hash FROM public.api_keys", "42501");
  await denied(create(1, a, 12), "42501");
  await denied(
    `SELECT public.revoke_merchant_api_key(${q(1)},'${a}',${q(10)})`,
    "42501",
  );
  await db.exec(`SELECT set_config('request.jwt.claim.sub','${id(2)}',false)`);
  await scalar("SELECT count(id)::int v FROM public.api_keys", 0);
  await db.exec(`SELECT set_config('request.jwt.claim.sub','${id(3)}',false)`);
  await scalar("SELECT count(id)::int v FROM public.api_keys", 0);
  await db.exec(`SELECT set_config('request.jwt.claim.sub','${id(4)}',false)`);
  await scalar("SELECT count(id)::int v FROM public.api_keys", 1);
  await denied("TRUNCATE public.api_keys", "42501");
  await db.exec(`RESET ROLE; SET ROLE service_role`);
  await denied(
    `SELECT public.revoke_merchant_api_key(${q(2)},'${b}',${q(10)})`,
    "42501",
  );
  await db.exec(
    `SELECT public.revoke_merchant_api_key(${q(1)},'${a}',${q(10)}); SELECT public.revoke_merchant_api_key(${q(1)},'${a}',${q(10)})`,
  );
  await scalar(
    `SELECT status v FROM public.api_keys WHERE id=${q(10)}`,
    "revoked",
  );
  await scalar(
    `SELECT count(*)::int v FROM public.audit_logs WHERE target_id=${q(10)} AND action='api_key.revoked'`,
    1,
  );
  await scalar(
    `SELECT count(*)::int v FROM public.audit_logs WHERE target_id=${q(10)} AND action='api_key.created'`,
    1,
  );
  await db.exec("RESET ROLE");
  await denied(
    `UPDATE public.api_keys SET status='active',revoked_at=NULL WHERE id=${q(10)}`,
    "23514",
  );
  await denied(
    `DELETE FROM public.merchant_members WHERE merchant_id='${a}' AND role='owner'`,
    "23514",
  );
  await denied(
    `UPDATE public.merchant_members SET role='viewer' WHERE merchant_id='${a}' AND role='owner'`,
    "23514",
  );
  await scalar(
    `SELECT count(*)::int v FROM public.merchant_members WHERE merchant_id='${a}' AND role='owner'`,
    1,
  );
  await db.exec("SET ROLE anon");
  await denied(
    "SELECT public.bootstrap_merchant('Anon','anon-merchant')",
    "42501",
  );
  await denied("SELECT id FROM public.api_keys", "42501");
  await db.exec("RESET ROLE");
  await scalar(
    `SELECT has_function_privilege('authenticated','public.create_merchant_api_key(uuid,uuid,uuid,text,text,text,text,text[],timestamptz)','EXECUTE') v`,
    false,
  );
  await scalar(
    `SELECT count(*)::int v FROM pg_proc WHERE pronamespace='public'::regnamespace AND prosecdef AND proname IN ('bootstrap_merchant','create_merchant_api_key','revoke_merchant_api_key') AND proconfig=ARRAY['search_path=""']`,
    3,
  );
  console.log(`PASS: Phase 2 migrations and ${checks} DB security checks.`);
} finally {
  await db.close();
}
