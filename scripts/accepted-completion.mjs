import { readFile } from 'node:fs/promises';
import { acceptedHistorical } from './artifact-integrity.mjs';
import { readLiveCandidateEvidence } from './live-candidate-evidence.mjs';
import { compileContract, parseDeploymentContract, digestCanonicalJson,
  deriveQualificationWithCoverage, mapDolphinRunToEmpiricalResults,
  executeR5EmpiricalWorkflow, verifyDolphinRunIntegrity } from '../dist/index.js';

// Local replay of already accepted raw provider evidence. No inference/network.
export async function canonicalDeepSeekEvidence(run, candidate, registeredContract) {
  if (candidate.repositoryOrModelId !== 'deepseek-ai/DeepSeek-V4.1-Flash') throw new Error('No accepted real evidence for candidate');
  const path = await acceptedHistorical('ADMISSARY_R5_DOLPHIN_');
  const raw = JSON.parse(await readFile(path, 'utf8'));
  return replayProviderEvidence(raw, path, candidate, registeredContract);
}

export async function acceptedRealEvidence(run, candidate, registeredContract) {
  if (candidate.repositoryOrModelId === 'deepseek-ai/DeepSeek-V4.1-Flash') return canonicalDeepSeekEvidence(run, candidate, registeredContract);
  const accepted = await readLiveCandidateEvidence(candidate.repositoryOrModelId);
  if (!accepted?.raw) throw new Error('No complete accepted real evidence for candidate');
  return replayProviderEvidence(accepted.raw, accepted.summary.artifactPath, candidate, registeredContract);
}

export async function replayProviderEvidence(raw, path, candidate, registeredContract) {
  if (raw.requestedModel !== candidate.repositoryOrModelId || raw.responseModel !== candidate.repositoryOrModelId) throw new Error('Accepted provider-model identity mismatch');
  if (!verifyDolphinRunIntegrity(raw)) throw new Error('Accepted Dolphin evidence integrity failure');
  const contract = parseDeploymentContract(JSON.parse(await readFile('data/contracts/banking-support-prod.v1.json', 'utf8')));
  if (digestCanonicalJson(contract) !== registeredContract.digest || contract.metadata.id !== registeredContract.contractId || contract.metadata.version !== registeredContract.version) throw new Error('Accepted contract binding mismatch');
  const plan = compileContract(contract, raw.suiteDigest);
  const workloadPack = JSON.parse(await readFile("data/workloads/banking-routing-v1.workload.json", "utf8"));
  const evaluationSuite = JSON.parse(await readFile("data/banking77/banking-routing-v1.json", "utf8"));
  const empirical = mapDolphinRunToEmpiricalResults(plan, raw);
  const results = deriveQualificationWithCoverage(plan, empirical).obligationResults;
  const graph = executeR5EmpiricalWorkflow({ contractDigest: registeredContract.digest, suiteDigest: raw.suiteDigest, workloadPack, evaluationSuite, run: raw, plan });
  const nodes = [{ schema: 'admissary-replayed-evidence/v1', graph, results, providerBinding: 'PROVIDER_MODEL_IDENTITY' }];
  const payload = { schema: 'admissary-completion-evidence/v1', provenance: 'REAL',
    candidate: { repositoryOrModelId: candidate.repositoryOrModelId, revision: candidate.revision, tokenizerRevision: candidate.tokenizerRevision, artifactManifestDigest: candidate.artifactManifestDigest },
    contract: { id: registeredContract.contractId, version: registeredContract.version, digest: registeredContract.digest },
    policy: { version: 'qualification-compiler/v1', digest: digestCanonicalJson(plan) },
    evaluation: { suite: plan.evaluationSuite, digest: raw.suiteDigest }, plan, results,
    graph: { rootDigest: digestCanonicalJson(nodes), nodes }, exactArtifactBindingProven: false,
    operational: { p95LatencyMs: raw.metrics?.p95_latency_ms ?? null, costPerMillionTokensUsd: null, modelSizeB: null },
    sourceRefs: [`stored:${path}#${raw.runDigest}`],
  };
  return { ...payload, evidenceDigest: digestCanonicalJson(payload) };
}
