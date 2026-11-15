// Explicit local acceptance step for the captured runs; never makes a provider request.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { LIVE_CANDIDATES, liveCandidateRecords } from './live-candidate-evidence.mjs';
import { digestCanonicalJson } from '../dist/index.js';
const sha=b=>createHash('sha256').update(b).digest('hex');
const candidates=[];
const frozen=JSON.parse(await readFile('data/r13-frozen-inputs.json','utf8'));
const catalog=JSON.parse(await readFile('results/r13/catalog.json','utf8'));
for(const target of LIVE_CANDIDATES){
  const summaryPath=`results/r13/${target.slug}-summary.json`,bytes=await readFile(summaryPath),summary=JSON.parse(bytes);
  assert.equal(summary.model,target.model);assert.equal(summary.candidateId,target.candidateId);
  let partialBinding={};
  if(summary.completionStatus!=='COMPLETED'){
    let checkpoint=null;try{checkpoint=JSON.parse(await readFile(`results/r13/${target.slug}-checkpoint.json`,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    const cases=checkpoint?.cases??[];assert.equal(cases.length,summary.casesCompleted);
    const payload={schema:'admissary-r13-partial-provider-execution/v1',provenance:cases.length?'REAL_DOLPHIN_EXECUTION':'REAL_PROVIDER_STATUS_NO_EXECUTION',model:target.model,candidateId:target.candidateId,executionPerformed:cases.length>0,completionStatus:summary.completionStatus,casesCompleted:cases.length,expectedCaseCount:144,suiteDigest:frozen.suiteDigest,promptProtocol:frozen.protocol,promptDigest:frozen.promptDigest,generationDigest:frozen.generationDigest,generationConfig:frozen.generationConfig,modelCatalogDigest:catalog.catalog.digest,providerBindingScope:'PROVIDER_MODEL_IDENTITY',exactArtifactBindingProven:false,metrics:null,cases,startedAt:summary.startedAt??null,stoppedAt:summary.stoppedAt??null,providerError:summary.error??null,incompleteReason:summary.completionStatus};
    const executionDigest=digestCanonicalJson(payload),partial={...payload,executionDigest},partialArtifactPath=`results/r13/${target.slug}-partial-${executionDigest}.json`;
    await writeFile(partialArtifactPath,JSON.stringify(partial,null,2)+'\n');
    partialBinding={partialArtifactPath,partialArtifactSHA256:sha(await readFile(partialArtifactPath))};
  }
  candidates.push({...target,summaryPath,summarySHA256:sha(bytes),...(summary.completionStatus==='COMPLETED'?{artifactPath:summary.artifactPath,artifactSHA256:sha(await readFile(summary.artifactPath))}:partialBinding)});
}
const index={schema:'admissary-r13-accepted-evidence/v1',candidates};
await writeFile('data/r13-accepted-evidence.json',JSON.stringify(index,null,2)+'\n');
const records=await liveCandidateRecords();assert.equal(records.length,2);
for(const r of records){
  const qualification={schema:'admissary-r13-real-qualification/v1',candidateId:r.target.candidateId,model:r.target.model,provenance:r.partial?.provenance??'REAL_DOLPHIN_EXECUTION',completionStatus:r.summary.completionStatus,casesCompleted:r.summary.casesCompleted,empiricalFitness:r.empiricalFitness,fullQualification:r.qualificationState,decision:r.decision??null,providerBindingScope:'PROVIDER_MODEL_IDENTITY',exactArtifactBindingProven:false,deploymentAllowed:false,sourceArtifact:r.summary.artifactPath??`results/r13/${r.target.slug}-partial-${r.partial.executionDigest}.json`,sourceRunDigest:r.raw?.runDigest??null,sourceExecutionDigest:r.partial?.executionDigest??null,blockers:r.blockers,unresolvedCandidateSpecificEvidence:['license and permitted use','remote repository code','semantic controls','runtime artifact revision','runtime tokenizer revision','artifact manifest'],servCalls:0,servOmissionReason:'No truthful exact repository/runtime mapping or candidate-specific persisted semantic evidence; SERV interpretation cannot establish missing identity.'};
  const proof={...qualification,proofDigest:digestCanonicalJson(qualification)};
  await writeFile(`results/r13/${r.target.slug}-qualification.json`,JSON.stringify(proof,null,2)+'\n');
  console.log(`${r.target.slug.toUpperCase()}=${r.empiricalFitness}/${r.qualificationState}/DENY`);
}
console.log('R13_LOCAL_EVIDENCE_SEAL=PASS');
