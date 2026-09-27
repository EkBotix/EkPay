import { test } from "node:test";
import assert from "node:assert/strict";
import { generateApiKey } from "../lib/security/api-key";
import {
  parseBearer,
  verifyCandidate,
  type KeyCandidate,
} from "../lib/api/auth";
import {
  ApiError,
  apiFailure,
  intentRequestSchema,
  idempotencySchema,
} from "../lib/api/contract";
import { readJson } from "../lib/api/body";
import { createIntent, readIntent } from "../lib/api/payment-intents";
const pepper = "synthetic-fixture-pepper-not-production";
const material = generateApiKey("test", pepper);
const candidate: KeyCandidate = {
  id: material.id,
  merchant_id: "00000000-0000-4000-8000-000000000001",
  prefix: material.prefix,
  secret_hash: material.hash,
  hash_version: 1,
  environment: "test",
  abilities: ["payment_intents:create", "payment_intents:read"],
  status: "active",
  expires_at: null,
};
const parsed = parseBearer("Bearer " + material.secret);
test("Bearer auth rejects absent, malformed, wrong, revoked, expired, wrong environment and suspended credentials", () => {
  for (const value of [
    null,
    "",
    "Bearer ek_test_REPLACE_ME",
    "Basic abc",
    material.secret,
    "Bearer " + material.secret + ",x",
  ])
    assert.throws(() => parseBearer(value));
  for (const key of [
    null,
    { ...candidate, status: "revoked" },
    { ...candidate, expires_at: "2000-01-01T00:00:00Z" },
    { ...candidate, expires_at: "invalid" },
    { ...candidate, environment: "live" },
    { ...candidate, hash_version: 2 },
    { ...candidate, secret_hash: "f".repeat(64) },
  ])
    assert.throws(
      () =>
        verifyCandidate(parsed, key, "active", pepper, "payment_intents:read"),
      (e) => e instanceof ApiError && e.status === 401,
    );
  assert.throws(() =>
    verifyCandidate(
      parsed,
      candidate,
      "suspended",
      pepper,
      "payment_intents:read",
    ),
  );
  assert.throws(() =>
    verifyCandidate(parsed, candidate, "active", "", "payment_intents:read"),
  );
  assert.throws(
    () =>
      verifyCandidate(
        parsed,
        { ...candidate, abilities: [] },
        "active",
        pepper,
        "payment_intents:read",
      ),
    (e) => e instanceof ApiError && e.status === 403,
  );
  assert.equal(
    verifyCandidate(parsed, candidate, "active", pepper, "payment_intents:read")
      .environment,
    "test",
  );
  const live = generateApiKey("live", pepper);
  assert.equal(
    verifyCandidate(
      parseBearer("Bearer " + live.secret),
      {
        ...candidate,
        prefix: live.prefix,
        secret_hash: live.hash,
        environment: "live",
      },
      "active",
      pepper,
      "payment_intents:read",
    ).environment,
    "live",
  );
});
const body = {
  amount: 82000,
  currency: "BDT",
  reference: "ORDER-123",
  provider: "bkash",
  provider_account_id: candidate.merchant_id,
  metadata: {},
};
test("strict bounded request contract rejects client tenant/state, floats, invalid money/provider/currency and metadata", () => {
  assert.ok(intentRequestSchema.safeParse(body).success);
  for (const amount of [0, -1, 0.1, 100000001, Infinity])
    assert.ok(!intentRequestSchema.safeParse({ ...body, amount }).success);
  for (const change of [
    { currency: "USD" },
    { provider: "unknown" },
    { metadata: { large: "x".repeat(4097) } },
    { provider_account_id: "invalid" },
    { expires_at: "tomorrow" },
  ])
    assert.ok(!intentRequestSchema.safeParse({ ...body, ...change }).success);
  for (const field of [
    "merchant_id",
    "environment",
    "status",
    "verified",
    "verified_at",
    "created_by",
    "actor_id",
    "transaction_id",
    "verification_source",
  ])
    assert.ok(
      !intentRequestSchema.safeParse({ ...body, [field]: "forged" }).success,
    );
  for (const key of ["short", "x".repeat(129), "order/12345", ""])
    assert.ok(!idempotencySchema.safeParse(key).success);
});
test("streamed bodies enforce actual bytes and JSON media type without exposing request contents", async () => {
  const req = (value: string, type = "application/json") =>
    new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": type },
      body: value,
    });
  assert.deepEqual(await readJson(req(JSON.stringify(body))), body);
  await assert.rejects(
    readJson(req("x".repeat(8193))),
    (e) => e instanceof ApiError && e.status === 413,
  );
  await assert.rejects(
    readJson(req("secret malformed")),
    (e) => e instanceof ApiError && e.status === 400,
  );
  await assert.rejects(
    readJson(req("{}", "text/plain")),
    (e) => e instanceof ApiError && e.status === 415,
  );
  const response = apiFailure(new Error(material.secret));
  assert.ok(!(await response.text()).includes(material.secret));
  assert.equal(response.headers.get("cache-control"), "no-store");
});
test("actual handlers fail closed and ignore query/cookie credentials", async () => {
  const old = process.env.EKPAY_DEVELOPMENT_API_ENABLED;
  try {
    process.env.EKPAY_DEVELOPMENT_API_ENABLED = "false";
    assert.equal(
      (
        await createIntent(
          new Request("http://localhost/api", { method: "POST" }),
        )
      ).status,
      503,
    );
    process.env.EKPAY_DEVELOPMENT_API_ENABLED = "true";
    const req = new Request("http://localhost/api?api_key=" + material.secret, {
      headers: { cookie: "api_key=" + material.secret },
    });
    const response = await readIntent(req, "pi_" + "a".repeat(32));
    assert.equal(response.status, 401);
    assert.ok(!(await response.text()).includes(material.secret));
  } finally {
    if (old === undefined) delete process.env.EKPAY_DEVELOPMENT_API_ENABLED;
    else process.env.EKPAY_DEVELOPMENT_API_ENABLED = old;
  }
});
