import assert from 'node:assert/strict';
import test from 'node:test';
import {generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {sha256} from '../lib/ingestion/protocol';
import {parserCanonical,parserHeaderSchema,decodeParserPublicKey,ed25519Verify,paths} from '../lib/parser/protocol';
import {pairingCanonical,pairSyntheticParser} from '../lib/parser/pairing';
import {POST as evidencePOST} from '../app/api/internal/parser/evidence/route';
import {POST as heartbeatPOST} from '../app/api/internal/parser/heartbeat/route';
test('parser canonical bytes bind method/path/raw body, with LF and no trailing newline',()=>{
  const h=parserHeaderSchema.parse({protocol:'1',device_id:randomUUID(),key_version:'1',timestamp:'1790550000000',nonce:randomBytes(16).toString('base64url'),ingestion_id:randomUUID(),message_hash:sha256('normalized'),signature:'0'.repeat(128)}),raw=Buffer.from('{ "synthetic": true }');
  assert.equal(parserCanonical(h,paths.evidence,raw).toString(),['ekpay-parser-v1','POST',paths.evidence,h.device_id,'1','1790550000000',h.nonce,h.ingestion_id,h.message_hash,sha256(raw)].join('\n'));
  const k=generateKeyPairSync('ed25519'),key=k.publicKey.export({type:'spki',format:'der'}).subarray(-32),signature=sign(null,parserCanonical(h,paths.evidence,raw),k.privateKey).toString('hex');
  assert.equal(ed25519Verify(key,parserCanonical(h,paths.evidence,raw),signature),true);
  assert.equal(ed25519Verify(key,parserCanonical(h,paths.heartbeat,raw),signature),false);
  assert.equal(ed25519Verify(key,parserCanonical(h,paths.evidence,Buffer.from('{"synthetic":true}')),signature),false);
});
test('canonical public keys reject alternate encodings and degenerate keys',()=>{
  const raw=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).subarray(-32);
  assert.deepEqual(decodeParserPublicKey(raw.toString('base64url')),raw);
  for(const v of [raw.toString('base64url')+'=',Buffer.alloc(32).toString('base64url'),Buffer.alloc(32,255).toString('base64url'),'PEM'])assert.throws(()=>decodeParserPublicKey(v));
});
test('pairing proof binds device, expected version, token hash and new key',async()=>{
  Object.assign(process.env,{NODE_ENV:'test',EKPAY_PARSER_INGESTION_ENABLED:'true'});
  const k=generateKeyPairSync('ed25519'),key=k.publicKey.export({type:'spki',format:'der'}).subarray(-32),token=sha256('synthetic-fixture'),id=randomUUID();
  const p={device_id:id,expected_version:0,pairing_token:token,public_key:key.toString('base64url'),proof_signature:sign(null,pairingCanonical(id,0,sha256(token),key),k.privateKey).toString('hex')};
  let calls=0;const consume=async()=>{calls++;return true;};
  assert.equal(await pairSyntheticParser(p,consume),true);
  for(const changes of [{device_id:randomUUID()},{expected_version:1},{pairing_token:sha256('other')}])await assert.rejects(pairSyntheticParser({...p,...changes},consume));
  assert.equal(calls,1);
});
test('actual exported parser routes fail closed before credentials, including production with flag true',async()=>{
  for(const [env,flag] of [['production','true'],['production','false'],['test','false'],['development','true']]){
    Object.assign(process.env,{NODE_ENV:env,EKPAY_PARSER_INGESTION_ENABLED:flag});
    for(const post of [evidencePOST,heartbeatPOST]){const response=await post(new Request('http://localhost',{method:'POST'}));assert.equal(response.status,404);assert.deepEqual(await response.json(),{error:'not_available'});}
  }
});
