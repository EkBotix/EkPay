import {spawn} from 'node:child_process';
import {readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {withParserSandbox} from './parser-sandbox-bridge.mjs';
const android='D:/ekpay-android-parser';
await withParserSandbox(async({url,certificate,db})=>{
  const javaHome=process.env.JAVA_HOME??android+'/.tools/jdk/'+(await readdir(android+'/.tools/jdk'))[0];
  const executable=javaHome+'/bin/'+(process.platform==='win32'?'java.exe':'java');
  const args=['-cp',android+'/gradle/wrapper/gradle-wrapper.jar','org.gradle.wrapper.GradleWrapperMain',':core:test','--tests','*SandboxIntegrationTest','--rerun-tasks','--console=plain'];
  const child=spawn(executable,args,{cwd:android,stdio:'inherit',windowsHide:true,env:{...process.env,JAVA_HOME:javaHome,EKPAY_SANDBOX_INTEGRATION_URL:url,EKPAY_SANDBOX_CA:certificate}});
  const code=await new Promise((r,j)=>{child.on('error',j);child.on('exit',r);});if(code!==0)throw Error('Android→TLS→actual Phase 6 handlers→PostgreSQL integration failed');
  assert.equal(Number((await db.query('SELECT count(*) n FROM public.payment_evidence')).rows[0].n),1);
  assert.equal(Number((await db.query('SELECT count(*) n FROM public.transactions')).rows[0].n),0);
  console.log('PASS: real Kotlin HTTPS→Phase 6 handler→PostgreSQL; one synthetic evidence; no authoritative transactions');
});
