import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withPostgres } from "./testing/postgres.mjs";
import { testApiHandlers } from "./testing/api-transport.mjs";
let checks = 0;
await withPostgres(async ({ db, connect }) => {
  async function scalar(sql, params, value) {
    assert.equal((await db.query(sql, params)).rows[0].v, value);
    checks++;
  }
  async function denied(c, sql, params, code) {
    await assert.rejects(c.query(sql, params), (e) => e.code === code);
    checks++;
  }
  const owner = randomUUID(),
    m = randomUUID(),
    other = randomUUID();
  await db.query(
    "INSERT INTO auth.users(id,email_confirmed_at) VALUES($1,now())",
    [owner],
  );
  for (const merchant of [m, other]) {
    await db.query(
      "INSERT INTO public.merchants(id,name,slug) VALUES($1,'Fixture',$2)",
      [merchant, "test-" + merchant],
    );
    await db.query(
      "INSERT INTO public.merchant_members(merchant_id,user_id,role) VALUES($1,$2,'owner')",
      [merchant, owner],
    );
  }
  const accounts = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  for (const [index, merchant, env, active] of [
    [0, m, "test", true],
    [1, m, "live", true],
    [2, other, "test", true],
    [3, m, "test", false],
  ])
    await db.query(
      `INSERT INTO public.provider_accounts(id,merchant_id,environment,provider,account_type,account_number_masked,account_number_encrypted,receiver_identity_hash,account_encryption_key_reference,is_active)
      VALUES($1,$2,$3,'bkash','merchant','synthetic only','synthetic ciphertext',$4,'fixture-only',$5)`,
      [accounts[index], merchant, env, "a".repeat(64), active],
    );
  const keys = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  for (const [index, merchant, env, scopes] of [
    [0, m, "test", ["payment_intents:create", "payment_intents:read"]],
    [1, m, "live", ["payment_intents:create", "payment_intents:read"]],
    [2, other, "test", ["payment_intents:create", "payment_intents:read"]],
    [3, m, "test", ["transactions:read"]],
  ])
    await db.query(
      "SELECT public.create_merchant_api_key($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        owner,
        merchant,
        keys[index],
        "Fixture",
        "ek_" + env + "_" + keys[index].replaceAll("-", "").slice(0, 16),
        keys[index].replaceAll("-", "").repeat(2),
        env,
        scopes,
      ],
    );
  const actor = await connect();
  await actor.query("SET ROLE service_role");
  const payload = {
    amount: 82000,
    currency: "BDT",
    reference: "ORDER-BASE",
    provider: "bkash",
    provider_account_id: accounts[0],
    metadata: { label: "fixture" },
  };
  const sql = "SELECT public.api_create_payment_intent($1,$2,$3::jsonb) v";
  async function create(c, k, idem, p) {
    return (await c.query(sql, [k, idem, JSON.stringify(p)])).rows[0].v;
  }
  async function reject(changes, code = "22023") {
    await denied(
      actor,
      sql,
      [
        keys[0],
        "invalid-request-123",
        JSON.stringify({
          ...payload,
          reference: "ref-" + randomUUID(),
          ...changes,
        }),
      ],
      code,
    );
  }
  const first = await create(actor, keys[0], "base-order-123", payload);
  assert.equal(first.intent.status, "created");
  assert.equal(first.intent.environment, "test");
  checks += 2;
  assert.equal(
    (await create(actor, keys[0], "base-order-123", payload)).intent.id,
    first.intent.id,
  );
  checks++;
  await denied(
    actor,
    sql,
    [keys[0], "base-order-123", JSON.stringify({ ...payload, amount: 83000 })],
    "EK409",
  );
  await denied(
    actor,
    sql,
    [keys[0], "new-reference-key", JSON.stringify(payload)],
    "23505",
  );
  for (const changes of [
    { amount: 0 },
    { amount: -1 },
    { amount: 1.5 },
    { amount: 100000001 },
    { currency: "USD" },
    { currency: null },
    { provider: "other" },
    { provider: null },
    { merchant_id: other },
    { environment: "live" },
    { status: "verified" },
    { verified_at: new Date().toISOString() },
    { actor_id: owner },
    { metadata: { x: "x".repeat(4100) } },
    { expires_at: "2000-01-01T00:00:00Z" },
    { expires_at: new Date(Date.now() + 25 * 3600000).toISOString() },
  ])
    await reject(changes);
  for (const account of accounts.slice(1))
    await reject({ provider_account_id: account }, "EK422");
  await reject({ provider: "nagad" }, "EK422");
  await denied(
    actor,
    sql,
    [keys[3], "no-scope-key", JSON.stringify(payload)],
    "EK403",
  );
  const live = await create(actor, keys[1], "base-order-123", {
    ...payload,
    provider_account_id: accounts[1],
  });
  assert.equal(live.intent.environment, "live");
  checks++;
  for (const [key, id] of [
    [keys[0], live.intent.id],
    [keys[1], first.intent.id],
    [keys[2], first.intent.id],
    [keys[0], "pi_" + "0".repeat(32)],
  ]) {
    assert.equal(
      (
        await actor.query("SELECT public.api_read_payment_intent($1,$2) v", [
          key,
          id,
        ])
      ).rows[0].v,
      null,
    );
    checks++;
  }
  const read = (
    await actor.query("SELECT public.api_read_payment_intent($1,$2) v", [
      keys[0],
      first.intent.id,
    ])
  ).rows[0].v;
  assert.equal(read.id, first.intent.id);
  assert.ok(!("secret_hash" in read));
  assert.ok(!("provider_account_id" in read));
  checks += 3;
  for (const table of ["events", "audit_logs"])
    await scalar(
      `SELECT count(*)::int v FROM public.${table} WHERE ${table === "events" ? "object_id" : "target_id"}=(SELECT id FROM public.payment_intents WHERE public_id=$1)`,
      [first.intent.id],
      1,
    );
  await scalar(
    "SELECT count(*)::int v FROM public.api_idempotency_keys WHERE merchant_id=$1 AND environment='test'",
    [m],
    1,
  );
  await scalar(
    "SELECT bool_and(NOT(payload ? 'metadata') AND NOT(payload ? 'secret_hash')) v FROM public.events",
    [],
    true,
  );
  await db.query(`CREATE FUNCTION public.fail_fixture_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='payment_intent.created' THEN RAISE EXCEPTION 'fixture' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fixture_audit_failure BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.fail_fixture_audit();`);
  await denied(
    actor,
    sql,
    [
      keys[0],
      "audit-failure-123",
      JSON.stringify({ ...payload, reference: "audit-failure" }),
    ],
    "23514",
  );
  await scalar(
    "SELECT count(*)::int v FROM public.payment_intents WHERE merchant_reference='audit-failure'",
    [],
    0,
  );
  await scalar(
    "SELECT count(*)::int v FROM public.api_idempotency_keys WHERE key_hash=encode(sha256(convert_to('audit-failure-123','UTF8')),'hex')",
    [],
    0,
  );
  await db.query("DROP TRIGGER fixture_audit_failure ON public.audit_logs");
  await db.query(
    "UPDATE public.payment_intents SET created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE public_id=$1",
    [first.intent.id],
  );
  assert.equal(
    (await create(actor, keys[0], "base-order-123", payload)).intent.status,
    "expired",
  );
  checks++;
  const browser = await connect();
  await browser.query("SET ROLE authenticated");
  await browser.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [
    owner,
  ]);
  await denied(
    browser,
    sql,
    [keys[0], "direct-key-123", JSON.stringify(payload)],
    "42501",
  );
  await denied(
    browser,
    "UPDATE public.payment_intents SET status='verified'",
    [],
    "42501",
  );
  for (const table of [
    "payment_evidence",
    "transactions",
    "api_idempotency_keys",
  ])
    await denied(
      browser,
      `INSERT INTO public.${table} DEFAULT VALUES`,
      [],
      "42501",
    );
  await denied(actor, "TRUNCATE public.api_idempotency_keys", [], "42501");
  await denied(
    actor,
    "UPDATE public.payment_intents SET status='verified',verified_at=now() WHERE public_id=$1",
    [live.intent.id],
    "23514",
  );
  await denied(
    actor,
    "UPDATE public.payment_intents SET environment='live' WHERE public_id=$1",
    [first.intent.id],
    "23514",
  );
  await db.query("UPDATE public.merchants SET status='suspended' WHERE id=$1", [
    m,
  ]);
  await denied(
    actor,
    "SELECT public.api_read_payment_intent($1,$2)",
    [keys[0], first.intent.id],
    "EK401",
  );
  await db.query("UPDATE public.merchants SET status='active' WHERE id=$1", [
    m,
  ]);
  const a = await connect(),
    b = await connect();
  for (const c of [a, b]) await c.query("SET ROLE service_role");
  for (const isolation of [
    "READ COMMITTED",
    "REPEATABLE READ",
    "SERIALIZABLE",
  ]) {
    for (const scenario of ["same", "conflict", "rollback"]) {
      const suffix = randomUUID(),
        idem = "concurrent-" + suffix,
        p = { ...payload, reference: "ref-" + suffix };
      await a.query("BEGIN ISOLATION LEVEL " + isolation);
      await b.query("BEGIN ISOLATION LEVEL " + isolation);
      for (const c of [a, b])
        await c.query("SELECT count(*) FROM public.payment_intents");
      const x = await create(a, keys[0], idem, p);
      const pending = create(
        b,
        keys[0],
        idem,
        scenario === "conflict" ? { ...p, amount: 82001 } : p,
      ).then(
        (v) => ({ v }),
        (e) => ({ e }),
      );
      const deadline = Date.now() + 5000;
      while (
        !(
          await db.query(
            "SELECT $1::int=ANY(pg_blocking_pids($2::int)) blocked",
            [a.processID, b.processID],
          )
        ).rows[0].blocked
      ) {
        assert.ok(Date.now() < deadline);
        await new Promise((r) => setTimeout(r, 20));
      }
      await a.query(scenario === "rollback" ? "ROLLBACK" : "COMMIT");
      const second = await pending;
      await b.query(second.e ? "ROLLBACK" : "COMMIT");
      if (scenario === "rollback") assert.ok(second.v && !second.v.reused);
      else if (isolation === "READ COMMITTED" && scenario === "same") {
        assert.ok(second.v.reused);
        assert.equal(second.v.intent.id, x.intent.id);
      } else
        assert.equal(
          second.e.code,
          isolation === "READ COMMITTED" ? "EK409" : "40001",
        );
      if (scenario === "conflict")
        await denied(
          actor,
          sql,
          [keys[0], idem, JSON.stringify({ ...p, amount: 82001 })],
          "EK409",
        );
      else assert.ok((await create(actor, keys[0], idem, p)).reused);
      await scalar(
        "SELECT count(*)::int v FROM public.payment_intents WHERE merchant_reference=$1",
        [p.reference],
        1,
      );
      checks++;
    }
    console.log(
      `PASS: ${isolation} concurrent idempotency same/conflict/rollback; one intent, deterministic retry.`,
    );
  }
  await testApiHandlers({ actor, owner, merchant: m, account: accounts[0] });
  await actor.query("SELECT public.revoke_merchant_api_key($1,$2,$3)", [
    owner,
    m,
    keys[0],
  ]);
  await denied(
    actor,
    "SELECT public.api_read_payment_intent($1,$2)",
    [keys[0], first.intent.id],
    "EK401",
  );
  await scalar(
    "SELECT count(*)::int v FROM pg_proc WHERE proname IN ('api_create_payment_intent','api_read_payment_intent') AND prosecdef AND proconfig=ARRAY['search_path=\"\"']",
    [],
    2,
  );
  console.log(
    `PASS: Phase 3 native PostgreSQL migrations and ${checks} security/invariant checks.`,
  );
});
