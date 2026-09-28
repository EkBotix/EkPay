import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { withPostgres } from "./testing/postgres.mjs";
import { generateApiKey } from "../lib/security/api-key.ts";
import { sha256 } from "../lib/ingestion/protocol.ts";
import {
  confirmTransaction,
  verifyTransaction,
} from "../lib/api/transactions.ts";

let checks = 0;
const eq = (actual, expected) => {
  assert.deepEqual(actual, expected);
  checks++;
};

await withPostgres(async ({ db, connect }) => {
  const service = await connect();
  await service.query("SET ROLE service_role");
  const merchant = randomUUID();
  const owner = randomUUID();
  await db.query(
    "INSERT INTO auth.users(id,email_confirmed_at) VALUES($1,clock_timestamp())",
    [owner],
  );
  await db.query(
    "INSERT INTO public.merchants(id,name,slug) VALUES($1,'Transaction API fixture',$2)",
    [merchant, `trx-${merchant}`],
  );
  await db.query(
    "INSERT INTO public.merchant_members(merchant_id,user_id,role) VALUES($1,$2,'owner')",
    [merchant, owner],
  );
  await db.query(
    "UPDATE ekpay_private.ingestion_policy SET enabled=true; UPDATE ekpay_private.verification_policy SET enabled=true",
  );

  async function account(provider, environment = "test") {
    const id = randomUUID();
    const receiver = sha256(`${merchant}:${environment}:${provider}:${id}`);
    await db.query(
      `INSERT INTO public.provider_accounts(id,merchant_id,environment,provider,account_type,
      account_number_masked,account_number_encrypted,receiver_identity_hash,account_encryption_key_reference)
      VALUES($1,$2,$3,$4,'merchant','synthetic','synthetic-placeholder',$5,'fixture-only')`,
      [id, merchant, environment, provider, receiver],
    );
    return { id, provider, environment, receiver };
  }
  async function source(a) {
    const id = randomUUID();
    const publicId = randomUUID();
    const publicKey = randomBytes(32);
    await db.query(
      `INSERT INTO public.parser_devices(id,public_id,merchant_id,environment,provider,provider_account_id,
      source_type,is_synthetic,signing_public_key,secret_key_version,status,paired_at,display_name)
      VALUES($1,$2,$3,$4,$5,$6,'provider_api',true,$7,1,'active',clock_timestamp(),'Transaction API fixture')`,
      [id, publicId, merchant, a.environment, a.provider, a.id, publicKey],
    );
    return { ...a, sourceId: id, publicId, publicKey };
  }
  async function evidence(
    s,
    reference,
    amount = 15000,
    providerTimestamp = new Date().toISOString(),
  ) {
    const fields = {
      provider: s.provider,
      provider_transaction_id: reference,
      amount_minor: amount,
      currency: "BDT",
      receiver_identity_hash: s.receiver,
      sender_identity_hash: null,
      provider_timestamp: providerTimestamp,
    };
    const body = Buffer.from(JSON.stringify(fields));
    const result = await service.query(
      "SELECT public.ingest_synthetic_evidence($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) v",
      [
        s.publicId,
        1,
        sha256(s.publicKey),
        new Date().toISOString(),
        randomBytes(16).toString("base64url"),
        randomUUID(),
        sha256(JSON.stringify(fields)),
        sha256(body),
        JSON.stringify(fields),
      ],
    );
    return result.rows[0].v.evidence_id;
  }
  async function apiKey(
    environment,
    name,
    merchantId = merchant,
    ownerId = owner,
  ) {
    const material = generateApiKey(
      environment,
      "synthetic-loopback-integration-pepper",
    );
    await db.query(
      "SELECT public.create_merchant_api_key($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        ownerId,
        merchantId,
        material.id,
        name,
        material.prefix,
        material.hash,
        environment,
        ["trx:verify", "trx:confirm"],
      ],
    );
    return material;
  }

  const bkash = await source(await account("bkash"));
  const nagad = await source(await account("nagad"));
  const rocket = await source(await account("rocket"));
  await evidence(bkash, "BKASH_FOUNDATION_1");
  await evidence(rocket, "ROCKET_DISABLED_1");
  await evidence(bkash, "AMBIGUOUS_1");
  await evidence(nagad, "AMBIGUOUS_1");
  await evidence(
    bkash,
    "FUTURE_1",
    15000,
    new Date(Date.now() + 60_000).toISOString(),
  );
  await db.query(
    `INSERT INTO public.payment_evidence(merchant_id,environment,provider_account_id,provider,source,
    provider_transaction_id,amount_minor,currency,receiver_identity_hash,provider_timestamp,ingestion_id,message_hash,trust_state)
    VALUES($1,'test',$2,'bkash','provider_api','UNTRUSTED_1',15000,'BDT',$3,clock_timestamp(),$4,$5,'untrusted')`,
    [
      merchant,
      bkash.id,
      bkash.receiver,
      randomUUID(),
      sha256("untrusted-fixture"),
    ],
  );
  const testKey = await apiKey("test", "Transaction API test key");
  const liveKey = await apiKey("live", "Transaction API live-denial key");
  const otherMerchant = randomUUID();
  const otherOwner = randomUUID();
  await db.query(
    "INSERT INTO auth.users(id,email_confirmed_at) VALUES($1,clock_timestamp())",
    [otherOwner],
  );
  await db.query(
    "INSERT INTO public.merchants(id,name,slug) VALUES($1,'Other fixture',$2)",
    [otherMerchant, `other-${otherMerchant}`],
  );
  await db.query(
    "INSERT INTO public.merchant_members(merchant_id,user_id,role) VALUES($1,$2,'owner')",
    [otherMerchant, otherOwner],
  );
  const otherKey = await apiKey(
    "test",
    "Other merchant key",
    otherMerchant,
    otherOwner,
  );

  const server = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    try {
      const url = new URL(request.url, "http://localhost");
      let result;
      if (url.pathname === "/rest/v1/api_keys") {
        result = (
          await db.query(
            "SELECT id,merchant_id,prefix,secret_hash,hash_version,environment,abilities,status,expires_at FROM public.api_keys WHERE prefix=$1",
            [url.searchParams.get("prefix").slice(3)],
          )
        ).rows;
      } else if (url.pathname === "/rest/v1/merchants") {
        result = (
          await db.query("SELECT status FROM public.merchants WHERE id=$1", [
            url.searchParams.get("id").slice(3),
          ])
        ).rows;
      } else {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const payload = JSON.parse(Buffer.concat(chunks).toString());
        if (url.pathname === "/rest/v1/rpc/api_verify_transaction") {
          result = (
            await service.query(
              "SELECT public.api_verify_transaction($1,$2,$3::jsonb) v",
              [
                payload.p_key_id,
                payload.p_idempotency_key,
                JSON.stringify(payload.p_payload),
              ],
            )
          ).rows[0].v;
        } else if (url.pathname === "/rest/v1/rpc/api_confirm_transaction") {
          result = (
            await service.query(
              "SELECT public.api_confirm_transaction($1,$2,$3) v",
              [
                payload.p_key_id,
                payload.p_idempotency_key,
                payload.p_verification_id,
              ],
            )
          ).rows[0].v;
        } else throw new Error("unsupported fixture endpoint");
      }
      response.end(JSON.stringify(result));
    } catch (error) {
      response.statusCode = 400;
      response.end(
        JSON.stringify({
          code: error.code ?? "fixture",
          message: "local fixture error",
        }),
      );
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const variables = [
    "EKPAY_DEVELOPMENT_API_ENABLED",
    "API_KEY_HASH_SECRET",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  const previous = Object.fromEntries(
    variables.map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, {
    EKPAY_DEVELOPMENT_API_ENABLED: "true",
    API_KEY_HASH_SECRET: "synthetic-loopback-integration-pepper",
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${server.address().port}`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-public-placeholder",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-server-placeholder",
  });

  const headers = (material, idempotency) => ({
    authorization: `Bearer ${material.secret}`,
    "content-type": "application/json",
    "idempotency-key": idempotency,
  });
  const verifyRequest = (body, idempotency, material = testKey) =>
    new Request("http://localhost/v1/trx/verify", {
      method: "POST",
      headers: headers(material, idempotency),
      body: JSON.stringify(body),
    });
  const confirmRequest = (verificationId, idempotency, material = testKey) =>
    new Request("http://localhost/v1/trx/confirm", {
      method: "POST",
      headers: headers(material, idempotency),
      body: JSON.stringify({ verification_id: verificationId }),
    });

  try {
    const verifyBody = { transaction_id: "bkash_foundation_1", amount: 15000 };
    const firstResponse = await verifyTransaction(
      verifyRequest(verifyBody, "verify-foundation-0001"),
    );
    eq(firstResponse.status, 200);
    const first = await firstResponse.json();
    eq(first.success, true);
    eq(first.data.transaction_id, "BKASH_FOUNDATION_1");
    eq(first.data.provider, "bkash");
    eq(first.data.amount, 15000);
    eq(first.data.status, "UNUSED");
    assert.match(first.data.verification_id, /^vr_[a-f0-9]{32}$/);
    checks++;
    const serialized = JSON.stringify(first);
    for (const privateField of [
      "sender_identity_hash",
      "receiver_identity_hash",
      "raw_sms",
      "source_device_id",
    ])
      eq(serialized.includes(privateField), false);

    const replay = await verifyTransaction(
      verifyRequest(verifyBody, "verify-foundation-0001"),
    );
    eq(replay.status, 200);
    const replayBody = await replay.json();
    eq(replayBody.data.verification_id, first.data.verification_id);
    eq(replayBody.data.expires_at, first.data.expires_at);
    eq(
      (
        await db.query(
          "SELECT expires_at-created_at=interval '5 minutes' v FROM public.transaction_verifications WHERE public_id=$1",
          [first.data.verification_id],
        )
      ).rows[0].v,
      true,
    );
    eq(
      Number(
        (
          await db.query(
            "SELECT count(*) n FROM public.transaction_verifications WHERE provider_transaction_id=$1",
            [verifyBody.transaction_id.toUpperCase()],
          )
        ).rows[0].n,
      ),
      1,
    );
    const conflict = await verifyTransaction(
      verifyRequest({ ...verifyBody, amount: 15001 }, "verify-foundation-0001"),
    );
    eq(conflict.status, 409);
    eq((await conflict.json()).error.code, "idempotency_conflict");

    const diffKeyConflict = await verifyTransaction(
      verifyRequest(verifyBody, "verify-foundation-diff-key"),
    );
    eq(diffKeyConflict.status, 422);
    eq((await diffKeyConflict.json()).error.code, "transaction_not_verifiable");

    for (const [body, key, expectedCode] of [
      [
        { transaction_id: "UNKNOWN_1", amount: 15000 },
        "verify-unknown-0001",
        "transaction_not_verifiable",
      ],
      [
        { transaction_id: "BKASH_FOUNDATION_1", amount: 15001 },
        "verify-wrong-amount-1",
        "transaction_not_verifiable",
      ],
      [
        { transaction_id: "AMBIGUOUS_1", amount: 15000 },
        "verify-ambiguous-01",
        "transaction_not_verifiable",
      ],
      [
        { transaction_id: "UNTRUSTED_1", amount: 15000 },
        "verify-untrusted-0001",
        "transaction_not_verifiable",
      ],
      [
        { transaction_id: "FUTURE_1", amount: 15000 },
        "verify-future-time-1",
        "transaction_not_verifiable",
      ],
      [
        {
          transaction_id: "ROCKET_DISABLED_1",
          amount: 15000,
          provider: "rocket",
        },
        "verify-rocket-00001",
        "provider_not_supported",
      ],
      [
        { transaction_id: "ANY_UPAY_ID", amount: 15000, provider: "upay" },
        "verify-upay-disabled",
        "provider_not_supported",
      ],
    ]) {
      const result = await verifyTransaction(verifyRequest(body, key));
      eq(result.status, 422);
      eq((await result.json()).error.code, expectedCode);
    }
    const live = await verifyTransaction(
      verifyRequest(verifyBody, "verify-live-denied-1", liveKey),
    );
    eq(live.status, 422);
    eq((await live.json()).error.code, "transaction_not_verifiable");
    const crossMerchant = await confirmTransaction(
      confirmRequest(
        first.data.verification_id,
        "cross-merchant-deny",
        otherKey,
      ),
    );
    eq(crossMerchant.status, 404);
    eq((await crossMerchant.json()).error.code, "verification_not_found");

    const confirmedResponse = await confirmTransaction(
      confirmRequest(first.data.verification_id, "confirm-foundation-1"),
    );
    eq(confirmedResponse.status, 200);
    const confirmed = await confirmedResponse.json();
    eq(confirmed.success, true);
    eq(confirmed.data.verification_id, first.data.verification_id);
    eq(confirmed.data.status, "CONSUMED");
    assert.ok(confirmed.data.consumed_at);
    checks++;
    const confirmReplay = await confirmTransaction(
      confirmRequest(first.data.verification_id, "confirm-foundation-1"),
    );
    eq(confirmReplay.status, 200);
    eq(
      (await confirmReplay.json()).data.consumed_at,
      confirmed.data.consumed_at,
    );
    const consumedLookup = await verifyTransaction(
      verifyRequest(verifyBody, "verify-consumed-0001"),
    );
    eq(consumedLookup.status, 422);
    eq((await consumedLookup.json()).error.code, "transaction_not_verifiable");
    eq(
      Number(
        (
          await db.query(
            "SELECT count(*) n FROM public.transactions WHERE transaction_kind='trx_api'",
          )
        ).rows[0].n,
      ),
      1,
    );
    eq(
      Number(
        (
          await db.query(
            "SELECT count(*) n FROM public.transaction_verifications WHERE status='consumed'",
          )
        ).rows[0].n,
      ),
      1,
    );
    await assert.rejects(
      db.query(
        "UPDATE public.transaction_verifications SET consumed_at=consumed_at+interval '1 second' WHERE public_id=$1",
        [first.data.verification_id],
      ),
      (error) => error.code === "23514",
    );
    checks++;

    await evidence(bkash, "EXPIRY_1");
    const expiring = await verifyTransaction(
      verifyRequest(
        { transaction_id: "EXPIRY_1", amount: 15000 },
        "verify-expiry-00001",
      ),
    );
    const expiringBody = await expiring.json();
    await db.query(
      "UPDATE public.transaction_verifications SET status='expired' WHERE public_id=$1",
      [expiringBody.data.verification_id],
    );
    const expired = await confirmTransaction(
      confirmRequest(expiringBody.data.verification_id, "confirm-expired-001"),
    );
    eq(expired.status, 409);
    eq((await expired.json()).error.code, "verification_expired");

    const concurrencyReference = "CONCURRENT_VERIFY_1";
    await evidence(bkash, concurrencyReference);
    const concurrentHttpReference = "CONCURRENT_VERIFY_HTTP_1";
    await evidence(bkash, concurrentHttpReference);
    const concurrentHttp = await Promise.all(
      Array.from({ length: 4 }).map((_, i) =>
        verifyTransaction(
          verifyRequest(
            { transaction_id: concurrentHttpReference, amount: 15000 },
            `concurrent-http-diff-key-${i}`,
          ),
        ),
      ),
    );
    const concurrentHttpResults = await Promise.all(
      concurrentHttp.map((r) => r.json()),
    );
    const successful = concurrentHttpResults.filter((r) => r.success === true);
    const failed = concurrentHttpResults.filter((r) => r.success === false);
    eq(successful.length, 1);
    eq(failed.length, 3);
    for (const f of failed) {
      eq(f.error.code, "transaction_not_verifiable");
    }
    eq(
      Number(
        (
          await db.query(
            "SELECT count(*) n FROM public.transaction_verifications WHERE provider_transaction_id=$1",
            [concurrentHttpReference],
          )
        ).rows[0].n,
      ),
      1,
    );
    checks++;

    const verifySql = "SELECT public.api_verify_transaction($1,$2,$3::jsonb) v";
    const clients = await Promise.all(
      Array.from({ length: 4 }, async () => {
        const client = await connect();
        await client.query("SET ROLE service_role");
        return client;
      }),
    );
    const concurrent = await Promise.all(
      clients.map((client) =>
        client.query(verifySql, [
          testKey.id,
          "concurrent-same-key",
          JSON.stringify({
            transaction_id: concurrencyReference,
            amount: 15000,
          }),
        ]),
      ),
    );
    eq(
      new Set(
        concurrent.map(
          (result) => result.rows[0].v.verification.verification_id,
        ),
      ).size,
      1,
    );
    const concurrentVerification =
      concurrent[0].rows[0].v.verification.verification_id;
    eq(
      Number(
        (
          await db.query(
            "SELECT count(*) n FROM public.transaction_verifications WHERE provider_transaction_id=$1",
            [concurrencyReference],
          )
        ).rows[0].n,
      ),
      1,
    );
    const confirmConflict = await confirmTransaction(
      confirmRequest(concurrentVerification, "confirm-foundation-1"),
    );
    eq(confirmConflict.status, 409);
    eq((await confirmConflict.json()).error.code, "idempotency_conflict");
    const confirmSql = "SELECT public.api_confirm_transaction($1,$2,$3) v";
    const confirmations = await Promise.all(
      clients.map((client, index) =>
        client.query(confirmSql, [
          testKey.id,
          `concurrent-confirm-${index}`,
          concurrentVerification,
        ]),
      ),
    );
    eq(
      new Set(
        confirmations.map(
          (result) => result.rows[0].v.verification.consumed_at,
        ),
      ).size,
      1,
    );
    eq(
      Number(
        (
          await db.query(
            "SELECT count(*) n FROM public.transactions WHERE provider_transaction_id=$1",
            [concurrencyReference],
          )
        ).rows[0].n,
      ),
      1,
    );

    for (const role of ["anon", "authenticated"]) {
      const client = await connect();
      await client.query(`SET ROLE ${role}`);
      await assert.rejects(
        client.query(verifySql, [
          testKey.id,
          "role-denial-key",
          JSON.stringify(verifyBody),
        ]),
        (error) => error.code === "42501",
      );
      checks++;
    }
    eq(
      (
        await db.query(
          "SELECT has_function_privilege('service_role','public.api_verify_transaction(uuid,text,jsonb)','EXECUTE') v",
        )
      ).rows[0].v,
      true,
    );
    eq(
      (
        await db.query(
          "SELECT has_function_privilege('authenticated','public.api_confirm_transaction(uuid,text,text)','EXECUTE') v",
        )
      ).rows[0].v,
      false,
    );
    eq(
      (
        await db.query(
          "SELECT has_function_privilege('anon','public.api_verify_transaction(uuid,text,jsonb)','EXECUTE') v",
        )
      ).rows[0].v,
      false,
    );
    eq(
      (
        await db.query(
          "SELECT has_table_privilege('service_role','public.transaction_verifications','INSERT,UPDATE,DELETE') v",
        )
      ).rows[0].v,
      false,
    );
    const rpcSecurity = (
      await db.query(`SELECT count(*)::int n,
      bool_and(p.prosecdef AND p.proconfig=ARRAY['search_path=""']
        AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
        AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
        AND has_function_privilege('service_role',p.oid,'EXECUTE')) v
      FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid=p.pronamespace
      WHERE nsp.nspname='public' AND p.proname IN ('api_verify_transaction','api_confirm_transaction')`)
    ).rows[0];
    eq(rpcSecurity.n, 2);
    eq(rpcSecurity.v, true);
    eq(
      (
        await db.query(
          "SELECT relrowsecurity v FROM pg_class WHERE oid='public.transaction_verifications'::regclass",
        )
      ).rows[0].v,
      true,
    );
    const leaked = JSON.stringify(
      (
        await db.query(
          "SELECT payload FROM public.events WHERE event_type LIKE 'transaction.%' UNION ALL SELECT metadata FROM public.audit_logs WHERE action LIKE 'transaction.%'",
        )
      ).rows,
    );
    for (const secret of [bkash.receiver, testKey.secret])
      eq(leaked.includes(secret), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    for (const name of variables) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }

  console.log(
    `PASS: TEST transaction verification API: ${checks} checks; HTTP, database, privilege and concurrency coverage.`,
  );
});
