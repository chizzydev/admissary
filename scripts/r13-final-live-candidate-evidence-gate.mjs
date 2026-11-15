import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { liveCandidateRecords } from './live-candidate-evidence.mjs';
import { acceptedHistorical, readProof } from './artifact-integrity.mjs';
import * as a from '../dist/index.js';
import { createAdmissaryWebServer } from './admissary-web-lib.mjs';
import { verifyCollectionSessions } from './r13-collection-policy.mjs';
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const frozen=await read('data/r13-frozen-inputs.json'),initial=await read('results/r13/initial-preflight.json');
for(const f of frozen.frozen)assert.equal(sha(await readFile(f.path)),f.sha256,f.path);
const deep=await read(await acceptedHistorical('ADMISSARY_R5_DOLPHIN_'));
assert.deepEqual(deep.metrics,frozen.deepSeek.metrics);assert.equal(deep.runDigest,frozen.deepSeek.runDigest);
assert.equal(deep.promptProtocolDigest,frozen.promptDigest);assert.equal(deep.generationConfigDigest,frozen.generationDigest);
const suite=await read('data/banking77/banking-routing-v1.json');assert.equal(suite.suiteDigest,frozen.suiteDigest);
const catalog=await read('results/r13/catalog.json');assert.equal(catalog.catalog.digest,a.digestCanonicalJson(catalog.catalog.models));
const requests=[];
for(const name of await readdir('results/r13'))if(name.includes('-request-')&&name.endsWith('.json'))requests.push({...await read('results/r13/'+name),file:name});
const paid=requests.filter(r=>r.kind==='PAID_INFERENCE');
for(const p of paid){
  const c=[...suite.baselineCases,...suite.adversarialCases].find(c=>c.id===p.caseId);assert.ok(c,'Non-frozen case was captured');
  const prompt=a.buildDolphinClassificationPrompt(suite.intents,c.text);assert.deepEqual(p.body,{model:p.model,messages:[{role:'system',content:prompt.system},{role:'user',content:prompt.user}],...frozen.generationConfig});
}
const starts=[];for(const name of await readdir('results/r13'))if(name.startsWith('collection-start-')&&name.endsWith('.json'))starts.push({...await read('results/r13/'+name),stamp:name.slice('collection-start-'.length,-5)});
const collectionSessions=verifyCollectionSessions(requests,starts);
assert.ok(requests.some(r=>r.kind==='CATALOG'&&r.httpStatus===200&&Date.parse(r.receivedAt)<=Math.min(...paid.map(p=>Date.parse(p.startedAt)))),'Catalog must precede paid inference');
assert.ok(paid.every(r=>Date.parse(r.startedAt)>=Date.parse(initial.verifiedAt)));
const records=await liveCandidateRecords();assert.equal(records.length,2);
assert.ok(paid.every(p=>records.some(r=>r.target.model===p.model)),'No hidden third candidate');
const outcomes=[],caseAudit=[];
for(const r of records){
  assert.equal(catalog.targets.find(t=>t.model===r.target.model)?.available,catalog.catalog.models.some(m=>m.id===r.target.model));
  const calls=paid.filter(p=>p.model===r.target.model),successes=calls.filter(p=>p.httpStatus===200);
  assert.ok(calls.every(p=>p.status!=='IN_FLIGHT'),'Unresolved paid request');
  if(r.raw){
    assert.equal(r.summary.artifactPath,`results/r13/${r.target.slug}-${r.raw.runDigest}.json`);
    assert.equal(r.raw.modelCatalogDigest,catalog.catalog.digest);
    assert.equal(r.raw.cases.length,144);assert.equal(successes.length,144);
  }else{
    assert.ok(r.partial,'Incomplete execution must carry a pinned content-addressed status artifact');
    assert.equal(successes.length,r.summary.casesCompleted);assert.equal(r.partial.metrics,null);
    assert.ok(['MODEL_UNAVAILABLE','PARTIAL_INSUFFICIENT_CREDIT','NOT_RUN_CREDIT_EXHAUSTED'].includes(r.summary.completionStatus),'Available target requires completion or actual exhausted credit');
    if(r.summary.completionStatus==='PARTIAL_INSUFFICIENT_CREDIT')assert.ok(calls.some(p=>p.httpStatus===402||/insufficient.{0,40}(credit|balance|fund)/i.test(p.responseBody??'')));
    if(r.summary.completionStatus==='NOT_RUN_CREDIT_EXHAUSTED'){assert.equal(calls.length,0);assert.ok(paid.some(p=>p.httpStatus===402&&/insufficient credits/i.test(p.responseBody??'')));assert.equal(r.partial.executionPerformed,false);}
  }
    for(const c of (r.raw??r.partial).cases){
      const expected=[...suite.baselineCases,...suite.adversarialCases].find(t=>t.id===c.caseId);
      const attempts=calls.filter(p=>p.caseId===c.caseId);assert.ok(attempts.length>=1);
      const ok=attempts.filter(p=>p.httpStatus===200);assert.equal(ok.length,1,'No successful paid case repeated');
      const prompt=a.buildDolphinClassificationPrompt(suite.intents,expected.text);
      for(const request of attempts){assert.equal(request.body.model,r.target.model);assert.equal(request.body.max_completion_tokens,frozen.generationConfig.max_completion_tokens);assert.deepEqual(request.body.messages,[{role:'system',content:prompt.system},{role:'user',content:prompt.user}]);assert.equal(Object.keys(request.body).sort().join(','),'max_completion_tokens,messages,model');}
      // Session verification above enforces transient-only retries; an old 402
      // may precede a separately authorized session with restored credit.
      // Replay the complete saved provider body through the original client/parser, with zero network.
      const offline=new a.DolphinInferenceClient({apiKey:'LOCAL_FIXTURE_REPLAY',baseUrl:'https://lighthouse.dphn.ai/run/text-v/v1',retryAttempts:1,fetchImpl:async()=>new Response(ok[0].responseBody,{status:200})});
      const replay=await offline.classify(c.caseId,expected.text,suite.intents,r.target.model);
      for(const key of Object.keys(c).filter(k=>k!=='latencyMs'))assert.deepEqual(c[key],replay[key],`${c.caseId}.${key}`);
      caseAudit.push({model:r.target.model,caseId:c.caseId,kind:expected.kind,baselineCaseId:expected.sourceCaseId??null,mutationId:expected.mutationId??null,expectedIntent:expected.expectedIntent,predictedIntent:c.predictedIntent,schemaValid:c.schemaValid,correct:c.schemaValid&&c.predictedIntent===expected.expectedIntent,latencyMs:c.latencyMs,attempts:attempts.length,requestFile:ok[0].file,responseId:c.responseId,startedAt:ok[0].startedAt,receivedAt:ok[0].receivedAt});
    }
  assert.equal(r.summary.exactArtifactBindingProven,false);assert.notEqual(r.qualificationState,'QUALIFIED');
  outcomes.push({candidateId:r.target.candidateId,model:r.target.model,status:r.summary.completionStatus,cases:r.summary.casesCompleted,paidAttempts:calls.length,successfulCases:successes.length,retries:Math.max(0,calls.length-new Set(calls.map(c=>c.caseId)).size),empiricalFitness:r.empiricalFitness,qualificationState:r.qualificationState,metrics:r.raw?.metrics??null,dollarCost:null});
}
let resumeBaseline=null;try{resumeBaseline=await read('data/r13-resume-baseline.json');}catch(e){if(e.code!=='ENOENT')throw e;}
if(resumeBaseline){
  const checkpoint=await read('results/r13/gemma-checkpoint.json');assert.equal(a.digestCanonicalJson(checkpoint.cases.slice(0,99)),resumeBaseline.gemmaCasesDigest);
  assert.ok(starts.some(s=>s.qwenFirst&&s.initialCases.gemma===99&&s.initialCases.qwen===0),'Qwen-first resumption is not recorded');
  assert.equal(records.find(r=>r.target.slug==='qwen').summary.casesCompleted,paid.filter(p=>p.model.includes('/Qwen')&&p.httpStatus===200).length,'Non-BANKING77 diagnostic entered official counts');
}
const view=await readProof('web/demo-snapshot.json','snapshotDigest','admissary-judge-view/v1');
const c4=await readProof('results/ADMISSARY_R10C4_DECISION_WORKSPACE_PROOF.json','proofDigest','admissary-r10c4-decision-workspace-proof/v1');
const portfolio=await readProof('results/ADMISSARY_R10D_SCENARIO_PROOF.json','portfolioDigest','admissary-canonical-case-portfolio/v1');
assert.equal(view.candidate.empiricalFitness,'UNFIT');assert.equal(view.candidate.overallQualification,'REVIEW_REQUIRED');assert.equal(view.candidate.deployAllowed,false);
assert.equal(c4.realSelection.selectedCandidateId,null);assert.equal(c4.realSelection.status,'NO_REAL_ADMISSIBLE_SELECTION');assert.equal(c4.selection.claimScope,'FIXTURE_ONLY');
assert.equal(portfolio.cases.find(c=>c.id==='CASE_C').facts.realSelectionStatus,'NO_REAL_ADMISSIBLE_SELECTION');
const state=await read('results/ADMISSARY_R10C5_PRODUCT_STATE.json');
for(const r of records){const row=view.candidates.find(c=>c.id===r.target.candidateId);assert.ok(row);assert.equal(row.provenance,'REAL_EVIDENCE');assert.equal(row.qualificationState,r.qualificationState);assert.equal(row.empiricalFitness,r.empiricalFitness);assert.equal(row.deploymentState,'DENY');assert.equal(row.execution.exactArtifactBindingProven,false);assert.equal(row.execution.casesCompleted,r.summary.casesCompleted);
  if(r.raw){const run=state.qualificationRuns.find(q=>q.candidateId===r.target.candidateId&&q.status==='COMPLETED');assert.ok(run);assert.equal(run.qualificationState,r.qualificationState);assert.equal(run.completionEvidence.provenance,'REAL');assert.equal(run.exactArtifactBindingProven,false);assert.ok(run.sourceRefs.some(s=>s.includes(r.raw.runDigest)));}
  else{assert.equal(state.qualificationRuns.filter(q=>q.candidateId===r.target.candidateId&&q.status==='COMPLETED').length,0);assert.equal(row.execution.metrics.length,0);}
}
const apiAcceptance=[];
const server=createAdmissaryWebServer({mode:'r13-local-gate',authTokens:{localR13Viewer:'VIEWER',localR13Operator:'OPERATOR',localR13Approver:'APPROVER',localR13Admission:'ADMISSION'}});
await new Promise((ok,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',ok);});
try{const base=`http://127.0.0.1:${server.address().port}`;
  const publicView=await (await fetch(base+'/v1/product/judge-view')).json();assert.equal(publicView.snapshotDigest,view.snapshotDigest);
  const overview=await fetch(base+'/v1/product/overview',{headers:{authorization:'Bearer localR13Viewer'}});assert.equal(overview.status,200);const overviewBody=await overview.json();
  for(const r of records){const execution=overviewBody.liveCandidateExecutions.find(e=>e.candidateId===r.target.candidateId);assert.equal(execution.completionStatus,r.summary.completionStatus);assert.equal(execution.casesCompleted,r.summary.casesCompleted);assert.equal(execution.deployAllowed,false);apiAcceptance.push({candidateId:r.target.candidateId,overviewStatus:overview.status,execution});}
  const selected=await fetch(base+'/v1/product/selection',{method:'POST',headers:{authorization:'Bearer localR13Operator','content-type':'application/json'},body:JSON.stringify({schema:'admissary-product-selection-request/v1',candidateIds:records.map(r=>r.target.candidateId),policy:{schema:'admissary-candidate-selection-policy/v1',requireExactArtifactBinding:true,allowedProviders:null,maxP95LatencyMs:null,maxCostPerMillionTokensUsd:null,maxModelSizeB:null,objectiveOrder:['p95LatencyMs']}})});
  assert.equal(selected.status,200);assert.equal((await selected.json()).result.selectedCandidateId,null);
  for(const r of records.filter(r=>r.raw)){
    const run=state.qualificationRuns.find(q=>q.candidateId===r.target.candidateId&&q.status==='COMPLETED');
    const qualification=await fetch(base+`/v1/product/qualifications/${run.runId}`,{headers:{authorization:'Bearer localR13Viewer'}});
    assert.equal(qualification.status,200);assert.equal((await qualification.json()).run.qualificationState,r.qualificationState);
    const unauth=await fetch(base+`/v1/product/qualifications/${run.runId}`);assert.equal(unauth.status,401);
    const deploymentId=`deployment-${r.target.slug}-banking-prod`;
    const approval=await fetch(base+`/v1/product/deployments/${deploymentId}/approve`,{method:'POST',headers:{authorization:'Bearer localR13Approver','content-type':'application/json'},body:JSON.stringify({schema:'admissary-product-approval-request/v1',issuedAt:new Date().toISOString(),expiresAt:null,reason:'Controlled negative probe: hosted evidence cannot authorize deployment'})});
    const rejected=await approval.json();assert.equal(approval.status,400);assert.match(JSON.stringify(rejected),/QUALIFICATION|QUALIFIED|BINDING/);
    // Validly shaped fixture hashes deliberately do not establish the hosted runtime's identity.
    const context=await read('data/verifier-fixtures/deployment-context.json');context.candidate.repository=r.target.model;
    const admission=await fetch(base+`/v1/product/deployments/${deploymentId}/admission`,{method:'POST',headers:{authorization:'Bearer localR13Admission','content-type':'application/json'},body:JSON.stringify({schema:'admissary-current-deployment-admission-request/v1',context})});
    const denied=await admission.json();assert.equal(admission.status,409);assert.equal(denied.allowed,false);assert.ok(denied.currentAuthority.reasons.includes('QUALIFICATION_'+r.qualificationState));
    apiAcceptance.push({candidateId:r.target.candidateId,qualificationRead:qualification.status,unauthenticatedRead:unauth.status,approvalStatus:approval.status,approval:rejected,currentAdmissionStatus:admission.status,currentAdmission:denied});
  }
}finally{server.closeAllConnections?.();await new Promise(ok=>server.close(ok));}
const app=await readFile('web/app.js','utf8');assert.ok(app.includes('view.candidates.filter(c => c.execution)'));assert.ok(app.includes('liveEvidence() + section'));
// Actual token formats, not the harmless synthetic role tokens used by local fixtures.
for(const dir of ['data','results','web','scripts','src','tests']){
  async function scan(path){for(const entry of await readdir(path,{withFileTypes:true})){const p=path+'/'+entry.name;if(entry.isDirectory())await scan(p);else{const bytes=await readFile(p),s=bytes.toString('utf8');assert.doesNotMatch(s,/dp-[A-Za-z0-9_-]{25,}/,p);assert.doesNotMatch(s,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/]{30}/,p);}}}await scan(dir);
}
await writeFile('results/r13/case-audit.json',JSON.stringify({schema:'admissary-r13-case-audit/v1',cases:caseAudit},null,2)+'\n');
await writeFile('results/r13/product-api-acceptance.json',JSON.stringify(apiAcceptance,null,2)+'\n');
const payload={schema:'admissary-r13-final-live-candidate-evidence/v1',generatedAt:new Date().toISOString(),frozenInputs:'PASS',deepSeekUnchanged:true,outcomes,collectionSessions,evaluationCompleteness:outcomes.every(o=>o.status==='COMPLETED')?'COMPLETE':'INCOMPLETE',officialEvaluationsCompleted:outcomes.filter(o=>o.status==='COMPLETED').length,originalGemma99Preserved:!!resumeBaseline,externalDiagnosticCounted:false,hostedExactBinding:false,realSelection:'NO_REAL_ADMISSIBLE_SELECTION',positiveSelection:'FIXTURE_ONLY',apiProjection:'PASS',noSecretPersisted:true,offlineReplayNetworkCalls:0,verdict:'PASS'};
await writeFile('results/ADMISSARY_R13_FINAL_LIVE_CANDIDATE_EVIDENCE_PROOF.json',JSON.stringify({...payload,proofDigest:a.digestCanonicalJson(payload)},null,2)+'\n');
for(const o of outcomes)console.log(`${o.model}: ${o.status} ${o.cases}/144; ${o.empiricalFitness}/${o.qualificationState}; ${o.paidAttempts} attempts, ${o.retries} retries`);
console.log('R13_FINAL_LIVE_CANDIDATE_EVIDENCE=PASS');
