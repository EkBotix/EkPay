// Public RFC 8032 fixture only. No deployment/device secret or generated private-key file.
import {createPrivateKey,createPublicKey,sign} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {parserCanonical,paths} from '../lib/parser/protocol.ts';
import {evidenceMessageHash} from '../lib/parser/handler.ts';
import {sha256} from '../lib/ingestion/protocol.ts';
const seed=Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60','hex');
const key=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]),type:'pkcs8',format:'der'});
const fields={provider:'bkash',provider_transaction_id:'TEST_VECTOR',amount_minor:82000,currency:'BDT',receiver_identity_hash:'a'.repeat(64),sender_identity_hash:null,provider_timestamp:'2026-09-28T00:00:00.000Z'};
const body=Buffer.from(JSON.stringify(fields)),h={protocol:'1',device_id:'11111111-1111-4111-8111-111111111111',key_version:1,timestamp:1790550000000,nonce:'AAAAAAAAAAAAAAAAAAAAAA',ingestion_id:'22222222-2222-4222-8222-222222222222',message_hash:evidenceMessageHash(fields),signature:'0'.repeat(128)};
const canonical=parserCanonical(h,paths.evidence,body);
const vector={description:'Public RFC 8032 test key, fixed synthetic data and fixed NON-RANDOM nonce for vectors only. Never enroll this key.',raw_body:body.toString(),body_sha256:sha256(body),message_hash:h.message_hash,canonical:canonical.toString(),public_key_hex:createPublicKey(key).export({type:'spki',format:'der'}).subarray(-32).toString('hex'),signature_hex:sign(null,canonical,key).toString('hex')};
for(const directory of ['docs/android','D:/ekpay-android-parser/core/src/test/resources']){await mkdir(directory,{recursive:true});await writeFile(directory+'/parser-v1-vector.json',JSON.stringify(vector,null,2)+'\n');}
console.log('Generated public synthetic Node↔Kotlin vector; no private key output');
