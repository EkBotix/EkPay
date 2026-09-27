import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, randomUUID } from "node:crypto";
import { canonicalSignedMessage, signatureIsValid, sha256 } from "../lib/ingestion/protocol";
import { SyntheticEvidenceAdapter } from "../lib/ingestion/adapter";
test("Ed25519 binds every fixed field and exact raw bytes; normalization preserves reference case", () => {
  const {privateKey,publicKey}=generateKeyPairSync("ed25519");
  const key=publicKey.export({format:"der",type:"spki"}).subarray(-32);
  const body=Buffer.from(JSON.stringify({provider:"bkash",provider_transaction_id:" FIXTURE_ID ",amount_minor:100,currency:"bdt",
    receiver_identity_hash:"a".repeat(64),sender_identity_hash:null,provider_timestamp:"2026-09-28T01:00:00+06:00"}));
  const request={source_public_id:randomUUID(),key_version:1,timestamp_ms:Date.now(),nonce:randomUUID(),ingestion_id:randomUUID(),message_hash:sha256("synthetic observation"),signature:"0".repeat(128)};
  request.signature=sign(null,canonicalSignedMessage(request,body),privateKey).toString("hex");
  assert.equal(signatureIsValid(request,body,key),true);
  for(const delta of [{nonce:randomUUID()},{ingestion_id:randomUUID()},{source_public_id:randomUUID()},{key_version:2},{timestamp_ms:request.timestamp_ms+1},{message_hash:"b".repeat(64)}])
    assert.equal(signatureIsValid({...request,...delta},body,key),false);
  assert.equal(signatureIsValid(request,Buffer.concat([body,Buffer.from(" ")]),key),false);
  assert.equal(signatureIsValid(request,body,Buffer.alloc(32)),false);
  const normalized=SyntheticEvidenceAdapter.normalize(body);
  assert.equal(normalized.provider_transaction_id,"FIXTURE_ID");
  assert.equal(normalized.currency,"BDT");
  assert.equal(normalized.provider_timestamp,"2026-09-27T19:00:00.000Z");
  for(const changes of [{provider_transaction_id:"lowercase_ref"},{amount_minor:1.5},{currency:"USD"},{merchant_id:randomUUID()},{environment:"live"},{provider:"unknown"},{receiver_identity_hash:"plaintext"}])
    assert.throws(()=>SyntheticEvidenceAdapter.normalize(Buffer.from(JSON.stringify({...JSON.parse(body.toString()),...changes}))));
});
