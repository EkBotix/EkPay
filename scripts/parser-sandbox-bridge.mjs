// Explicit local disposable transport. Never import into Next routes or use hosted credentials.
import {createServer} from 'node:https';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {withPostgres} from './testing/postgres.mjs';
import {createParserHandler} from '../lib/parser/handler.ts';
import {pairSyntheticParser} from '../lib/parser/pairing.ts';

export async function withParserSandbox(run){
  Object.assign(process.env,{NODE_ENV:'test',EKPAY_PARSER_INGESTION_ENABLED:'true'});
  const dir=await mkdtemp(join(tmpdir(),'ekpay-parser-tls-'));
  try{
    const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl';
    await promisify(execFile)(openssl,['req','-x509','-newkey','rsa:2048','-sha256','-nodes','-keyout',join(dir,'tls.key'),'-out',join(dir,'tls.crt'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1,IP:10.0.2.2','-addext','basicConstraints=critical,CA:TRUE'],{windowsHide:true});
    await withPostgres(async({db,connect})=>{
      await db.query('UPDATE ekpay_private.parser_policy SET enabled=true; UPDATE ekpay_private.ingestion_policy SET enabled=true');
      const service=await connect();await service.query('SET ROLE service_role');
      const operator=await connect();await operator.query('SET ROLE authenticated');
      const fixtures=new Map();
      const store={
        async source(id){return (await service.query('SELECT * FROM public.parser_devices WHERE public_id=$1',[id])).rows[0]??null;},
        async evidence(h,key,body,fields){return (await service.query('SELECT public.ingest_synthetic_evidence($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) v',[h.device_id,h.key_version,key,new Date(h.timestamp).toISOString(),h.nonce,h.ingestion_id,h.message_hash,body,JSON.stringify(fields)])).rows[0].v;},
        async heartbeat(h,key,body,fields){return (await service.query('SELECT public.parser_heartbeat($1,$2,$3,$4,$5,$6,$7,$8::jsonb) v',[h.device_id,h.key_version,key,new Date(h.timestamp).toISOString(),h.nonce,h.ingestion_id,body,JSON.stringify(fields)])).rows[0].v;},
      };
      // One local client query at a time; explicit fixture actor set immediately before RPC.
      let serial=Promise.resolve();
      const server=createServer({key:await readFile(join(dir,'tls.key')),cert:await readFile(join(dir,'tls.crt'))},(req,res)=>{
        serial=serial.then(async()=>{
          try{
            if(!['127.0.0.1','::ffff:127.0.0.1','::1'].includes(req.socket.remoteAddress))throw Error('not_local');
            const origin=req.headers.origin;if(origin && !/^https:\/\/(localhost|127\.0\.0\.1):[0-9]+$/.test(origin))throw Error('invalid_origin');
            const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>4096)throw Error('too_large');chunks.push(chunk);}const raw=Buffer.concat(chunks);
            const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
            if(req.method==='GET'&&req.url==='/'){
              res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'"});
              res.end('<h1>TEST ONLY · Disposable EkPay sandbox</h1><p>No production connection. Pairing token is displayed once; reload cannot recover it.</p><button id="create">Create synthetic registration</button><pre id="result"></pre><script>document.getElementById("create").onclick=async()=>{document.getElementById("create").disabled=true;const r=await fetch("/sandbox/test/register",{method:"POST"});document.getElementById("result").textContent=JSON.stringify(await r.json(),null,2);};</script>');return;
            }
            if(req.method!=='POST'){reply(405,{error:'invalid_request'});return;}
            if(req.url==='/sandbox/test/register'){
              const m=randomUUID(),u=randomUUID(),a=randomUUID();await db.query('INSERT INTO auth.users(id,email_confirmed_at) VALUES($1,now())',[u]);
              await db.query("INSERT INTO public.merchants(id,name,slug) VALUES($1,'Synthetic Android',$2)",[m,'android-'+m]);
              await db.query("INSERT INTO public.merchant_members(merchant_id,user_id,role) VALUES($1,$2,'owner')",[m,u]);
              await db.query(`INSERT INTO public.provider_accounts(id,merchant_id,environment,provider,account_type,account_number_masked,account_number_encrypted,receiver_identity_hash,account_encryption_key_reference) VALUES($1,$2,'test','bkash','merchant','synthetic only','fixture ciphertext',$3,'fixture-only')`,[a,m,'a'.repeat(64)]);
              await operator.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[u]);const d=(await operator.query("SELECT public.register_parser_device($1,$2,'Synthetic Android') v",[m,a])).rows[0].v;
              fixtures.set(d.device_id,{u,m,a});reply(200,d);return;
            }
            if(req.url==='/sandbox/test/revoke'||req.url==='/sandbox/test/rotation'){
              const input=JSON.parse(raw),f=fixtures.get(input.device_id);if(!f)throw Error('unknown_fixture');await operator.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[f.u]);
              const q=req.url.endsWith('/revoke')?'SELECT public.revoke_parser_device($1) v':'SELECT public.issue_parser_pairing($1,$2) v';
              reply(200,(await operator.query(q,req.url.endsWith('/revoke')?[input.device_id]:[input.device_id,input.expected_version])).rows[0].v);return;
            }
            if(req.url==='/sandbox/parser/pair'){
              const value=await pairSyntheticParser(JSON.parse(raw),async(d,h,k,v)=>(await service.query('SELECT public.consume_parser_pairing($1,$2,$3,$4) v',[d,h,Buffer.from(k),v])).rows[0].v);
              const source=await store.source(value.device_id);reply(200,{...value,provider:source.provider,provider_account_display:'synthetic only'});return;
            }
            if(req.url==='/api/internal/parser/evidence'||req.url==='/api/internal/parser/heartbeat'){
              if(req.url.endsWith('/evidence')&&!/^TEST_[A-Z0-9_-]{1,100}$/.test(JSON.parse(raw).provider_transaction_id??'')){reply(400,{error:'invalid_request'});return;}
              const kind=req.url.endsWith('/evidence')?'evidence':'heartbeat';const request=new Request('https://localhost'+req.url,{method:'POST',headers:req.headers,body:raw});
              const result=await createParserHandler(kind,()=>store)(request);res.writeHead(result.status,Object.fromEntries(result.headers));res.end(await result.text());return;
            }
            reply(404,{error:'not_available'});
          }catch(error){res.writeHead(400,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:error.code==='42501'?'invalid_pairing':error.code==='23505'?'pairing_conflict':'invalid_request'}));}
        }).catch(()=>{});
      });
      await new Promise(r=>server.listen(0,'127.0.0.1',r));
      const url='https://localhost:'+server.address().port;
      try{await run({url,certificate:join(dir,'tls.crt'),db});}finally{await new Promise(r=>server.close(r));await serial;}
    });
  }finally{const target=resolve(dir);assert.ok(target.startsWith(resolve(tmpdir())+sep)&&target.split(sep).at(-1).startsWith('ekpay-parser-tls-'));await rm(target,{recursive:true,force:true});}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  await withParserSandbox(async({url,certificate})=>{
    console.log('Disposable synthetic HTTPS bridge:',url);console.log('Temporary public CA certificate (install only in debug emulator):',certificate);
    console.log('Open URL locally to display a new one-time registration. No tokens/keys logged. Ctrl+C stops and destroys fixtures.');
    await new Promise(r=>{process.once('SIGINT',r);process.once('SIGTERM',r);});
  });
}
