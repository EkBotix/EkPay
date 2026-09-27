// Local PostgREST-shaped transport adapter over real PostgreSQL. This exercises
// production handlers + supabase-js HTTP calls; it is not a hosted PostgREST test.
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { generateApiKey } from "../../lib/security/api-key.ts";
import { createIntent, readIntent } from "../../lib/api/payment-intents.ts";
export async function testApiHandlers({ actor, owner, merchant, account }) {
  const pepper = "synthetic-loopback-integration-pepper";
  const material = generateApiKey("test", pepper);
  await actor.query(
    "SELECT public.create_merchant_api_key($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      owner,
      merchant,
      material.id,
      "HTTP fixture",
      material.prefix,
      material.hash,
      "test",
      ["payment_intents:create", "payment_intents:read"],
    ],
  );
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    try {
      const url = new URL(req.url, "http://localhost");
      let result;
      if (url.pathname === "/rest/v1/api_keys")
        result = (
          await actor.query(
            "SELECT id,merchant_id,prefix,secret_hash,hash_version,environment,abilities,status,expires_at FROM public.api_keys WHERE prefix=$1",
            [url.searchParams.get("prefix").slice(3)],
          )
        ).rows;
      else if (url.pathname === "/rest/v1/merchants")
        result = (
          await actor.query("SELECT status FROM public.merchants WHERE id=$1", [
            url.searchParams.get("id").slice(3),
          ])
        ).rows;
      else {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const p = JSON.parse(Buffer.concat(chunks).toString());
        if (url.pathname === "/rest/v1/rpc/api_create_payment_intent")
          result = (
            await actor.query(
              "SELECT public.api_create_payment_intent($1,$2,$3) v",
              [p.p_key_id, p.p_idempotency_key, JSON.stringify(p.p_payload)],
            )
          ).rows[0].v;
        else if (url.pathname === "/rest/v1/rpc/api_read_payment_intent")
          result = (
            await actor.query(
              "SELECT public.api_read_payment_intent($1,$2) v",
              [p.p_key_id, p.p_public_id],
            )
          ).rows[0].v;
        else throw new Error("unsupported local fixture endpoint");
      }
      res.end(JSON.stringify(result));
    } catch (e) {
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          code: e.code ?? "fixture",
          message: "local fixture error",
        }),
      );
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const names = [
    "EKPAY_DEVELOPMENT_API_ENABLED",
    "API_KEY_HASH_SECRET",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  const old = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  Object.assign(process.env, {
    EKPAY_DEVELOPMENT_API_ENABLED: "true",
    API_KEY_HASH_SECRET: pepper,
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${server.address().port}`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-public-placeholder",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-server-placeholder",
  });
  try {
    const headers = {
      authorization: "Bearer " + material.secret,
      "content-type": "application/json",
      "idempotency-key": "http-integration-123",
    };
    const payload = {
      amount: 82000,
      currency: "BDT",
      reference: "HTTP-INTEGRATION",
      provider: "bkash",
      provider_account_id: account,
      metadata: {},
    };
    const request = (p = payload, h = headers) =>
      new Request("http://localhost/api/v1/payment-intents", {
        method: "POST",
        headers: h,
        body: JSON.stringify(p),
      });
    const response = await createIntent(request());
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const first = await response.json();
    assert.ok(!JSON.stringify(first).includes(material.secret));
    assert.equal((await createIntent(request())).status, 200);
    assert.equal(
      (await createIntent(request({ ...payload, amount: 82001 }))).status,
      409,
    );
    assert.equal(
      (await createIntent(request({ ...payload, environment: "live" }))).status,
      400,
    );
    const read = await readIntent(
      new Request("http://localhost/api", { headers }),
      first.data.id,
    );
    assert.equal(read.status, 200);
    assert.equal((await read.json()).data.id, first.data.id);
    assert.equal(
      (
        await readIntent(
          new Request("http://localhost/api", {
            headers: {
              authorization: "Bearer " + generateApiKey("test", pepper).secret,
            },
          }),
          first.data.id,
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await readIntent(
          new Request("http://localhost/api", { headers }),
          "pi_" + "0".repeat(32),
        )
      ).status,
      404,
    );
    const row = (
      await actor.query("SELECT secret_hash FROM public.api_keys WHERE id=$1", [
        material.id,
      ])
    ).rows[0];
    assert.equal(row.secret_hash, material.hash);
    assert.notEqual(row.secret_hash, material.secret);
    console.log(
      "PASS: real handlers → supabase-js loopback transport → PostgreSQL: POST 201/replay 200/conflict 409, GET 200/404, auth 401, override 400, no secret response/storage.",
    );
  } finally {
    for (const n of names)
      if (old[n] === undefined) delete process.env[n];
      else process.env[n] = old[n];
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}
