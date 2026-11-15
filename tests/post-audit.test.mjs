import { createCIFixture } from "../scripts/ci-fixture.mjs";
import { workflowTrustCoverage } from "../scripts/workflow-protected-inputs.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, access, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import * as a from '../dist/index.js';
import { createAdmissaryWebServer, FixedWindowRateLimiter } from '../scripts/admissary-web-lib.mjs';
import { fixtureEvidence, completionInput } from '../scripts/remediation-fixtures.mjs';
import { acceptedHistorical, verifyProof } from '../scripts/artifact-integrity.mjs';

const T = '2026-11-14T12:00:00.000Z', NEXT = '2026-11-14T12:01:00.000Z';
const hash = x => a.digestCanonicalJson(x);
const key = generateKeyPairSync('ed25519');
const pub = key.publicKey.export({type:'spki',format:'pem'}).toString();
const priv = key.privateKey.export({type:'pkcs8',format:'pem'}).toString();
const trust = { fixture: pub };
async function fixture() {
  const repo = new a.MemoryProductRepository(), ar = new a.MemoryAssuranceRepository();
  const assurance = new a.ContinuousAssuranceService(ar);
  const api = new a.ProductApplicationService(repo, assurance, async(r,c,k) => fixtureEvidence(c,k), trust);
  await api.registerContract({contractId:'fixture',version:'1',digest:hash('contract'),workloadId:'banking',environmentId:'test',actorId:'system',occurredAt:T});
  const createRun = async (id, rev) => {
    await api.registerCandidate({candidateId:id,displayName:id,provider:'FIXTURE',repositoryOrModelId:`fixture/${id}`,revision:rev.repeat(40),tokenizerRevision:'b'.repeat(40),artifactManifestDigest:hash(id),actorId:'system',occurredAt:T});
    const r = await api.startQualification({candidateId:id,contractId:'fixture',contractVersion:'1',actorId:'system',requestedAt:T,reason:'explicit fixture'});
    const s = await repo.read(), e = fixtureEvidence(s.candidates.find(c=>c.candidateId===id),s.contracts[0]);
    await api.completeQualification({runId:r.runId,...completionInput(e),actorId:'system',completedAt:T});
    return r;
  };
  const run = await createRun('first','a');
  await api.createDeployment({deploymentId:'target',runId:run.runId,actorId:'system',createdAt:T,maxEvidenceAgeMs:3600000});
  const issue = async (deploymentId='target') => {
    const d = (await assurance.state()).deployments.find(d=>d.deploymentId===deploymentId);
    const ctx = a.currentProofContext(d);
    const { schema: ignored, ...contextPayload } = ctx;
    const m = a.buildQualificationManifest({ ...contextPayload, schema: 'qualification-manifest/v1', qualification:{state:'QUALIFIED'},authorization:{state:'APPROVED'},validity:{state:'CURRENT'} });
    return a.signQualificationAttestation({statement:a.buildQualificationAttestationStatement({manifest:m,deploymentContext:ctx,exactArtifactBindingProven:true,issuedAt:T,keyId:'fixture',operationalScope:{deploymentId,qualificationRunId:d.qualificationRunId,environmentId:d.identity.environmentId,workloadId:d.identity.workloadId}}),privateKeyPem:priv,keyId:'fixture'});
  };
  const approve = async () => api.approveDeployment({deploymentId:'target',actorId:'approver',issuedAt:T,expiresAt:null,reason:'fixture'});
  return {api,repo,ar,assurance,run,createRun,issue,approve};
}

test('C-01 obsolete attestation cannot combine with fresh replacement authority', async () => {
  const f = await fixture(); await f.approve();
  const old = await f.issue(); const oldContext = a.currentProofContext((await f.assurance.state()).deployments[0]);
  await f.api.recordAttestation({deploymentId:'target',attestation:old,actorId:'admin',recordedAt:T});
  await f.api.createDeployment({deploymentId:'incident',runId:f.run.runId,actorId:'system',createdAt:T,maxEvidenceAgeMs:3600000});
  const replacement = await f.createRun('replacement','c');
  const newCandidate = (await f.repo.read()).candidates.find(c=>c.candidateId==='replacement');
  const changed = {...(await f.assurance.state()).deployments[0].identity,candidateRepository:newCandidate.repositoryOrModelId,candidateRevision:newCandidate.revision,artifactManifestDigest:newCandidate.artifactManifestDigest};
  const {reassessment} = await f.assurance.recordMaterialChange({deploymentId:'target',checkedAt:T,comparison:{outcome:'MATERIAL_CHANGE',changes:['REPOSITORY_REVISION'],invalidatedNodes:['source:artifact'],previousSnapshotDigest:hash('old'),currentSnapshotDigest:hash('new')},nextIdentity:changed,reason:'controlled drift'});
  const r = await f.api.run(replacement.runId);
  await f.assurance.completeReassessment({deploymentId:'target',requestId:reassessment.requestId,replacementQualificationRunId:r.runId,qualificationState:r.qualificationState,exactArtifactBindingProven:true,evidenceGraphRootDigest:r.evidenceGraphRootDigest,completedAt:T});
  await f.approve();
  assert.equal(await f.api.contextMatchesCurrent('target',oldContext),false,'OLD_CONTEXT_AFTER_REASSESSMENT=DENY');
  assert.equal(await f.api.getAttestation('target'),null,'OLD_ATTESTATION_CURRENT_AUTHORITY=DENY');
  assert.equal((await f.repo.read()).attestations.length,1,'OLD_ATTESTATION_HISTORY=PRESERVED');
  const audit = await f.api.auditDeployment('target',NEXT);
  assert.equal(audit.qualification.runId,r.runId); assert.equal(audit.exactIdentity.revision,'c'.repeat(40),'AUDIT_CURRENT_IDENTITY=MATCH');
  assert.equal((await f.api.rollbackTargets('incident',NEXT)).length,0,'ROLLBACK_OBSOLETE_ATTESTATION=EXCLUDED');
  await assert.rejects(f.api.recordAttestation({deploymentId:'target',attestation:old,actorId:'admin',recordedAt:T}));
  const fresh = await f.issue();
  await f.api.recordAttestation({deploymentId:'target',attestation:fresh,actorId:'admin',recordedAt:T});
  assert.ok(await f.api.getAttestation('target'));
  const split=await f.assurance.state();split.deployments[0].qualificationRunId='missing-replacement';
  const product=await f.repo.read(), decision=await f.assurance.decision('target',NEXT);
  assert.throws(()=>a.buildDeploymentAudit({product,assurance:split,deploymentId:'target',decision,rollbackTargets:[]}),/CURRENT_PROOF_IDENTITY_MISMATCH/);
  assert.equal(a.verifyHistoricalAttestationProof({attestation:fresh,operationalScope:await f.api.currentOperationalScope('target'),currentContext:a.currentProofContext((await f.assurance.state()).deployments[0]),trustStore:trust}).allowed,true);
});

test('H-01 unregistered completion evidence and fabricated exact binding reject', async()=>{
  const f=await fixture(); const plain=new a.ProductApplicationService(f.repo,f.assurance);
  const r=await plain.startQualification({candidateId:'first',contractId:'fixture',contractVersion:'1',actorId:'x',requestedAt:NEXT,reason:'untrusted'});
  await assert.rejects(plain.completeQualification({runId:r.runId,qualificationState:'QUALIFIED',blockers:[],exactArtifactBindingProven:true,evidenceGraphRootDigest:'invented',sourceRefs:['file:///missing'],completedAt:NEXT}),/registered content-addressed evidence/);
});
test('H-05 both qualification entry points reject every invalid runtime evidence state',()=>{
  const plan={contractId:'x',contractVersion:'1',evaluationSuite:'s',obligations:[{id:'x',kind:'DETERMINISTIC',criticality:'MANDATORY'}]};
  for(const state of [null,false,0,'BOGUS',undefined,{},[]]) {
    const r={obligationId:'x',kind:'DETERMINISTIC',criticality:'MANDATORY',state};
    assert.throws(()=>a.decideQualification([r])); assert.throws(()=>a.deriveQualificationWithCoverage(plan,[r]));
  }
});
test('H-02 malformed evidence ages reject in domain and durable loaders',async()=>{
  const f=await fixture();
  for(const age of ['never',null,undefined,NaN,Infinity,-1,0,{},[]]) {
    await assert.rejects(f.api.createDeployment({deploymentId:'bad',runId:f.run.runId,actorId:'x',createdAt:T,maxEvidenceAgeMs:age}));
    const s=await f.ar.read();s.deployments[0].monitoringPolicy.maxEvidenceAgeMs=age;
    assert.throws(()=>new a.MemoryAssuranceRepository(s));
  }
});
test('M-02 approval interval denies before effective time and at expiry',async()=>{
  const f=await fixture();
  await f.api.approveDeployment({deploymentId:'target',actorId:'approver',issuedAt:NEXT,expiresAt:'2026-11-14T12:02:00.000Z',reason:'interval'});
  assert.equal((await f.assurance.decision('target',T)).allowed,false);
  assert.equal((await f.assurance.decision('target',NEXT)).allowed,true);
  assert.equal((await f.assurance.decision('target','2026-11-14T12:02:00.000Z')).allowed,false);
});
test('H-07 and M-10 append order governs revocation and finalization is privileged',async()=>{
  const repo=new a.MemoryPersistenceRepository(),s=new a.QualificationHistoryService(repo);
  const record={runId:'r',contractId:'c',contractVersion:'1',contractDigest:hash('c'),candidateIdentity:'fixture/model',qualificationState:'QUALIFIED',graphRootDigest:hash('g'),exactArtifactBindingProven:true,finalizedAt:T,sourceArtifactDigest:hash('source')};
  for(const role of ['VIEWER','OPERATOR','APPROVER','ADMISSION']) await assert.rejects(s.finalizeQualificationRun({record,actor:{id:role,roles:[role]}}),e=>e.code==='AUTH_FORBIDDEN');
  await s.finalizeQualificationRun({record,actor:{id:'system',roles:['SYSTEM']}});
  await s.approve({runId:'r',actor:{id:'a',roles:['APPROVER']},occurredAt:NEXT,reason:'approval'});
  await s.revoke({runId:'r',actor:{id:'a',roles:['APPROVER']},occurredAt:T,reason:'backdated metadata'});
  assert.equal((await s.deploymentDecision('r')).allowed,false);
});
test('M-01 wrong operational attestation scope and substituted approval reject',async()=>{
  const f=await fixture();await f.approve();const signed=await f.issue();
  for(const field of ['deploymentId','qualificationRunId','environmentId','workloadId']) {
    const st=structuredClone(signed.statement);st.predicate.operationalScope[field]='wrong';
    const att=a.signQualificationAttestation({statement:st,privateKeyPem:priv,keyId:'fixture'});
    await assert.rejects(f.api.recordAttestation({deploymentId:'target',attestation:att,actorId:'admin',recordedAt:T}));
  }
  // Invalid persisted references reject; valid but substituted existing scope denies.
  await assert.rejects(f.ar.transact(s=>{s.approvals[0].scope.workloadId='wrong';}), /active approval scope/);
});
test('M-03 canonical loss is rejected for non-JSON objects and hidden state',()=>{
  const hidden={};Object.defineProperty(hidden,'x',{value:1});
  const symbol={};symbol[Symbol('x')]=1;
  const getter={get x(){throw new Error('must never execute getter')}};
  for(const value of [new Date(),new Map(),new Set(),new(class X{constructor(){this.x=1}})(),hidden,symbol,getter,Array(2),[1,,2],Object.assign([1],{extra:2})]) assert.throws(()=>a.canonicalJson(value));
});
test('M-04 SERV truncation, wrong model and quote extensions reject',async()=>{
  const finding={result:'SUPPORTED',evidence_ids:['E1'],evidence_quotes:[{evidence_id:'E1',quote:'permitted'}],explanation:'fixture',uncertainties:[]};
  for(const envelope of [{model:'gpt-5.6-luna',choices:[{finish_reason:'length',message:{role:'assistant',content:JSON.stringify(finding)}}]},{model:'unexpected',choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(finding)}}]}]) {
    const client=new a.ServSemanticClient({apiKey:'fixture',retryAttempts:1,fetchImpl:async()=>Response.json(envelope)});
    await assert.rejects(client.evaluate({controlId:'x',question:'x',deployment:{},evidence:[{id:'E1',text:'permitted'}]}));
  }
  finding.evidence_quotes[0].authority='ALLOW';assert.throws(()=>a.parseServSemanticFinding(finding,[{id:'E1',text:'permitted'}]));
});
test('M-05 exact HF revision and repository identity cannot be relabeled',async()=>{
  for(const metadata of [{id:'fixture/model',sha:'b'.repeat(40),siblings:[{rfilename:'config.json'}]},{id:'wrong/model',sha:'a'.repeat(40),siblings:[{rfilename:'config.json'}]}]) {
    const collector=new a.HuggingFaceEvidenceCollector({retryAttempts:1,fetchImpl:async()=>Response.json(metadata)});
    await assert.rejects(collector.collect('fixture/model','a'.repeat(40)));
  }
});
test('M-06 generic raw output and mutated pack cannot bypass scoring',async()=>{
  const pack=JSON.parse(await readFile('data/workloads/release-risk-triage-v1.workload.json','utf8'));
  const results=pack.cases.map(c=>({caseId:c.id,schemaValid:true,output:{...c.expected,unauthorized:'extra'},latencyMs:1}));
  const score=a.scoreWorkloadPack(pack,results);
  assert.equal(score.metrics.find(m=>m.scorer==='schema_validity').observed,0);
  const changed=structuredClone(pack);changed.metrics[0].threshold.value=0;assert.throws(()=>a.scoreWorkloadPack(changed,results));
});
test('M-07 suite rebinding rejects before graph construction',async()=>{
  const run=JSON.parse(await readFile(await acceptedHistorical('ADMISSARY_R5_DOLPHIN_'),'utf8'));
  const contract=a.parseDeploymentContract(JSON.parse(await readFile('data/contracts/banking-support-prod.v1.json','utf8')));
  assert.throws(()=>a.buildR5EmpiricalWorkflowSpecs({contractDigest:hash(contract),suiteDigest:hash('different'),run,plan:a.compileContract(contract)}),/must match/);
  const workloadPack=JSON.parse(await readFile('data/workloads/banking-routing-v1.workload.json','utf8'));
  const evaluationSuite=JSON.parse(await readFile('data/banking77/banking-routing-v1.json','utf8'));
  const bound={contractDigest:hash(contract),suiteDigest:run.suiteDigest,run,plan:a.compileContract(contract,run.suiteDigest),workloadPack,evaluationSuite};
  assert.doesNotThrow(()=>a.buildR5EmpiricalWorkflowSpecs(bound));
  assert.throws(()=>a.buildR5EmpiricalWorkflowSpecs({...bound,plan:{...bound.plan,evaluationDigest:hash('other')}}));
  const {packDigest: ignored,...packInput}=workloadPack;
  assert.throws(()=>a.buildR5EmpiricalWorkflowSpecs({...bound,workloadPack:a.buildWorkloadPack({...packInput,legacyBinding:{...packInput.legacyBinding,suiteDigest:hash('other')}})}));
  const altered=structuredClone(packInput);altered.cases[0].input.text='changed workload';
  assert.throws(()=>a.buildR5EmpiricalWorkflowSpecs({...bound,workloadPack:a.buildWorkloadPack(altered)}));
});
test('M-08 every durable loader rejects malformed collections and relationships',async()=>{
  const pairs=[[a.JsonProductRepository,a.emptyProductApplicationState()],[a.JsonAssuranceRepository,a.emptyContinuousAssuranceState()],[a.JsonRegistryRepository,a.emptyModelRegistryState()],[a.JsonFilePersistenceRepository,a.emptyPersistenceState()]];
  const dir=await mkdtemp(join(tmpdir(),'admissary-state-'));
  try { for(const [Repository,s] of pairs){const key=Object.keys(s).find(k=>Array.isArray(s[k]));s[key]={};const path=join(dir,`${key}.json`);await writeFile(path,JSON.stringify(s));await assert.rejects(new Repository(path).read());} }finally{await rm(dir,{recursive:true,force:true});}
});
test('M-11 actual workflow covers the complete trust-bearing input set and generated current authority paths',async()=>{
  const coverage=await workflowTrustCoverage();assert.deepEqual(coverage.uncovered,[]);assert.equal(coverage.currentFixtureGenerated,true);assert.equal(coverage.currentInputsConfigured,true);
});
test('M-12 upstream digest-shaped garbage rejects and accepted historical bytes verify',async()=>{
  await acceptedHistorical('ADMISSARY_R2_HF_EVIDENCE_');await acceptedHistorical('ADMISSARY_R3_SERV_EVIDENCE_');
  for(const key of ['proofDigest','portfolioDigest','auditDigest'])assert.throws(()=>verifyProof({schema:'fixture',value:1,[key]:'0'.repeat(64)},key,'fixture'));
});
test('I-02 historical summary fidelity stays limited to preserved fields',async()=>{
  const summary=JSON.parse(await readFile(await acceptedHistorical('ADMISSARY_R2_HF_EVIDENCE_'),'utf8'));
  for(const target of summary.targets){assert.equal(typeof target.config,'boolean');assert.equal(typeof target.modelCard,'boolean');assert.equal(target.fileManifest,undefined);assert.match(target.bundleDigest,/^[a-f0-9]{64}$/);}
  assert.equal(summary.targets.find(x=>x.repository==='sgugger/custom-resnet50d').remoteCode.state,'REQUIRED');
});
test('L-02 scenarios explicitly describe composition, not measured primitive execution',async()=>{
  const source=await readFile('src/scenarios/canonical-cases.ts','utf8');
  assert.ok(!source.includes('JSON.stringify(\n        item.primitives'));
});
test('L-03 production requires validated PostgreSQL persistence',async()=>{
  const {openProductionDatabase}=await import('../scripts/postgres-state.mjs');
  await assert.rejects(openProductionDatabase(undefined,{}),/Production requires DATABASE_URL/);
});
test('L-04 Ed448 and expanded authority-bearing attestation schema reject',async()=>{
  const f=await fixture();await f.approve();const att=await f.issue();
  const ed448=generateKeyPairSync('ed448');
  assert.throws(()=>a.signQualificationAttestation({statement:att.statement,privateKeyPem:ed448.privateKey.export({type:'pkcs8',format:'pem'}).toString(),keyId:'fixture'}));
  for(const mutate of [s=>s._type='unexpected',s=>s.predicateType='unexpected',s=>s.subject.push(s.subject[0]),s=>s.predicate.authority='ALLOW']){const st=structuredClone(att.statement);mutate(st);assert.throws(()=>a.signQualificationAttestation({statement:st,privateKeyPem:priv,keyId:'fixture'}));}
});
test('I-01 cross-instance writers conflict without losing committed state and locks release',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'admissary-lock-'));const path=join(dir,'state.json');
  const one=new a.JsonProductRepository(path),two=new a.JsonProductRepository(path);
  let enter,finish;const entered=new Promise(r=>enter=r),blocked=new Promise(r=>finish=r);
  try{
    const first=one.transact(async s=>{enter();await blocked;s.events.push({eventId:'one',occurredAt:T,actorId:'fixture',type:'QUALIFICATION_REQUESTED',subjectId:'one',detail:'fixture'});});
    await entered;await assert.rejects(two.transact(()=>{}),e=>e.code==='STATE_WRITE_CONFLICT');finish();await first;
    await two.transact(s=>s.events.push({eventId:'two',occurredAt:T,actorId:'fixture',type:'QUALIFICATION_REQUESTED',subjectId:'two',detail:'fixture'}));
    assert.equal((await new a.JsonProductRepository(path).read()).events.length,2);
    await assert.rejects(one.transact(()=>{throw new Error('abort')}));await one.transact(()=>{});
    await writeFile(`${path}.lock`,'abandoned fixture');await assert.rejects(two.transact(()=>{}),e=>e.code==='STATE_WRITE_CONFLICT');
    // Exclusive maintenance recovery: both writers quiescent, abandoned fixture removed.
    await rm(`${path}.lock`);await two.transact(()=>{});
  }finally{finish();await rm(dir,{recursive:true,force:true});}
});

async function serverFixture(options={}) {
  const dir=await mkdtemp(join(tmpdir(),'admissary-http-'));
  const s=createAdmissaryWebServer({productStatePath:join(dir,'product.json'),productAssuranceStatePath:join(dir,'assurance.json'),authTokens:{fixture:'OPERATOR'},...options});
  await new Promise(r=>s.listen(0,'127.0.0.1',r));
  return {s,base:`http://127.0.0.1:${s.address().port}`,close:async()=>{s.closeAllConnections();await new Promise(r=>s.close(r));await rm(dir,{recursive:true,force:true});}};
}
test('H-04 malformed raw request never terminates the HTTP process',async()=>{
  const f=await serverFixture();try{
    const response=await new Promise((resolve,reject)=>{const socket=net.connect(f.s.address().port,'127.0.0.1',()=>socket.write('GET http://[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n'));let data='';socket.on('data',x=>data+=x);socket.on('end',()=>resolve(data));socket.on('error',reject);});
    assert.match(response,/400/);assert.equal((await fetch(`${f.base}/health`)).status,200);
  }finally{await f.close();}
});
test('H-06 HTTP caller cannot fabricate a REAL winner',async()=>{
  const f=await serverFixture();try{const res=await fetch(`${f.base}/v1/product/selection`,{method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:JSON.stringify({schema:'admissary-product-selection-request/v1',policy:{},candidates:[{candidateId:'fake',qualificationState:'QUALIFIED',exactArtifactBindingProven:true,provenance:'REAL'}]})});assert.equal(res.status,400);}finally{await f.close();}
});
test('H-01 and H-05 HTTP completion rejects invented proof without mutating the run',async()=>{
  const f=await serverFixture({authTokens:{admin:'ADMIN',operator:'OPERATOR'}});
  const send=async(path,body,token='operator')=>{const r=await fetch(f.base+path,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  try {
    assert.equal((await send('/v1/product/candidates',{schema:'admissary-product-register-candidate/v1',candidateId:'fake',displayName:'fake',provider:'fixture',repositoryOrModelId:'fixture/fake',revision:'main',tokenizerRevision:'main',artifactManifestDigest:'invented',occurredAt:T})).status,201);
    assert.equal((await send('/v1/product/contracts',{schema:'admissary-product-register-contract/v1',contractId:'fake',version:'1',digest:hash('fake'),workloadId:'fixture',environmentId:'fixture',occurredAt:T})).status,201);
    const start=await send('/v1/product/qualifications',{schema:'admissary-product-start-qualification/v1',candidateId:'fake',contractId:'fake',contractVersion:'1',requestedAt:T,reason:'attack fixture'});
    const id=start.body.run.runId;
    for (const state of ['QUALIFIED',null,false,0,'BOGUS']) assert.equal((await send(`/v1/product/qualifications/${id}/complete`,{schema:'admissary-product-complete-qualification/v1',qualificationState:state,blockers:[],exactArtifactBindingProven:true,evidenceGraphRootDigest:'invented',policyDigest:'invented',evaluationDigest:'invented',sourceRefs:['file:///missing'],completedAt:T},'admin')).status,400);
    const run=await fetch(`${f.base}/v1/product/qualifications/${id}`,{headers:{authorization:'Bearer admin'}}).then(r=>r.json());
    assert.equal(run.run.status,'REQUESTED');assert.equal(run.run.qualificationState,null);
  }finally{await f.close();}
});
test('H-06 trusted stored fixture metrics can select only a fixture winner',async()=>{
  const f=await fixture();const result=await f.api.select(['first'],{schema:'admissary-candidate-selection-policy/v1',requireExactArtifactBinding:true,allowedProviders:null,maxP95LatencyMs:null,maxCostPerMillionTokensUsd:null,maxModelSizeB:null,objectiveOrder:['p95LatencyMs']});
  assert.equal(result.selectedCandidateId,'first');assert.equal(result.claimScope,'FIXTURE_ONLY');
});
test('M-05 missing file identity headers remain unproven after mutable alias resolution',async()=>{
  const sha='a'.repeat(40);
  const collector=new a.HuggingFaceEvidenceCollector({retryAttempts:1,fetchImpl:async(url,init={})=>String(url).includes('/api/models/')?Response.json({id:'fixture/model',sha,siblings:[{rfilename:'config.json'}]}):new Response(init.method==='HEAD'?null:'{}')});
  const bundle=await collector.collect('fixture/model','main');assert.equal(bundle.resolvedRevision,sha);
  for(const file of bundle.fileManifest.payload){assert.equal(file.repoCommit,null);assert.equal(file.storageIdentity,null);}
});
test('M-01 historical v1 remains cryptographically valid but cannot authorize current scope',async()=>{
  const f=await fixture();await f.approve();const att=await f.issue();const st=structuredClone(att.statement);delete st.predicate.operationalScope;st.predicateType='https://admissary.dev/attestation/qualification/v1';
  const old=a.signQualificationAttestation({statement:st,privateKeyPem:priv,keyId:'fixture'});
  assert.equal(a.verifySignedQualificationAttestation(old,trust).valid,true);
  const context=a.currentProofContext((await f.assurance.state()).deployments[0]);
  assert.equal(a.verifyHistoricalAttestationProof({attestation:old,currentContext:context,operationalScope:await f.api.currentOperationalScope('target'),trustStore:trust}).allowed,false);
  for(const field of ['deploymentId','qualificationRunId','environmentId','workloadId']){const scope=await f.api.currentOperationalScope('target');scope[field]='wrong';assert.equal(a.verifyHistoricalAttestationProof({attestation:att,currentContext:context,operationalScope:scope,trustStore:trust}).allowed,false);}
});
test('M-09 corrupt Judge View cannot serve truth or remain ready',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'admissary-snapshot-'));const path=join(dir,'snapshot.json');const value=JSON.parse(await readFile('web/demo-snapshot.json','utf8'));value.candidate.overallQualification='QUALIFIED';value.candidate.deployAllowed=true;await writeFile(path,JSON.stringify(value));
  const f=await serverFixture({snapshotPath:path});try{for(const route of ['/v1/product/judge-view','/ready'])assert.equal((await fetch(f.base+route)).status,500);}finally{await f.close();await rm(dir,{recursive:true,force:true});}
});
test('L-01 decoded-equivalent routes share one bounded limiter bucket',async()=>{
  const state=await fixture(),dir=await mkdtemp(join(tmpdir(),'admissary-route-'));
  await writeFile(join(dir,'product.json'),JSON.stringify(await state.repo.read()));await writeFile(join(dir,'assurance.json'),JSON.stringify(await state.ar.read()));
  const f=await serverFixture({productStatePath:join(dir,'product.json'),productAssuranceStatePath:join(dir,'assurance.json'),rateLimit:{windowMs:60000,max:1}});
  try{
    const headers={authorization:'Bearer fixture'};
    assert.equal((await fetch(`${f.base}/v1/product/deployments/target`,{headers})).status,200);
    assert.equal((await fetch(`${f.base}/v1/product/deployments/%74arget`,{headers})).status,429);
    assert.equal((await fetch(`${f.base}/v1/product/deployments/%2574arget`,{headers})).status,404,'literal percent ID is not decoded twice into target');
    assert.equal((await fetch(`${f.base}/v1/product/deployments/%ZZ`,{headers})).status,400);
  }finally{await f.close();await rm(dir,{recursive:true,force:true});}
  const limiter=new FixedWindowRateLimiter({windowMs:60000,max:1});
  for(let i=0;i<6000;i++)limiter.consume(`resource-${i}`);assert.ok(limiter.entries.size<=4097);
  for(const entry of limiter.entries.values())entry.resetAt=Date.now()-1;
  limiter.consume('fresh');assert.equal(limiter.entries.size,1);
});
test('H-03 actual Action env arguments cannot convert current-authority DENY to success',async()=>{
  const text=(await readFile('action.yml','utf8')).replaceAll('\r','');const shell=text.slice(text.indexOf('      run: |',text.indexOf('id: admission'))+13).split('\n').map(l=>l.replace(/^        /,'')).join('\n');assert.ok(!shell.includes('${{'));
  const dir=await mkdtemp(join(tmpdir(),'admissary action ')), f=await createCIFixture(dir);
  const environment={...process.env,ADMISSARY_ACTION_PATH:process.cwd().replaceAll('\\','/'),ADMISSARY_WORKSPACE:dir.replaceAll('\\','/'),ADMISSARY_PRODUCT_STATE:'product.json',ADMISSARY_ASSURANCE_STATE:'assurance.json',ADMISSARY_TRUST_STORE:'public-trust.json',ADMISSARY_DEPLOYMENT_ID:f.deploymentId,ADMISSARY_CONTEXT:'context.json',ADMISSARY_REPORT:'report with spaces.json'};
  const execute=overrides=>spawnSync(process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash',['-e','-o','pipefail','-c',shell],{encoding:'utf8',env:{...environment,...overrides}});
  try{
    const positive=execute({});assert.equal(positive.status,0,positive.stderr);assert.equal(JSON.parse(await readFile(join(dir,environment.ADMISSARY_REPORT),'utf8')).decision,'ALLOW');
    for(const payload of ['" || true #',"'",'spaces in path','; true','| true','&& true','|| true','# comment','$(true)','`true`','line\nbreak']) {
      const result=execute({ADMISSARY_CONTEXT:`missing${payload}`});assert.equal(result.error,undefined);assert.notEqual(result.status,0);assert.equal(JSON.parse(await readFile(join(dir,environment.ADMISSARY_REPORT),'utf8')).decision,'DENY');
    }
    const context=structuredClone(f.context);context.candidate.revision='changed';await writeFile(join(dir,'changed context.json'),JSON.stringify(context));
    const exactPayload=execute({ADMISSARY_CONTEXT:'changed context.json',ADMISSARY_REPORT:'denied-report.json" || true #'});assert.notEqual(exactPayload.status,0);assert.match(exactPayload.stdout,/ADMISSARY_CI_DECISION=DENY/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
