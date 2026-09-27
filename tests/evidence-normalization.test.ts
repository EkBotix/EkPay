import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { normalizeSyntheticEvidence } from "../lib/verification/evidence";

test("synthetic evidence normalization is explicit, bounded and production-disabled", () => {
  const previous = process.env.NODE_ENV;
  const fixture = {
    merchant_id: randomUUID(), environment: "test", source: "provider_api", provider: "bkash",
    provider_account_id: randomUUID(), provider_transaction_id: " fixture_ref ", amount_minor: 100,
    currency: "BDT", receiver_identity_hash: "a".repeat(64), sender_identity_hash: null,
    provider_timestamp: "2026-09-27T18:00:00+06:00", ingestion_id: randomUUID(), message_hash: "b".repeat(64),
  };
  try {
    Object.assign(process.env, { NODE_ENV: "production" });
    assert.throws(() => normalizeSyntheticEvidence(fixture), /test-only/);
    Object.assign(process.env, { NODE_ENV: "test" });
    const value = normalizeSyntheticEvidence(fixture);
    assert.equal(value.provider_transaction_id, "FIXTURE_REF");
    assert.equal(value.provider_timestamp, "2026-09-27T12:00:00.000Z");
    assert.equal(value.trust_state, "synthetic");
    for (const changes of [{environment: undefined}, {environment: "live"}, {amount_minor: 1.1},
      {provider: "unknown"}, {provider_timestamp: "yesterday"}, {raw_sms: "forbidden"},
      {trust_state: "synthetic"}, {receiver_identity_hash: "plaintext"}, {metadata: {secret: "forbidden"}}]) {
      assert.throws(() => normalizeSyntheticEvidence({...fixture, ...changes}));
    }
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Object.assign(process.env, { NODE_ENV: previous });
  }
});
