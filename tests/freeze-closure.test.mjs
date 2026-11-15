import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as a from '../dist/index.js';
import { createCIFixture } from '../scripts/ci-fixture.mjs';
import { fixtureEvidence, completionInput } from '../scripts/remediation-fixtures.mjs';
import { workflowTrustCoverage } from '../scripts/workflow-protected-inputs.mjs';
import { createAdmissaryWebServer } from '../scripts/admissary-web-lib.mjs';

// Evidence is optional during ordinary unit tests and explicit during the gate.
async function proof(name,value) {
  if (!process.env.ADMISSARY_R11R2_EVIDENCE) return;
  await mkdir(process.env.ADMISSARY_R11R2_EVIDENCE,{recursive:true});
  await writeFile(join(process.env.ADMISSARY_R11R2_EVIDENCE,name+'.json'),JSON.stringify(value,null,2)+'\n');
}
const read=async p=>JSON.parse(await readFile(p,'utf8'));
function ci(f) {
  const run=spawnSync(process.execPath,['scripts/admissary-ci-check.mjs','--product-state',f.productPath,'--assurance-state',f.assurancePath,'--trust-store',f.trustPath,'--deployment-id',f.deploymentId,'--context',f.contextPath,'--report',join(f.dir,'ci-report.json')],{encoding:'utf8'});
  assert.equal(run.error,undefined); return run;
}
async function server(f) {
  const s=createAdmissaryWebServer({mode:'test',snapshotPath:'web/demo-snapshot.json',productStatePath:f.productPath,productAssuranceStatePath:f.assurancePath,completionEvidenceResolver:f.resolver,attestationTrustStore:f.trust,authTokens:{fixtureAdmin:'ADMIN',fixtureAdmission:'ADMISSION',fixtureViewer:'VIEWER',fixtureApprover:'APPROVER'}});
  await new Promise((ok,no)=>{s.once('error',no);s.listen(0,'127.0.0.1',ok);});
  const post=async(path,body,token='fixtureAdmin')=>{
    const response=await fetch(`http://127.0.0.1:${s.address().port}${path}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  };
  return {post,close:async()=>{s.closeAllConnections?.();await new Promise(ok=>s.close(ok));}};
}

test('NEW-01 current CLI and HTTP agree for ALLOW, revoked historical proof, expiry, reassessment and stale evidence',async()=>{
  const outcomes=[];
  for(const scenario of ['CURRENT','REVOKED','EXPIRED','REASSESSMENT_REQUIRED','STALE']) {
    const dir=await mkdtemp(join(tmpdir(),'admissary-ci-authority-')),f=await createCIFixture(dir);
    try {
      assert.equal(ci(f).status,0,'positive control before every mutation');
      if(scenario==='REVOKED')await f.service.revokeDeployment({deploymentId:f.deploymentId,actorId:'fixture',occurredAt:new Date().toISOString(),reason:'Case-D local revocation'});
      if(scenario==='EXPIRED')await f.assuranceRepository.transact(s=>{s.approvals.find(x=>x.approvalId===s.deployments[0].activeApprovalId).expiresAt=new Date(Date.now()-1000).toISOString();});
      if(scenario==='REASSESSMENT_REQUIRED')await f.service.requestRequalification({deploymentId:f.deploymentId,actorId:'fixture',requestedAt:new Date().toISOString(),reason:'Controlled reassessment'});
      if(scenario==='STALE')await f.assuranceRepository.transact(s=>{s.deployments[0].lastSuccessfulCheckAt='2000-01-01T00:00:00.000Z';});
      const run=ci(f),report=await read(join(dir,'ci-report.json'));
      const http=await server(f);let response;
      try{response=await http.post(`/v1/product/deployments/${f.deploymentId}/admission`,{schema:'admissary-current-deployment-admission-request/v1',context:f.context},'fixtureAdmission');}finally{await http.close();}
      assert.equal(report.allowed,scenario==='CURRENT');assert.equal(run.status,scenario==='CURRENT'?0:1,run.stderr+run.stdout);
      assert.equal(response.body.allowed,report.allowed,JSON.stringify(response));
      assert.equal(response.status,scenario==='CURRENT'?200:409);
      const historical=a.verifyHistoricalManifestProofUnknown(f.manifest,f.context);assert.equal(historical.allowed,true);
      if(scenario==='REVOKED')assert.equal(a.verifySignedQualificationAttestation(f.attestation,f.trust).valid,true);
      let action=null;
      if(scenario==='REVOKED'){
        const text=(await readFile('action.yml','utf8')).replaceAll('\r','');
        const shell=text.slice(text.indexOf('      run: |',text.indexOf('id: admission'))+13).split('\n').map(l=>l.replace(/^        /,'')).join('\n');
        const executed=spawnSync(process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash',['-e','-o','pipefail','-c',shell],{encoding:'utf8',env:{...process.env,ADMISSARY_ACTION_PATH:process.cwd().replaceAll('\\','/'),ADMISSARY_WORKSPACE:dir.replaceAll('\\','/'),ADMISSARY_PRODUCT_STATE:'product.json',ADMISSARY_ASSURANCE_STATE:'assurance.json',ADMISSARY_TRUST_STORE:'public-trust.json',ADMISSARY_DEPLOYMENT_ID:f.deploymentId,ADMISSARY_CONTEXT:'context.json',ADMISSARY_REPORT:'action-revoked-report.json'}});
        assert.equal(executed.status,1,executed.stdout+executed.stderr);assert.match(executed.stdout,/ADMISSARY_CI_DECISION=DENY/);action={exit:executed.status,stdout:executed.stdout,report:await read(join(dir,'action-revoked-report.json'))};
      }
      outcomes.push({scenario,exit:run.status,stdout:run.stdout,report,httpStatus:response.status,httpDecision:response.body.decision,historicalProof:'VALID',action,publicTrustStore:f.trust,historicalAttestation:f.attestation,context:f.context});
    }finally{await rm(dir,{recursive:true,force:true});}
  }
  // Rerun the independent reproduction against the actual stored revoked Case D.
  const dir=await mkdtemp(join(tmpdir(),'admissary-stored-case-d-'));
  try{
    const product=await read('results/r10d/product-state.json'),assurance=await read('results/r10d/assurance-state.json');
    const d=product.deployments.find(d=>d.deploymentId==='deployment-r10d-current'),current=assurance.deployments.find(x=>x.deploymentId===d.deploymentId);
    const record=product.attestations.find(x=>x.attestationId===d.attestationId);
    assert.equal(current.lifecycleState,'REVOKED');assert.ok(record);
    const context=a.currentProofContext(current);assert.equal(a.verifyHistoricalManifestProofUnknown(record.attestation.statement.predicate.manifest,context).allowed,true);
    const f={dir,deploymentId:d.deploymentId,productPath:'results/r10d/product-state.json',assurancePath:'results/r10d/assurance-state.json',trustPath:join(dir,'trust.json'),contextPath:join(dir,'context.json')};
    const trust=await read('results/r10d/attestation-trust-store.json');assert.equal(a.verifySignedQualificationAttestation(record.attestation,trust).valid,true);
    await writeFile(f.trustPath,JSON.stringify(trust));await writeFile(f.contextPath,JSON.stringify(context));
    const run=ci(f),report=await read(join(dir,'ci-report.json'));assert.equal(run.status,1);assert.equal(report.decision,'DENY');assert.ok(report.reasonCodes.includes('LIFECYCLE_REVOKED'));
    outcomes.push({scenario:'ACTUAL_STORED_CASE_D',exit:run.status,historicalProof:'VALID',report,stdout:run.stdout,publicTrustStore:trust,historicalAttestation:record.attestation,context});
  }finally{await rm(dir,{recursive:true,force:true});}
  await proof('current-authority-ci',outcomes);
});

test('NEW-02 Product HTTP completes changed-candidate reassessment with fresh approval and attestation only',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'admissary-product-reassessment-')),f=await createCIFixture(dir),http=await server(f),events=[];
  const dep=`/v1/product/deployments/${f.deploymentId}`,at=n=>new Date(Date.now()+n).toISOString();
  async function call(path,body,status=200,token){const r=await http.post(path,body,token);assert.equal(r.status,status,JSON.stringify(r));events.push({path,status:r.status,body:r.body});return r.body;}
  async function admit(context=f.context,allowed=false){const r=await http.post(dep+'/admission',{schema:'admissary-current-deployment-admission-request/v1',context},'fixtureAdmission');assert.equal(r.body.allowed,allowed,JSON.stringify(r));return r.body;}
  try{
    await admit(f.context,true);
    const oldApproval=(await f.assurance.state()).deployments[0].activeApprovalId,oldAtt=(await f.repository.read()).deployments[0].attestationId;
    const c={...f.candidate,candidateId:'ci-replacement',revision:'c'.repeat(40),artifactManifestDigest:a.digestCanonicalJson({replacement:true})};
    await call('/v1/product/candidates',{schema:'admissary-product-register-candidate/v1',...c,occurredAt:at(-5000)},201);
    const nextIdentity={...(await f.assurance.state()).deployments[0].identity,candidateRevision:c.revision,artifactManifestDigest:c.artifactManifestDigest};
    const drift={schema:'admissary-product-material-change/v1',checkedAt:at(-4000),nextIdentity,comparison:{outcome:'MATERIAL_CHANGE',previousSnapshotDigest:'a'.repeat(64),currentSnapshotDigest:'b'.repeat(64),changes:['REPOSITORY_REVISION'],invalidatedNodes:['evidence:artifact']},reason:'Changed immutable candidate fixture'};
    assert.equal((await http.post(dep+'/material-change',drift,'fixtureViewer')).status,403);
    const changed=await call(dep+'/material-change',drift);await admit();
    const request=await call(dep+'/requalification',{schema:'admissary-product-requalification-request/v1',candidateId:c.candidateId,requestedAt:at(-3000),reason:'Replace exact observed candidate'},202);
    const completion={schema:'admissary-product-complete-reassessment/v1',requestId:changed.reassessment.requestId,replacementQualificationRunId:request.run.runId,completedAt:at(-1000)};
    assert.ok((await http.post(dep+'/complete-reassessment',completion)).status>=400,'incomplete replacement cannot reconcile');
    const e=fixtureEvidence(c,f.contract);
    await call(`/v1/product/qualifications/${request.run.runId}/complete`,{schema:'admissary-product-complete-qualification/v1',...completionInput(e),completedAt:at(-2000)});
    assert.ok((await http.post(dep+'/complete-reassessment',{...completion,requestId:'wrong'})).status>=400);
    assert.ok((await http.post(dep+'/complete-reassessment',{...completion,replacementQualificationRunId:f.run.runId})).status>=400);
    assert.equal((await http.post(dep+'/complete-reassessment',completion,'fixtureApprover')).status,403);
    await call(dep+'/complete-reassessment',completion);
    const ps=await f.repository.read(),as=await f.assurance.state();
    assert.equal(ps.deployments[0].qualificationRunId,request.run.runId);assert.equal(ps.deployments[0].candidateId,c.candidateId);assert.equal(ps.deployments[0].attestationId,null);
    assert.equal(as.deployments[0].qualificationRunId,request.run.runId);assert.equal(as.deployments[0].identity.candidateRevision,c.revision);assert.equal(as.deployments[0].lifecycleState,'CURRENT');assert.equal(as.deployments[0].activeApprovalId,null);
    assert.ok(ps.attestations.some(x=>x.attestationId===oldAtt));assert.ok(as.approvals.some(x=>x.approvalId===oldApproval));
    const noApproval=await admit();assert.ok(noApproval.currentAuthority.reasons.includes('APPROVAL_NONE'));assert.ok(noApproval.currentAuthority.reasons.includes('ATTESTATION_NOT_RECORDED'));
    await call(dep+'/approve',{schema:'admissary-product-approval-request/v1',issuedAt:at(-500),expiresAt:null,reason:'Fresh exact replacement approval'},200,'fixtureApprover');
    assert.ok((await http.post(dep+'/attestation',{schema:'admissary-product-record-attestation/v1',attestation:f.attestation,recordedAt:at(0)})).status>=400);
    const replacement=await f.signCurrent();await admit(replacement.context);
    await call(dep+'/attestation',{schema:'admissary-product-record-attestation/v1',attestation:replacement.attestation,recordedAt:at(0)},201);
    await admit(replacement.context,true);await admit(f.context,false);
    assert.equal(ci(f).status,0);
    await call(dep+'/complete-reassessment',completion); // same completed operation is idempotent
    const final=await f.repository.read();assert.equal(final.attestations.length,2);assert.notEqual(final.deployments[0].attestationId,oldAtt);
    await proof('product-reassessment',{events,oldApproval,oldAtt,publicTrustStore:f.trust,finalProduct:final,finalAssurance:await f.assurance.state(),restoredAdmission:await f.service.admitCurrentDeployment(f.deploymentId,replacement.context)});
  }finally{await http.close();await rm(dir,{recursive:true,force:true});}
});

test('NEW-03 every enumerated trust-bearing workflow input triggers the admission workflow',async()=>{
  const coverage=await workflowTrustCoverage();assert.deepEqual(coverage.uncovered,[]);assert.equal(coverage.currentFixtureGenerated,true);assert.equal(coverage.currentInputsConfigured,true);
  for(const prefix of ['data/accepted-artifacts.json','data/banking77/','results/','web/'])assert.ok(coverage.inputs.some(x=>x.path.startsWith(prefix)),prefix);
  await proof('workflow-trust-coverage',coverage);
});

test('NEW-04 server chronology preserves cross-source append order despite future and backdated occurrence times',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'admissary-chronology-')),f=await createCIFixture(dir);
  try{
    const identity=(await f.assurance.state()).deployments[0].identity;
    await f.service.recordMaterialChange({deploymentId:f.deploymentId,actorId:'fixture',checkedAt:'2099-01-01T00:00:00.000Z',nextIdentity:identity,comparison:{outcome:'MATERIAL_CHANGE',previousSnapshotDigest:'a'.repeat(64),currentSnapshotDigest:'b'.repeat(64),changes:['CONFIG'],invalidatedNodes:['decision:qualification']},reason:'Future business timestamp fixture'});
    await f.service.revokeDeployment({deploymentId:f.deploymentId,actorId:'fixture',occurredAt:'2000-01-01T00:00:00.000Z',reason:'Backdated revocation fixture'});
    const product=await f.repository.read(),assurance=await f.assurance.state(),decision=await f.assurance.decision(f.deploymentId,new Date().toISOString());
    const audit=a.buildDeploymentAudit({product,assurance,deploymentId:f.deploymentId,decision,rollbackTargets:[]});
    const types=audit.timeline.map(x=>x.type),grant=types.indexOf('APPROVAL_GRANTED'),material=types.indexOf('MATERIAL_CHANGE_DETECTED'),productMaterial=types.indexOf('MATERIAL_CHANGE_RECORDED'),revoke=types.indexOf('APPROVAL_REVOKED');
    assert.ok(grant>=0 && grant<material && material<productMaterial && productMaterial<revoke,types.join(','));
    assert.equal(audit.timeline[revoke].occurredAt,'2000-01-01T00:00:00.000Z');assert.equal(audit.timeline[material].occurredAt,'2099-01-01T00:00:00.000Z');assert.equal(decision.allowed,false);
    for(let i=1;i<audit.timeline.length;i++)assert.ok(audit.timeline[i].recordedAt>audit.timeline[i-1].recordedAt);
    assert.ok(audit.timeline.every(x=>x.orderBasis==='SERVER_RECORDED_TIME'));
    const legacy=structuredClone(product);for(const e of legacy.events){delete e.recordedAt;delete e.appendSequence;}
    const legacyAudit=a.buildDeploymentAudit({product:legacy,assurance,deploymentId:f.deploymentId,decision,rollbackTargets:[]});assert.ok(legacyAudit.timeline.filter(x=>x.source==='PRODUCT').every(x=>x.orderBasis==='LEGACY_APPEND_ORDER_UNPROVEN'&&x.recordedAt===null));
    await proof('audit-chronology',audit);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('NEW-05 durable provisioning recovers every partial boundary and never resets conflicting or revoked authority',async()=>{
  const outcomes=[];
  for(const boundary of ['BEFORE_PRODUCT','AFTER_PRODUCT','BEFORE_ASSURANCE','AFTER_ASSURANCE','BEFORE_ACTIVE','AFTER_ACTIVE']) {
    const dir=await mkdtemp(join(tmpdir(),'admissary-provisioning-')),f=await createCIFixture(dir);
    try {
      const input={...f.createInput,deploymentId:'partial-deployment'},realP=f.repository,realA=f.assuranceRepository;
      let fired=false;
      function wrapper(repo,source){return {read:()=>repo.read(),transact:async fn=>{
        let failAfter=false;
        const result=await repo.transact(async state=>{
          if(!fired&&((boundary==='BEFORE_PRODUCT'&&source==='P')||(boundary==='BEFORE_ASSURANCE'&&source==='A'))) {fired=true;throw new Error('injected crash '+boundary);}
          const value=await fn(state);
          const d=state.deployments.find(x=>x.deploymentId===input.deploymentId);
          if(!fired&&((boundary==='AFTER_PRODUCT'&&source==='P'&&d?.status==='PROVISIONING')||(boundary==='AFTER_ASSURANCE'&&source==='A'&&d)||(boundary==='AFTER_ACTIVE'&&source==='P'&&d?.status==='ACTIVE'))) {fired=true;failAfter=true;}
          if(!fired&&boundary==='BEFORE_ACTIVE'&&source==='P'&&d?.status==='ACTIVE'){fired=true;throw new Error('injected crash '+boundary);}
          return value;
        });
        if(failAfter)throw new Error('injected crash '+boundary);return result;
      }};}
      const service=new a.ProductApplicationService(wrapper(realP,'P'),new a.ContinuousAssuranceService(wrapper(realA,'A')),f.resolver,f.trust);
      await assert.rejects(service.createDeployment(input),/injected crash/);assert.equal(fired,true);
      const partialProduct=await realP.read(),partialAssurance=await realA.read();
      const restarted=new a.ProductApplicationService(new a.JsonProductRepository(f.productPath),new a.ContinuousAssuranceService(new a.JsonAssuranceRepository(f.assurancePath)),f.resolver,f.trust);
      const recovered=await restarted.createDeployment(input);assert.equal(recovered.status,'ACTIVE');assert.equal((await restarted.createDeployment(input)).status,'ACTIVE');
      assert.equal((await realP.read()).deployments.filter(x=>x.deploymentId===input.deploymentId).length,1);assert.equal((await realA.read()).deployments.filter(x=>x.deploymentId===input.deploymentId).length,1);
      await assert.rejects(restarted.createDeployment({...input,maxEvidenceAgeMs:input.maxEvidenceAgeMs+1}),/differs/);
      const stillDenied=await restarted.admitCurrentDeployment(input.deploymentId,f.context);assert.equal(stillDenied.allowed,false,'recovery cannot mint approval or attestation');
      await realA.transact(s=>{s.deployments.find(d=>d.deploymentId===input.deploymentId).identity.candidateRevision='d'.repeat(40);});
      await assert.rejects(restarted.createDeployment(input),/differs/);
      outcomes.push({boundary,partialProductStatus:partialProduct.deployments.find(d=>d.deploymentId===input.deploymentId)?.status??'ABSENT',partialAssurancePresent:partialAssurance.deployments.some(d=>d.deploymentId===input.deploymentId),recovered:recovered.status,conflict:'DENY',withoutApprovalAndAttestation:'DENY'});
      await f.service.revokeDeployment({deploymentId:f.deploymentId,actorId:'fixture',occurredAt:new Date().toISOString(),reason:'Retry must preserve revocation'});
      await f.service.createDeployment(f.createInput);assert.equal((await f.assurance.state()).deployments.find(d=>d.deploymentId===f.deploymentId).lifecycleState,'REVOKED');assert.equal(ci(f).status,1);
    }finally{await rm(dir,{recursive:true,force:true});}
  }
  await proof('provisioning-recovery',outcomes);
});

test('NEW-06 Action regression uses OS temporary directories without a hidden workspace parent',async()=>{
  const source=await readFile('tests/post-audit.test.mjs','utf8');
  assert.ok(source.includes("mkdtemp(join(tmpdir(),'admissary action '))"));assert.ok(!source.includes("mkdtemp(join(process.cwd(),'.remediation/action '))"));
  // Actual clean extraction/build/full-suite verification is mandatory in R11R2.
});
