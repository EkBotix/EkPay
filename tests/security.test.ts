import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { generateApiKey } from "../lib/security/api-key";
import {
  merchantSchema,
  keySchema,
  canManageKeys,
  uuidSchema,
  credentialsSchema,
  isConfirmedUser,
} from "../lib/validation";
test("verified-user policy rejects absent, anonymous and unconfirmed records", () => {
  assert.ok(!isConfirmedUser(null));
  assert.ok(
    !isConfirmedUser({ is_anonymous: true, email_confirmed_at: "test-date" }),
  );
  assert.ok(!isConfirmedUser({ is_anonymous: false }));
  assert.ok(
    isConfirmedUser({ is_anonymous: false, email_confirmed_at: "test-date" }),
  );
});
test("keys are generated with unpredictable material and only a hash is persistable", () => {
  const pepper = "synthetic-test-pepper-never-production";
  const a = generateApiKey("test", pepper),
    b = generateApiKey("test", pepper);
  assert.notEqual(a.secret, b.secret);
  assert.match(a.secret, /^ek_test_[a-f0-9]{16}_[A-Za-z0-9_-]{43}$/);
  assert.equal(
    a.hash,
    createHmac("sha256", pepper).update(a.secret).digest("hex"),
  );
  assert.notEqual(a.hash, a.secret);
  assert.ok(!a.prefix.includes(a.secret));
  assert.throws(() => generateApiKey("live", "short"));
});
test("unknown, repeated and empty abilities and extra properties are rejected", () => {
  const base = {
    merchantId: "00000000-0000-4000-8000-000000000001",
    name: "SDK",
    environment: "test",
    abilities: ["transactions:read"],
  };
  assert.ok(keySchema.safeParse(base).success);
  for (const abilities of [
    [],
    ["wallet:credit"],
    ["transactions:read", "transactions:read"],
  ])
    assert.ok(!keySchema.safeParse({ ...base, abilities }).success);
  assert.ok(
    !keySchema.safeParse({ ...base, secret: "caller-provided" }).success,
  );
  assert.ok(!keySchema.safeParse({ ...base, merchantId: "invalid" }).success);
  assert.ok(!keySchema.safeParse({ ...base, name: "x".repeat(81) }).success);
});
test("role policy and merchant normalization fail closed", () => {
  assert.ok(canManageKeys("owner"));
  assert.ok(canManageKeys("admin"));
  assert.ok(!canManageKeys("viewer"));
  assert.ok(!canManageKeys("developer"));
  assert.equal(
    merchantSchema.parse({ name: " Business ", slug: " My Business " }).slug,
    "my-business",
  );
  assert.ok(
    !merchantSchema.safeParse({ name: "Business", slug: "bad/slug" }).success,
  );
  assert.ok(
    !merchantSchema.safeParse({
      name: "Business",
      slug: "good-slug",
      user_id: "other",
    }).success,
  );
  assert.ok(!uuidSchema.safeParse("../../other").success);
  assert.ok(
    !credentialsSchema.safeParse({ email: "invalid", password: "short" })
      .success,
  );
});
