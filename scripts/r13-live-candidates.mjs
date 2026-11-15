// Live collection adapter: frozen provider/parser/scorer, sequential durable capture.
// Secret arrives through raw stdin only; never argv, files, reports or shell history.
import assert from 'node:assert/strict';
import { readFile, mkdir, open, rename, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as a from '../dist/index.js';
const sessionStamp=new Date().toISOString().replace(/[:.]/g,'');
const qwenFirst=process.argv.includes('--qwen-first');
const dir='results/r13';await mkdir(dir,{recursive:true});
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function save(path,value){const handle=await open(path+'.tmp','w');try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}await rename(path+'.tmp',path);}
async function existing(path){try{return await read(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
const suite=await read('data/banking77/banking-routing-v1.json'),spec=await read('data/banking77/banking-routing-v1.spec.json'),pack=await read('data/workloads/banking-routing-v1.workload.json');
a.validateBanking77Suite(suite,spec);assert.equal(suite.suiteDigest,'8eb57a06283737e394409976cf6bfb011c6537e53c64935065021f5ba39ae5f2');assert.equal(suite.baselineCases.length,120);assert.equal(suite.adversarialCases.length,24);
const accepted=await read('data/accepted-artifacts.json'),binding=accepted.artifacts.ADMISSARY_R5_DOLPHIN_,deepPath='results/'+binding.file,bytes=await readFile(deepPath),deep=JSON.parse(bytes);
assert.equal(sha(bytes),binding.sha256);assert.equal(a.verifyDolphinRunIntegrity(deep),true);
assert.equal(a.DOLPHIN_PROMPT_PROTOCOL,'banking-intent-json-v2');assert.equal(a.buildDolphinClassificationPrompt(suite.intents,'').protocolDigest,deep.promptProtocolDigest);assert.equal(a.digestCanonicalJson(a.DOLPHIN_GENERATION_CONFIG),deep.generationConfigDigest);assert.deepEqual(a.DOLPHIN_GENERATION_CONFIG,deep.generationConfig);
const frozenPaths=['data/banking77/banking-routing-v1.json','data/banking77/banking-routing-v1.spec.json','data/workloads/banking-routing-v1.workload.json','src/providers/dolphin.ts','src/evaluation/metrics.ts'];
const frozenInputs=await read('data/r13-frozen-inputs.json');
const frozen=[];for(const path of frozenPaths){const data=await readFile(path);assert.equal(sha(data),frozenInputs.frozen.find(x=>x.path===path)?.sha256,path);frozen.push({path,sha256:sha(data)});}
const recomputed=a.scoreWorkloadPack(pack,deep.cases.map(c=>({caseId:c.caseId,schemaValid:c.schemaValid,output:c.schemaValid?{intent:c.predictedIntent}:null,latencyMs:c.latencyMs})));
for(const m of recomputed.metrics)assert.equal(m.observed,deep.metrics[m.metric],m.metric);
const preflight={schema:'admissary-r13-frozen-preflight/v1',verifiedAt:new Date().toISOString(),suiteDigest:suite.suiteDigest,promptDigest:deep.promptProtocolDigest,generationDigest:deep.generationConfigDigest,protocol:deep.promptProtocol,generationConfig:deep.generationConfig,deepSeek:{path:deepPath,sha256:sha(bytes),runDigest:deep.runDigest,metrics:deep.metrics},frozen,retryPolicy:{attempts:4,baseDelayMs:500,timeoutMs:60000},thresholds:deep.metricGates.map(g=>({metric:g.metric,threshold:g.threshold}))};
await save(dir+'/preflight.json',preflight);console.log('FROZEN_INPUT_AND_DEEPSEEK_PREFLIGHT=PASS');
await save(dir+'/preflight-'+sessionStamp+'.json',preflight);
if(process.argv.includes('--preflight-only'))process.exit(0);
if(process.stdin.isTTY)process.stdin.setRawMode(true);
console.log('CREDENTIAL_STDIN_READY_NO_ECHO');
const secret=await new Promise(resolve=>{let value='';process.stdin.on('data',chunk=>{value+=chunk.toString();if(/[\r\n]/.test(value)){process.stdin.pause();resolve(value.trim());}});process.stdin.resume();});
if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.unref?.();
assert.ok(secret.startsWith('dp-')&&secret.length>20,'Credential input required');
const scrub=value=>value.replaceAll(secret,'[REDACTED]').replace(/dp-[A-Za-z0-9_-]{20,}/g,'[REDACTED]');
let paidCalls=0,catalogRequests=0,pending=[],activeModel=null,activeCase=null;
const transport=async(url,init)=>{
  const paid=new URL(url).pathname.endsWith('/chat/completions');
  const ordinal=paid?++paidCalls:++catalogRequests;
  const request={schema:'admissary-r13-provider-request/v1',kind:paid?'PAID_INFERENCE':'CATALOG',ordinal,model:activeModel,caseId:activeCase,startedAt:new Date().toISOString(),method:init.method,url,body:init.body?JSON.parse(init.body):null,status:'IN_FLIGHT'};
  const path=dir+'/'+(paid?activeModel.includes('/Gemma-')?'gemma':'qwen':'catalog')+'-'+sessionStamp+'-request-'+String(ordinal).padStart(4,'0')+'.json';
  await save(path,request);
  try{
    const response=await fetch(url,init);const captured=response.clone().text().then(async body=>{await save(path,{...request,status:'RESPONSE_RECEIVED',receivedAt:new Date().toISOString(),httpStatus:response.status,responseBody:scrub(body)});});pending.push(captured);return response;
  }catch(error){await save(path,{...request,status:'TRANSPORT_ERROR',completedAt:new Date().toISOString(),error:scrub(error.message)});throw error;}
};
const client=new a.DolphinInferenceClient({apiKey:secret,baseUrl:'https://lighthouse.dphn.ai/run/text-v/v1',timeoutMs:60000,retryAttempts:4,retryBaseDelayMs:500,fetchImpl:transport});
let catalog;try{catalog=await client.listModels();await Promise.all(pending);pending=[];}catch(error){await Promise.allSettled(pending);console.error('CATALOG_ERROR='+scrub(error.message));process.exitCode=1;throw new Error('Catalog preflight failed; no inference enabled');}
const registry=await read('results/ADMISSARY_R10C_REGISTRY_STATE.json');
const targets=[['gemma','candidate-gemma4-nvfp4','Gemma-4-26B-A4B-NVFP4'],['qwen','candidate-qwen36-nvfp4','Qwen3.6-35B-A3B-NVFP4']].map(([slug,candidateId,briefName])=>{
  const registered=registry.candidates.find(c=>c.id===candidateId);assert.ok(registered);assert.equal(registered.repositoryOrModelId.split('/').at(-1),briefName);
  return {slug,candidateId,briefName,model:registered.repositoryOrModelId,available:catalog.models.some(x=>x.id===registered.repositoryOrModelId)};
});
await save(dir+'/catalog.json',{schema:'admissary-r13-live-catalog/v1',retrievedAt:new Date().toISOString(),endpoint:'https://lighthouse.dphn.ai/run/text-v/v1/models',catalog,targets});
await save(dir+'/catalog-'+sessionStamp+'.json',{schema:'admissary-r13-live-catalog/v1',retrievedAt:new Date().toISOString(),catalog,targets});
for(const model of catalog.models)console.log('DOLPHIN_MODEL_AVAILABLE='+model.id);
console.log('CATALOG_VERIFIED_PAID_CALLS=0');
if(process.argv.includes('--run')){
  const originalClassify=client.classify.bind(client);
  client.classify=async(caseId,...args)=>{activeCase=caseId;return originalClassify(caseId,...args);};
  let creditExhausted=false;
  const orderedTargets=qwenFirst?[targets[1],targets[0]]:targets;
  const sessionStart={schema:'admissary-r13-collection-session-start/v1',startedAt:new Date().toISOString(),qwenFirst,targetOrder:orderedTargets.map(t=>t.model),initialCases:{}};
  for(const t of orderedTargets)sessionStart.initialCases[t.slug]=(await existing(dir+'/'+t.slug+'-checkpoint.json'))?.cases.length??0;
  await save(dir+'/collection-start-'+sessionStamp+'.json',sessionStart);
  for(const target of orderedTargets){
    const summaryPath=dir+'/'+target.slug+'-summary.json';
    const done=await existing(summaryPath);
    if(done?.completionStatus==='COMPLETED'){
      const run=await read(done.artifactPath);assert.equal(a.verifyDolphinRunIntegrity(run),true);assert.equal(run.runDigest,done.runDigest);assert.equal(run.requestedModel,target.model);assert.equal(run.cases.length,144);console.log(target.slug.toUpperCase()+'_ALREADY_COMPLETE_NO_CALLS=144');continue;
    }
    if(!target.available||creditExhausted){if(!done?.casesCompleted)await save(summaryPath,{schema:'admissary-r13-candidate-execution/v1',...target,provenance:'REAL_DOLPHIN_EXECUTION',completionStatus:!target.available?'MODEL_UNAVAILABLE':'NOT_RUN_CREDIT_EXHAUSTED',casesCompleted:0,exactArtifactBindingProven:false});if(qwenFirst&&target.slug==='qwen')break;continue;}
    activeModel=target.model;activeCase=null;
    const checkpointPath=dir+'/'+target.slug+'-checkpoint.json';
    const checkpoint=await existing(checkpointPath);
    const identity={model:target.model,catalogDigest:catalog.digest,suiteDigest:suite.suiteDigest,promptDigest:deep.promptProtocolDigest,generationDigest:deep.generationConfigDigest,retryPolicy:preflight.retryPolicy};
    if(checkpoint)assert.deepEqual(checkpoint.identity,identity,'Checkpoint frozen identity mismatch');
    const completed=[...(checkpoint?.cases??[])];
    // Never repay an ambiguous or already successful uncheckpointed request.
    for(const name of await readdir(dir)){
      if(!name.startsWith(target.slug+'-')||!name.includes('-request-')||!name.endsWith('.json'))continue;
      const prior=await read(dir+'/'+name);
      if(prior.kind==='PAID_INFERENCE'&&prior.model===target.model&&!completed.some(c=>c.caseId===prior.caseId)&&
        (prior.status==='IN_FLIGHT'||prior.httpStatus===200))throw new Error('Uncheckpointed provider outcome requires evidence reconciliation; refusing duplicate paid call: '+name);
    }
    console.log(target.slug.toUpperCase()+'_SEQUENTIAL_START_RESUME='+completed.length);
    const startedAt=checkpoint?.startedAt??new Date().toISOString();
    try{
      const run=await a.evaluateDolphinSuite(client,suite,target.model,catalog.digest,{initialCases:completed,
        async onCase(result,count){await Promise.all(pending);pending=[];completed.push(result);assert.equal(count,completed.length);await save(checkpointPath,{schema:'admissary-r13-checkpoint/v1',identity,startedAt,updatedAt:new Date().toISOString(),cases:completed});},
        onProgress(count,total){if(count===1||count%12===0||count===total)console.log(target.slug.toUpperCase()+'_PROGRESS='+count+'/'+total);}
      });
      assert.equal(run.cases.length,144);assert.equal(run.promptProtocolDigest,deep.promptProtocolDigest);assert.equal(run.generationConfigDigest,deep.generationConfigDigest);
      const genericScore=a.scoreWorkloadPack(pack,run.cases.map(c=>({caseId:c.caseId,schemaValid:c.schemaValid,output:c.schemaValid?{intent:c.predictedIntent}:null,latencyMs:c.latencyMs})));
      for(const metric of genericScore.metrics)assert.equal(metric.observed,run.metrics[metric.metric]);
      const artifactPath=dir+'/'+target.slug+'-'+run.runDigest+'.json';await save(artifactPath,run);
      await save(summaryPath,{schema:'admissary-r13-candidate-execution/v1',...target,provenance:'REAL_DOLPHIN_EXECUTION',completionStatus:'COMPLETED',casesCompleted:144,startedAt,completedAt:run.completedAt,artifactPath,runDigest:run.runDigest,artifactSHA256:sha(await readFile(artifactPath)),workloadPackDigest:pack.packDigest,protocol:run.promptProtocol,promptDigest:run.promptProtocolDigest,generationDigest:run.generationConfigDigest,genericScore,metrics:run.metrics,mandatoryMetricsPass:run.mandatoryMetricsPass,totalUsage:run.totalUsage,providerBindingScope:'PROVIDER_MODEL_IDENTITY',exactArtifactBindingProven:false,missingExactIdentity:['runtime artifact revision','runtime tokenizer revision','artifact manifest'],dollarCost:null});
      console.log(target.slug.toUpperCase()+'_COMPLETE_METRICS='+JSON.stringify(run.metrics));
    }catch(error){
      await Promise.allSettled(pending);pending=[];const detail=scrub(error.message);creditExhausted=error.status===402||/insufficient.{0,40}(credit|balance|fund)|(?:credit|balance).{0,40}(exhaust|insufficient)/i.test(detail);
      await save(summaryPath,{schema:'admissary-r13-candidate-execution/v1',...target,provenance:'REAL_DOLPHIN_EXECUTION',completionStatus:creditExhausted?'PARTIAL_INSUFFICIENT_CREDIT':'INCOMPLETE_PROVIDER_ERROR',casesCompleted:completed.length,startedAt,stoppedAt:new Date().toISOString(),error:{code:error.code??error.name,status:error.status??null,detail},providerBindingScope:'PROVIDER_MODEL_IDENTITY',exactArtifactBindingProven:false,dollarCost:null});
      console.log(target.slug.toUpperCase()+'_STOPPED='+detail);
      if(qwenFirst&&target.slug==='qwen')break; // Gemma is forbidden until Qwen completes.
    }
  }
  await save(dir+'/collection-session-'+sessionStamp+'.json',{...sessionStart,schema:'admissary-r13-collection-session/v1',completedAt:new Date().toISOString(),paidRequestAttempts:paidCalls,catalogRequestAttempts:catalogRequests,creditExhausted});
  console.log('COLLECTION_FINISHED_PAID_ATTEMPTS='+paidCalls);
}
