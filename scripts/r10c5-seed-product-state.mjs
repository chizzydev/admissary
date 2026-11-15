import { acceptedRealEvidence } from "./accepted-completion.mjs";
import { liveCandidateRecords } from "./live-candidate-evidence.mjs";
import { completionInput } from "./remediation-fixtures.mjs";
import { acceptedHistorical } from "./artifact-integrity.mjs";
import {
  readFile,
  readdir,
  rm,
} from "node:fs/promises";

import {
  ContinuousAssuranceService,
  JsonAssuranceRepository,
  JsonProductRepository,
  ProductApplicationService,
  productApplicationStateDigest,
  continuousAssuranceStateDigest,
} from "../dist/index.js";

async function latest(prefix) { return await acceptedHistorical(prefix); }

const productPath = process.env.ADMISSARY_R10C5_PRODUCT_STATE ??
  "results/ADMISSARY_R10C5_PRODUCT_STATE.json";
const assurancePath = process.env.ADMISSARY_R10C5_ASSURANCE_STATE ??
  "results/ADMISSARY_R10C5_ASSURANCE_STATE.json";

await rm(productPath, { force: true });
await rm(assurancePath, { force: true });

const r6 = JSON.parse(await readFile(await latest("ADMISSARY_R6_ORCHESTRATION_"), "utf8"));
const registryState = JSON.parse(await readFile("results/ADMISSARY_R10C_REGISTRY_STATE.json", "utf8"));

const productRepository = new JsonProductRepository(productPath);
const assuranceRepository = new JsonAssuranceRepository(assurancePath);
const service = new ProductApplicationService(
  productRepository,
  new ContinuousAssuranceService(assuranceRepository),
  acceptedRealEvidence,
);

for (const candidate of registryState.candidates) {
  const artifact = registryState.artifactRevisions.find(
    (item) => item.candidateId === candidate.id,
  );
  await service.registerCandidate({
    candidateId: candidate.id,
    displayName: candidate.displayName,
    provider: candidate.source,
    repositoryOrModelId: candidate.repositoryOrModelId,
    revision: artifact?.immutableRevision ?? null,
    tokenizerRevision: artifact?.tokenizerRevision ?? null,
    artifactManifestDigest: artifact?.artifactDigest ?? null,
    actorId: "SYSTEM_SEED",
    occurredAt: candidate.createdAt,
  });
}

await service.registerContract({
  contractId: r6.contract.id,
  version: r6.contract.version,
  digest: r6.contract.digest,
  workloadId: "workload-banking-routing",
  environmentId: "env-prod-eu",
  actorId: "SYSTEM_SEED",
  occurredAt: "2026-11-14T19:50:00.000Z",
});

const deepSeekRun = await service.startQualification({
  candidateId: "candidate-deepseek-v41-flash",
  contractId: r6.contract.id,
  contractVersion: r6.contract.version,
  actorId: "SYSTEM_SEED",
  requestedAt: "2026-11-14T19:50:01.000Z",
  reason: "Import canonical R6 qualification result into application API state",
});

const registered = await productRepository.read();
const evidence = await acceptedRealEvidence(deepSeekRun, registered.candidates.find(c => c.candidateId === deepSeekRun.candidateId), registered.contracts[0]);
await service.completeQualification({
  runId: deepSeekRun.runId,
  ...completionInput(evidence),
  actorId: "SYSTEM_SEED",
  completedAt: "2026-11-14T19:50:01.500Z",
});

await service.createDeployment({
  deploymentId: "deployment-deepseek-banking-prod",
  runId: deepSeekRun.runId,
  actorId: "SYSTEM_SEED",
  createdAt: "2026-11-14T19:50:02.000Z",
  maxEvidenceAgeMs: 24 * 60 * 60 * 1000,
});

for (const live of await liveCandidateRecords()) {
  if (!live.raw) continue; // Partial/provider failures are not completed qualifications.
  const request = await service.startQualification({candidateId:live.target.candidateId,contractId:r6.contract.id,contractVersion:r6.contract.version,actorId:'SYSTEM_REAL_EVIDENCE_IMPORT',requestedAt:live.summary.startedAt,reason:'Import pinned complete R13 real Dolphin workload evidence; hosted exact binding remains unproven'});
  const candidate = registered.candidates.find(c=>c.candidateId===request.candidateId);
  const bundle = await acceptedRealEvidence(request,candidate,registered.contracts[0]);
  await service.completeQualification({runId:request.runId,...completionInput(bundle),actorId:'SYSTEM_REAL_EVIDENCE_IMPORT',completedAt:live.raw.completedAt});
  await service.createDeployment({deploymentId:`deployment-${live.target.slug}-banking-prod`,runId:request.runId,actorId:'SYSTEM_REAL_EVIDENCE_IMPORT',createdAt:live.raw.completedAt,maxEvidenceAgeMs:24*60*60*1000});
  const decision=await service.deployment(`deployment-${live.target.slug}-banking-prod`,live.raw.completedAt);
  if(decision.decision.allowed)throw new Error('Hosted live candidate became deployable without exact binding');
  console.log(`R13_PRODUCT_${live.target.slug.toUpperCase()}=${live.qualificationState}/DENY`);
}
const state = await productRepository.read();
const assuranceState = await assuranceRepository.read();
const real = await service.deployment(
  "deployment-deepseek-banking-prod",
  "2026-11-14T19:51:00.000Z",
);

if (real.decision.allowed) {
  throw new Error("Real DeepSeek application deployment unexpectedly became deployable");
}

console.log(`R10C5_SEED_CANDIDATES=${state.candidates.length}`);
console.log(`R10C5_SEED_CONTRACTS=${state.contracts.length}`);
console.log(`R10C5_SEED_QUALIFICATION_RUNS=${state.qualificationRuns.length}`);
console.log(`R10C5_SEED_DEPLOYMENTS=${state.deployments.length}`);
console.log(`R10C5_SEED_REAL_DEEPSEEK_DEPLOY=DENY`);
console.log(`R10C5_PRODUCT_STATE_DIGEST=${productApplicationStateDigest(state)}`);
console.log(`R10C5_PRODUCT_ASSURANCE_STATE_DIGEST=${continuousAssuranceStateDigest(assuranceState)}`);
console.log("R10C5_PRODUCT_STATE_SEED_GATE=PASS");
