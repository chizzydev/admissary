import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { digestCanonicalJson } from '../dist/index.js';
import { readProof, acceptedHistorical } from './artifact-integrity.mjs';
import { liveCandidateRecords } from './live-candidate-evidence.mjs';
const liveRecords=await liveCandidateRecords();

await mkdir('results/r11r1', {recursive:true});
const run=spawnSync(process.execPath,['--test','--test-reporter=tap','tests/post-audit.test.mjs'],{encoding:'utf8',timeout:120000});
await writeFile('results/r11r1/REGRESSION_OUTPUT.tap',run.stdout+run.stderr);
assert.equal(run.error,undefined);assert.equal(run.status,0,run.stdout+run.stderr);
assert.ok(!/^not ok /m.test(run.stdout));assert.ok(!/^# (?:skipped|cancelled) [1-9]/m.test(run.stdout));
const passed=[...run.stdout.matchAll(/^ok \d+ - (.+)$/gm)].map(m=>m[1]);
const expected=['C-01',...Array.from({length:7},(_,i)=>`H-${String(i+1).padStart(2,'0')}`),...Array.from({length:12},(_,i)=>`M-${String(i+1).padStart(2,'0')}`),...Array.from({length:4},(_,i)=>`L-${String(i+1).padStart(2,'0')}`),'I-01','I-02'];
const closures=expected.map(id=>{const tests=passed.filter(name=>name.includes(id));assert.ok(tests.length,`${id} has no passing regression`);return {id,state:'PASS',tests};});

await acceptedHistorical('ADMISSARY_R2_HF_EVIDENCE_');await acceptedHistorical('ADMISSARY_R3_SERV_EVIDENCE_');
const judge=await readProof('web/demo-snapshot.json','snapshotDigest','admissary-judge-view/v1');
const c3=await readProof('results/ADMISSARY_R10C3_CONTINUOUS_ASSURANCE_PROOF.json','proofDigest','admissary-r10c3-continuous-assurance-proof/v1');
const c4=await readProof('results/ADMISSARY_R10C4_DECISION_WORKSPACE_PROOF.json','proofDigest','admissary-r10c4-decision-workspace-proof/v1');
const c5=await readProof('results/ADMISSARY_R10C5_PRODUCT_API_PROOF.json','proofDigest','admissary-r10c5-product-api-proof/v1');
const portfolio=await readProof('results/ADMISSARY_R10D_SCENARIO_PROOF.json','portfolioDigest','admissary-canonical-case-portfolio/v1');
const audit=await readProof('results/ADMISSARY_R10D_CASE_D_AUDIT_PROOF.json','auditDigest','admissary-product-deployment-audit/v1');
assert.equal(c4.assuranceProofDigest,c3.proofDigest);
assert.equal(judge.candidate.empiricalFitness,'UNFIT');assert.equal(judge.candidate.overallQualification,'REVIEW_REQUIRED');assert.equal(judge.candidate.deployAllowed,false);
for(const id of ['candidate-gemma4-nvfp4','candidate-qwen36-nvfp4']) {
  const live=liveRecords.find(r=>r.target.candidateId===id);
  assert.ok(c4.selection.excluded.find(x=>x.candidateId===id)?.reasons.includes(`QUALIFICATION_${live?.qualificationState??'INCOMPLETE'}`));
  if(live)assert.equal(c4.realCandidateStates.find(c=>c.candidateId===id).qualificationState,live.qualificationState);
}
assert.equal(c4.selection.claimScope,'FIXTURE_ONLY');assert.equal(c5.realDeepSeekDeployAllowed,false);
const caseD=portfolio.cases.find(x=>x.id==='CASE_D');assert.equal(caseD.facts.historicalAttestationCryptographicallyValid,true);assert.equal(caseD.facts.currentAuthorityAllowed,false);assert.equal(caseD.facts.auditDigest,audit.auditDigest);
assert.equal(portfolio.primitiveClaim,'COMPOSITION_VOCABULARY_ONLY');assert.equal(audit.decision.allowed,false);
assert.equal(judge.candidates.find(x=>x.id==='hf-custom-resnet50d').qualificationState,'DISQUALIFIED');
assert.equal(c3.controlledLocalHuggingFace.networkCalls,0);assert.equal(c3.liveHuggingFace.evidenceMode,'STORED_HISTORICAL_SUMMARY');
const proof={schema:'admissary-r11r1-post-audit-remediation/v1',generatedAt:new Date().toISOString(),matrix:closures,regressionTests:passed.length,
  canonicalTruth:{deepSeekEmpirical:'UNFIT',deepSeekOverall:'REVIEW_REQUIRED',deepSeekDeploy:'DENY',gemma:liveRecords.find(r=>r.target.slug==='gemma')?.qualificationState??'INCOMPLETE / NOT_EVALUATED',qwen:liveRecords.find(r=>r.target.slug==='qwen')?.qualificationState??'INCOMPLETE / NOT_EVALUATED',remoteCode:'DISQUALIFIED',positiveSelection:'FIXTURE_ONLY',historicalCaseDCrypto:true,currentCaseDAuthority:false},
  evidence:{judge:judge.snapshotDigest,assurance:c3.proofDigest,selection:c4.proofDigest,product:c5.proofDigest,portfolio:portfolio.portfolioDigest,audit:audit.auditDigest},
  externalVerificationCalls:0,servCalls:0,dolphinCalls:0};
proof.proofDigest=digestCanonicalJson(proof);
await writeFile('results/ADMISSARY_R11R1_POST_AUDIT_REMEDIATION_PROOF.json',JSON.stringify(proof,null,2)+'\n');
for(const closure of closures)console.log(`R11R1_${closure.id}=PASS (${closure.tests.length} regression assertions)`);
console.log(`R11R1_REGRESSION_TESTS=${passed.length}`);
console.log(`R11R1_PROOF_DIGEST=${proof.proofDigest}`);
console.log('R11R1_POST_AUDIT_REMEDIATION=PASS');
