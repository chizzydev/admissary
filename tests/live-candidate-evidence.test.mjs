import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, cp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { digestCanonicalJson, scoreWorkloadPack } from '../dist/index.js';
import { acceptedHistorical } from '../scripts/artifact-integrity.mjs';
import { LIVE_CANDIDATES } from '../scripts/live-candidate-evidence.mjs';
import { verifyCollectionSessions } from '../scripts/r13-collection-policy.mjs';
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const save=async(p,v)=>writeFile(p,JSON.stringify(v,null,2)+'\n');
const sha=b=>createHash('sha256').update(b).digest('hex');
const loader=pathToFileURL(resolve('scripts/live-candidate-evidence.mjs')).href;
// Controlled, temporary replay fixtures derived from DeepSeek, never exported as real Gemma evidence.
async function fixture(){
  const dir=await mkdtemp(join(tmpdir(),'admissary-r13-fixture-'));
  await mkdir(join(dir,'results/r13'),{recursive:true});await cp('data',join(dir,'data'),{recursive:true});
  const deepPath=await acceptedHistorical('ADMISSARY_R5_DOLPHIN_');await cp(deepPath,join(dir,deepPath));
  const target=LIVE_CANDIDATES[0],raw=structuredClone(await read(deepPath));
  raw.requestedModel=target.model;raw.responseModel=target.model;
  for(const c of raw.cases){c.requestedModel=target.model;c.responseModel=target.model;}
  const {runDigest,...payload}=raw;raw.runDigest=digestCanonicalJson(payload);
  const pack=await read('data/workloads/banking-routing-v1.workload.json');
  const summary={...target,provenance:'REAL_DOLPHIN_EXECUTION',completionStatus:'COMPLETED',casesCompleted:144,artifactPath:'results/r13/gemma-fixture.json',runDigest:raw.runDigest,metrics:raw.metrics,genericScore:scoreWorkloadPack(pack,raw.cases.map(c=>({caseId:c.caseId,schemaValid:c.schemaValid,output:c.schemaValid?{intent:c.predictedIntent}:null,latencyMs:c.latencyMs}))),mandatoryMetricsPass:raw.mandatoryMetricsPass,providerBindingScope:'PROVIDER_MODEL_IDENTITY',exactArtifactBindingProven:false};
  async function seal(){
    summary.protocol=raw.promptProtocol;summary.promptDigest=raw.promptProtocolDigest;summary.generationDigest=raw.generationConfigDigest;summary.workloadPackDigest=pack.packDigest;
    const {runDigest,...p}=raw;raw.runDigest=digestCanonicalJson(p);summary.runDigest=raw.runDigest;
    await save(join(dir,summary.artifactPath),raw);summary.artifactSHA256=sha(await readFile(join(dir,summary.artifactPath)));
    const summaryPath='results/r13/gemma-summary.json';await save(join(dir,summaryPath),summary);
    await save(join(dir,'data/r13-accepted-evidence.json'),{schema:'admissary-r13-accepted-evidence/v1',candidates:[{...target,summaryPath,summarySHA256:sha(await readFile(join(dir,summaryPath))),artifactPath:summary.artifactPath,artifactSHA256:summary.artifactSHA256}]});
  }
  await seal();
  const run=()=>spawnSync(process.execPath,['--input-type=module','-e',`const a=await import(${JSON.stringify(loader)});const r=await a.readLiveCandidateEvidence(${JSON.stringify(target.model)}); console.log(JSON.stringify({empirical:r.empiricalFitness,full:r.qualificationState,raw:!!r.raw}));`],{cwd:dir,encoding:'utf8',timeout:30000});
  return {dir,raw,summary,seal,run,close:()=>rm(dir,{recursive:true,force:true})};
}
test('R13 controlled fixture replay derives full REVIEW_REQUIRED and preserves provider-only identity',async()=>{
  const f=await fixture();try{const r=f.run();assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{empirical:'UNFIT',full:'REVIEW_REQUIRED',raw:true});}finally{await f.close();}
});
for(const [name,mutate,reseal] of [
  ['changed bytes behind accepted hash',async f=>writeFile(join(f.dir,f.summary.artifactPath),'{}'),false],
  ['forged metrics with a self-consistent run digest',f=>{f.raw.metrics.macro_f1=1;f.summary.metrics=f.raw.metrics;},true],
  ['changed frozen prompt digest',f=>{f.raw.promptProtocolDigest='a'.repeat(64);},true],
  ['truncated complete run',f=>{f.raw.cases.pop();},true],
  ['wrong returned provider model',f=>{f.raw.cases[0].responseModel=LIVE_CANDIDATES[1].model;},true],
  ['fabricated exact artifact assertion',f=>{f.summary.exactArtifactBindingProven=true;},true],
  ['forged advisory-to-mandatory threshold',f=>{f.raw.metricGates.at(-1).threshold.criticality='MANDATORY';},true],
])test('R13 rejects '+name,async()=>{const f=await fixture();try{assert.equal(f.run().status,0);await mutate(f);if(reseal)await f.seal();const r=f.run();assert.notEqual(r.status,0,name);}finally{await f.close();}});
test('R13 partial credit evidence never supplies full-run metrics or a completed qualification',async()=>{
  const f=await fixture();try{f.summary.completionStatus='PARTIAL_INSUFFICIENT_CREDIT';f.summary.casesCompleted=12;delete f.summary.metrics;await f.seal();const r=f.run();assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{empirical:'INCOMPLETE',full:'INCOMPLETE',raw:false});f.summary.metrics=f.raw.metrics;await f.seal();assert.notEqual(f.run().status,0);}finally{await f.close();}
});
test('R13 controlled collector resume makes zero paid calls for completed runs and refuses ambiguous success',async()=>{
  const f=await fixture();try{
    await cp('results/ADMISSARY_R10C_REGISTRY_STATE.json',join(f.dir,'results/ADMISSARY_R10C_REGISTRY_STATE.json'));
    for(const path of ['src/providers/dolphin.ts','src/evaluation/metrics.ts']){await mkdir(join(f.dir,path,'..'),{recursive:true});await cp(path,join(f.dir,path));}
    for(const target of LIVE_CANDIDATES){
      const raw=structuredClone(f.raw);raw.requestedModel=target.model;raw.responseModel=target.model;for(const c of raw.cases){c.requestedModel=target.model;c.responseModel=target.model;}
      const {runDigest,...p}=raw;raw.runDigest=digestCanonicalJson(p);
      const artifactPath=`results/r13/${target.slug}-controlled-resume.json`;await save(join(f.dir,artifactPath),raw);
      await save(join(f.dir,`results/r13/${target.slug}-summary.json`),{completionStatus:'COMPLETED',artifactPath,runDigest:raw.runDigest});
    }
    const mock=join(f.dir,'local-provider-fixture.mjs');
    await writeFile(mock,`globalThis.fetch=async url=>{if(!new URL(url).pathname.endsWith('/models'))throw new Error('PAID_REQUEST_FORBIDDEN_IN_CONTROLLED_FIXTURE');return new Response(JSON.stringify({data:${JSON.stringify(LIVE_CANDIDATES.map(t=>({id:t.model,owned_by:'CONTROLLED_FIXTURE'})))}}),{status:200});};`);
    const invoke=()=>spawnSync(process.execPath,['--import',pathToFileURL(mock).href,resolve('scripts/r13-live-candidates.mjs'),'--run'],{cwd:f.dir,input:'dp-'+'CONTROLLED_LOCAL_FIXTURE_ONLY\n',encoding:'utf8',timeout:30000});
    const resumed=invoke();assert.equal(resumed.status,0,resumed.stdout+resumed.stderr);assert.match(resumed.stdout,/GEMMA_ALREADY_COMPLETE_NO_CALLS=144/);assert.match(resumed.stdout,/QWEN_ALREADY_COMPLETE_NO_CALLS=144/);assert.match(resumed.stdout,/COLLECTION_FINISHED_PAID_ATTEMPTS=0/);
    await save(join(f.dir,'results/r13/gemma-summary.json'),{completionStatus:'INCOMPLETE_PROVIDER_ERROR',casesCompleted:0});
    await save(join(f.dir,'results/r13/gemma-controlled-request-0001.json'),{kind:'PAID_INFERENCE',model:LIVE_CANDIDATES[0].model,caseId:f.raw.cases[0].caseId,status:'RESPONSE_RECEIVED',httpStatus:200});
    const ambiguous=invoke();assert.notEqual(ambiguous.status,0);assert.match(ambiguous.stderr,/Uncheckpointed provider outcome requires evidence reconciliation/);assert.doesNotMatch(ambiguous.stderr,/PAID_REQUEST_FORBIDDEN/);
  }finally{await f.close();}
});

function sessionFixture(stamp='controlled',initialCases={qwen:0,gemma:99}){
  const q=LIVE_CANDIDATES[1].model,g=LIVE_CANDIDATES[0].model;
  const start={stamp,qwenFirst:true,initialCases,targetOrder:[q,g]},requests=[{file:`catalog-${stamp}-request-0001.json`,kind:'CATALOG',httpStatus:200,receivedAt:new Date(0).toISOString()}];
  function add(model,caseId,status=200){const ordinal=requests.length;requests.push({kind:'PAID_INFERENCE',file:`${model===q?'qwen':'gemma'}-${stamp}-request-${ordinal}.json`,ordinal,model,caseId,status:'RESPONSE_RECEIVED',httpStatus:status,startedAt:new Date(ordinal*10).toISOString(),receivedAt:new Date(ordinal*10+1).toISOString()});}
  return {q,g,start,requests,add};
}
test('R13 priority gate excludes Gemma until all 144 Qwen cases complete',()=>{
  const f=sessionFixture();f.add(f.q,'q-1');f.add(f.g,'g-100');assert.throws(()=>verifyCollectionSessions(f.requests,[f.start]),/before Qwen completed/);
});
test('R13 priority gate accepts Qwen then remaining Gemma and rejects duplicated success',()=>{
  const f=sessionFixture();for(let i=1;i<=144;i++)f.add(f.q,'q-'+i);for(let i=100;i<=144;i++)f.add(f.g,'g-'+i);
  assert.equal(verifyCollectionSessions(f.requests,[f.start])[0].successfulCases,189);f.add(f.q,'q-1');assert.throws(()=>verifyCollectionSessions(f.requests,[f.start]),/paid twice/);
});
test('R13 credit failure stops its session; renewed authorization may resume in a new session',()=>{
  const a=sessionFixture('old'),b=sessionFixture('new');a.add(a.q,'q-1',402);b.add(b.q,'q-1');
  assert.equal(verifyCollectionSessions([...a.requests,...b.requests],[a.start,b.start]).length,2);
  a.add(a.q,'q-1');assert.throws(()=>verifyCollectionSessions(a.requests,[a.start]),/Deterministic response retried/);
});
test('R13 controlled Qwen-first credit stop preserves all 99 existing Gemma cases without calls',async()=>{
  const f=await fixture();try{
    await cp('results/ADMISSARY_R10C_REGISTRY_STATE.json',join(f.dir,'results/ADMISSARY_R10C_REGISTRY_STATE.json'));
    for(const path of ['src/providers/dolphin.ts','src/evaluation/metrics.ts']){await mkdir(join(f.dir,path,'..'),{recursive:true});await cp(path,join(f.dir,path));}
    const models=LIVE_CANDIDATES.map(t=>({id:t.model,ownedBy:'CONTROLLED_FIXTURE'}));
    const frozen=await read('data/r13-frozen-inputs.json'),cases=f.raw.cases.slice(0,99);
    const checkpoint={schema:'admissary-r13-checkpoint/v1',identity:{model:LIVE_CANDIDATES[0].model,catalogDigest:digestCanonicalJson(models),suiteDigest:frozen.suiteDigest,promptDigest:frozen.promptDigest,generationDigest:frozen.generationDigest,retryPolicy:frozen.retryPolicy},startedAt:f.raw.startedAt,cases};
    const checkpointPath=join(f.dir,'results/r13/gemma-checkpoint.json');await save(checkpointPath,checkpoint);const before=await readFile(checkpointPath);
    await save(join(f.dir,'results/r13/gemma-summary.json'),{...LIVE_CANDIDATES[0],completionStatus:'PARTIAL_INSUFFICIENT_CREDIT',casesCompleted:99});
    const mock=join(f.dir,'priority-local-provider-fixture.mjs');
    await writeFile(mock,`let calls=0;globalThis.fetch=async(url,init)=>{if(new URL(url).pathname.endsWith('/models'))return new Response(JSON.stringify({data:${JSON.stringify(models.map(m=>({id:m.id,owned_by:m.ownedBy})))}}),{status:200});const body=JSON.parse(init.body);if(body.model!==${JSON.stringify(LIVE_CANDIDATES[1].model)})throw new Error('GEMMA_REQUEST_FORBIDDEN');if(++calls===3)return new Response(JSON.stringify({detail:'insufficient credits'}),{status:402});return new Response(JSON.stringify({id:'controlled-'+calls,model:body.model,choices:[{message:{role:'assistant',content:JSON.stringify({intent:'card_payment_not_recognised'})},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:1,total_tokens:11}}),{status:200});};`);
    const r=spawnSync(process.execPath,['--import',pathToFileURL(mock).href,resolve('scripts/r13-live-candidates.mjs'),'--run','--qwen-first'],{cwd:f.dir,input:'dp-'+'CONTROLLED_LOCAL_FIXTURE_ONLY\n',encoding:'utf8',timeout:30000});
    assert.equal(r.status,0,r.stdout+r.stderr);assert.doesNotMatch(r.stdout,/GEMMA_SEQUENTIAL_START/);assert.deepEqual(await readFile(checkpointPath),before);
    const q=await read(join(f.dir,'results/r13/qwen-summary.json'));assert.equal(q.casesCompleted,2);assert.equal(q.completionStatus,'PARTIAL_INSUFFICIENT_CREDIT');assert.equal(q.metrics,undefined);
    const logs=await readdir(join(f.dir,'results/r13'));assert.equal(logs.filter(n=>n.startsWith('gemma-')&&n.includes('-request-')).length,0);
  }finally{await f.close();}
});
