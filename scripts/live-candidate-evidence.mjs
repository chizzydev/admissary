// Offline, pinned live evidence only. A hosted model ID never proves weights/tokenizer identity.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { acceptedHistorical } from './artifact-integrity.mjs';
import { verifyDolphinRunIntegrity, scoreWorkloadPack, scoreEvaluation, evaluateAllMetricThresholds, parseDolphinIntent, digestCanonicalJson,
  compileContract, parseDeploymentContract, mapDolphinRunToEmpiricalResults,
  deriveQualificationWithCoverage, deriveEmpiricalFitnessDecision } from '../dist/index.js';

const read = async path => JSON.parse(await readFile(path, 'utf8'));
const sha = b => createHash('sha256').update(b).digest('hex');
export const LIVE_CANDIDATES = [
  { slug:'gemma', candidateId:'candidate-gemma4-nvfp4', model:'nvidia/Gemma-4-26B-A4B-NVFP4' },
  { slug:'qwen', candidateId:'candidate-qwen36-nvfp4', model:'nvidia/Qwen3.6-35B-A3B-NVFP4' },
];
async function pinned(path, hash) {
  assert.match(path, /^results\/r13\/[a-zA-Z0-9.-]+\.json$/);
  assert.match(hash, /^[a-f0-9]{64}$/);
  const bytes=await readFile(path);assert.equal(sha(bytes),hash,'Accepted live artifact bytes changed: '+path);
  return JSON.parse(bytes);
}
export async function readLiveCandidateEvidence(model) {
  const target=LIVE_CANDIDATES.find(c=>c.model===model);if(!target)return null;
  let index;try{index=await read('data/r13-accepted-evidence.json');}catch(e){if(e.code==='ENOENT')return null;throw e;}
  assert.equal(index.schema,'admissary-r13-accepted-evidence/v1');
  const binding=index.candidates.find(c=>c.model===model);assert.ok(binding,'Missing accepted target');
  assert.equal(binding.candidateId,target.candidateId);
  const summary=await pinned(binding.summaryPath,binding.summarySHA256);
  assert.equal(summary.model,model);assert.equal(summary.candidateId,target.candidateId);
  assert.equal(summary.provenance,'REAL_DOLPHIN_EXECUTION');assert.equal(summary.exactArtifactBindingProven,false);
  if(summary.completionStatus!=='COMPLETED'){
    assert.ok(['MODEL_UNAVAILABLE','PARTIAL_INSUFFICIENT_CREDIT','NOT_RUN_CREDIT_EXHAUSTED','INCOMPLETE_PROVIDER_ERROR'].includes(summary.completionStatus));
    assert.ok(summary.casesCompleted<144);assert.equal(summary.metrics,undefined);
    let partial=null;
    if(binding.partialArtifactPath){
      partial=await pinned(binding.partialArtifactPath,binding.partialArtifactSHA256);
      assert.equal(partial.schema,'admissary-r13-partial-provider-execution/v1');assert.equal(partial.expectedCaseCount,144);assert.equal(partial.executionPerformed,summary.casesCompleted>0);assert.equal(partial.provenance,summary.casesCompleted>0?'REAL_DOLPHIN_EXECUTION':'REAL_PROVIDER_STATUS_NO_EXECUTION');assert.equal(partial.providerBindingScope,'PROVIDER_MODEL_IDENTITY');
      const {executionDigest,...payload}=partial;assert.equal(executionDigest,digestCanonicalJson(payload));
      assert.equal(partial.model,model);assert.equal(partial.completionStatus,summary.completionStatus);assert.equal(partial.cases.length,summary.casesCompleted);assert.equal(partial.metrics,null);assert.equal(partial.exactArtifactBindingProven,false);
      const deep=await read(await acceptedHistorical('ADMISSARY_R5_DOLPHIN_'));
      assert.equal(partial.suiteDigest,deep.suiteDigest);assert.equal(partial.promptDigest,deep.promptProtocolDigest);assert.equal(partial.generationDigest,deep.generationConfigDigest);
      assert.deepEqual(partial.cases.map(c=>c.caseId),deep.cases.slice(0,summary.casesCompleted).map(c=>c.caseId));
      const suite=await read('data/banking77/banking-routing-v1.json');
      for(const c of partial.cases){assert.equal(c.requestedModel,model);assert.equal(c.responseModel,model);const parsed=parseDolphinIntent(c.rawContent,suite.intents);assert.equal(c.schemaValid,parsed.schemaValid);assert.equal(c.predictedIntent,parsed.intent);}
    }
    return {target,summary,raw:null,partial,empiricalFitness:'INCOMPLETE',qualificationState:'INCOMPLETE',blockers:[summary.completionStatus,'EXACT_ARTIFACT_BINDING_UNPROVEN']};
  }
  assert.equal(binding.artifactPath,summary.artifactPath);assert.equal(binding.artifactSHA256,summary.artifactSHA256);
  const raw=await pinned(binding.artifactPath,binding.artifactSHA256);
  assert.equal(verifyDolphinRunIntegrity(raw),true);assert.equal(raw.requestedModel,model);assert.equal(raw.responseModel,model);
  assert.equal(raw.runDigest,summary.runDigest);assert.equal(raw.cases.length,144);assert.equal(summary.casesCompleted,144);
  const deep=await read(await acceptedHistorical('ADMISSARY_R5_DOLPHIN_'));
  for(const key of ['suiteDigest','promptProtocol','promptProtocolDigest','generationConfigDigest'])assert.equal(raw[key],deep[key],key);
  assert.deepEqual(raw.generationConfig,deep.generationConfig);
  assert.deepEqual(raw.metricGates.map(g=>({metric:g.metric,threshold:g.threshold})),deep.metricGates.map(g=>({metric:g.metric,threshold:g.threshold})));
  const pack=await read('data/workloads/banking-routing-v1.workload.json');
  const suite=await read('data/banking77/banking-routing-v1.json');
  assert.equal(summary.protocol,raw.promptProtocol);assert.equal(summary.promptDigest,raw.promptProtocolDigest);assert.equal(summary.generationDigest,raw.generationConfigDigest);assert.equal(summary.workloadPackDigest,pack.packDigest);
  assert.deepEqual(raw.cases.map(c=>c.caseId),deep.cases.map(c=>c.caseId));
  for(const c of raw.cases){assert.equal(c.provider,'dolphin');assert.equal(c.requestedModel,model);assert.equal(c.responseModel,model);
    const parsed=parseDolphinIntent(c.rawContent,suite.intents);assert.equal(c.schemaValid,parsed.schemaValid);assert.equal(c.predictedIntent,parsed.intent);
  }
  assert.deepEqual(raw.metrics,scoreEvaluation(suite,raw.cases));
  assert.deepEqual(raw.metricGates,evaluateAllMetricThresholds(raw.metrics,suite.thresholds));
  const score=scoreWorkloadPack(pack,raw.cases.map(c=>({caseId:c.caseId,schemaValid:c.schemaValid,output:c.schemaValid?{intent:c.predictedIntent}:null,latencyMs:c.latencyMs})));
  for(const metric of score.metrics)assert.equal(metric.observed,raw.metrics[metric.metric]);
  assert.deepEqual(summary.genericScore,score);assert.deepEqual(summary.metrics,raw.metrics);
  assert.equal(raw.mandatoryMetricsPass,score.mandatoryPass);
  assert.equal(summary.mandatoryMetricsPass,raw.mandatoryMetricsPass);assert.equal(summary.providerBindingScope,'PROVIDER_MODEL_IDENTITY');
  const contract=parseDeploymentContract(await read('data/contracts/banking-support-prod.v1.json'));
  const plan=compileContract(contract,raw.suiteDigest),empirical=mapDolphinRunToEmpiricalResults(plan,raw);
  const decision=deriveQualificationWithCoverage(plan,empirical);
  const empiricalFitness=deriveEmpiricalFitnessDecision(plan,raw).state;
  assert.notEqual(decision.state,'QUALIFIED');
  return {target,summary,raw,score,plan,decision,empiricalFitness,qualificationState:decision.state,blockers:[...decision.decisiveObligations,'EXACT_ARTIFACT_BINDING_UNPROVEN'],identityDigest:digestCanonicalJson(binding)};
}
export async function liveCandidateRecords(){return (await Promise.all(LIVE_CANDIDATES.map(t=>readLiveCandidateEvidence(t.model)))).filter(Boolean);}
