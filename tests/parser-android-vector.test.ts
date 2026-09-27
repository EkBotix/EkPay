import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parserCanonical,paths,ed25519Verify} from '../lib/parser/protocol';
import {evidenceMessageHash} from '../lib/parser/handler';
import {sha256} from '../lib/ingestion/protocol';
test('public Node/Kotlin parser vector matches current Phase 6 raw bytes and signature',()=>{
  const v=JSON.parse(readFileSync('docs/android/parser-v1-vector.json','utf8'));
  const raw=Buffer.from(v.raw_body),message=evidenceMessageHash(JSON.parse(v.raw_body));
  const h={protocol:'1' as const,device_id:'11111111-1111-4111-8111-111111111111',key_version:1,timestamp:1790550000000,nonce:'AAAAAAAAAAAAAAAAAAAAAA',ingestion_id:'22222222-2222-4222-8222-222222222222',message_hash:message,signature:v.signature_hex};
  const bytes=parserCanonical(h,paths.evidence,raw);
  assert.equal(bytes.toString(),v.canonical);assert.equal(sha256(raw),v.body_sha256);assert.equal(message,v.message_hash);
  assert.ok(ed25519Verify(Buffer.from(v.public_key_hex,'hex'),bytes,v.signature_hex));
});
