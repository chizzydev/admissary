import { acceptedHistorical } from "./artifact-integrity.mjs";
import { liveCandidateRecords } from "./live-candidate-evidence.mjs";
import {
  createHash,
} from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import {
  join,
} from "node:path";

import {
  buildJudgeView,
  digestCanonicalJson,
} from "../dist/index.js";

const CANONICAL_R5_RUN =
  "1e56c082af49d232f834b67cc09901627557b019ef0eca32b12eafca8eae1628";

function sha256Bytes(buffer) {
  return createHash("sha256")
    .update(buffer)
    .digest("hex");
}

async function readJson(path) {
  return JSON.parse(
    await readFile(path, "utf8"),
  );
}

async function latestMatching(prefix, predicate = () => true) {
  const path = await acceptedHistorical(prefix);
  const value = await readJson(path);
  if (!predicate(value)) throw new Error(`Accepted artifact identity mismatch: ${prefix}`);
  return { file: path.slice(8), value };
}

async function artifactRef(file, phase, label, role) {
  const bytes = await readFile(join("results", file));
  return {
    phase,
    label,
    file,
    digest: sha256Bytes(bytes),
    role,
  };
}

function metricLabel(metric) {
  const labels = {
    macro_f1: "Macro F1",
    critical_intent_recall: "Critical intent recall",
    schema_validity: "Schema validity",
    injection_invariance: "Injection invariance",
    p95_latency_ms: "P95 latency (ms)",
  };

  return labels[metric] ?? metric;
}

function normalizeMetricGate(gate) {
  return {
    id: gate.metric,
    label: metricLabel(gate.metric),
    observed: gate.observed,
    operator: gate.threshold.operator,
    threshold: gate.threshold.value,
    criticality: gate.threshold.criticality,
    state: gate.state,
  };
}

function objectContainsAll(value, needles) {
  if (!value || typeof value !== "object") return false;
  const text = JSON.stringify(value);
  return needles.every((needle) => text.includes(needle));
}

const contract = await readJson(
  "data/contracts/banking-support-prod.v1.json",
);

const r2 = await latestMatching(
  "ADMISSARY_R2_HF_EVIDENCE_",
);

const r3 = await latestMatching(
  "ADMISSARY_R3_SERV_EVIDENCE_",
);

const r5 = await latestMatching(
  "ADMISSARY_R5_DOLPHIN_",
  (value) => value.runDigest === CANONICAL_R5_RUN,
);

const r6 = await latestMatching(
  "ADMISSARY_R6_ORCHESTRATION_",
  (value) =>
    value.schema === "admissary-r6-orchestration/v1" &&
    value.r5Evidence?.runDigest === CANONICAL_R5_RUN,
);

const r7 = await latestMatching(
  "ADMISSARY_R7_PERSISTENCE_",
  (value) => value.schema === "admissary-r7-persistence-proof/v1",
);

const r8 = await latestMatching(
  "ADMISSARY_R8_VERIFIER_",
  (value) => value.schema === "admissary-r8-verifier-proof/v1",
);

const r7State = await readJson(
  "results/ADMISSARY_R7_STATE.json",
);

const r2RemoteCodeCandidate = objectContainsAll(
  r2.value,
  ["sgugger/custom-resnet50d", "REQUIRED"],
);

const metrics = r5.value.metricGates.map(normalizeMetricGate);

const deploymentBlockers = [
  ...r7.value.realRun.deploymentDecision.reasons,
];

const candidates = [];

if (r2RemoteCodeCandidate) {
  candidates.push({
    id: "hf-custom-resnet50d",
    label: "sgugger/custom-resnet50d",
    provenance: "REAL_EVIDENCE",
    stage: "Deterministic preflight",
    qualificationState: "DISQUALIFIED",
    deploymentState: "DENY",
    explanation:
      "R2 evidence indicates custom remote code is required while the deployment contract forbids remote repository code.",
  });
}

candidates.push({
  id: "dolphin-deepseek-v41-flash",
  label: r5.value.responseModel,
  provenance: "REAL_EVIDENCE",
  stage: "Empirical qualification",
  qualificationState: r6.value.fullQualificationCoverage.state,
  empiricalFitness: r6.value.empiricalFitness.state,
  deploymentState: r7.value.realRun.deploymentDecision.allowed ? "ALLOW" : "DENY",
  explanation:
    "The real Dolphin run completed 144/144 cases. Aggregate quality was strong, but mandatory critical-recall and schema-validity gates failed; full exact-artifact qualification remains review-required because runtime artifact binding is unproven.",
});

const liveRecords=await liveCandidateRecords();
for(const live of liveRecords){
  candidates.push({id:live.target.candidateId,label:live.target.model,provenance:'REAL_EVIDENCE',stage:live.raw?'Empirical qualification':'Provider execution incomplete',qualificationState:live.qualificationState,empiricalFitness:live.empiricalFitness,deploymentState:'DENY',
    explanation:`Provider execution status: ${live.summary.completionStatus}, ${live.summary.casesCompleted}/144 frozen cases. Empirical ${live.empiricalFitness}; full ${live.qualificationState}. PROVIDER_MODEL_IDENTITY only; exact runtime artifact, tokenizer and manifest remain unproven. Candidate-specific deterministic and semantic evidence is UNKNOWN. ${live.summary.casesCompleted===0?"No inference was performed for this candidate.":""}`,
    execution:{provenance:live.partial?.provenance??'REAL_DOLPHIN_EXECUTION',completionStatus:live.summary.completionStatus,casesCompleted:live.summary.casesCompleted,caseCount:144,bindingScope:'PROVIDER_MODEL_IDENTITY',exactArtifactBindingProven:false,runDigest:live.raw?.runDigest??live.partial?.executionDigest??null,metrics:live.raw?.metricGates.map(normalizeMetricGate)??[]}});
}
candidates.push({
  id: "authorization-acceptance-fixture",
  label: "Verifier acceptance fixture",
  provenance: "ACCEPTANCE_FIXTURE",
  stage: "Authorization + deploy verifier",
  qualificationState: "QUALIFIED",
  deploymentState: r7.value.acceptanceFixture.approvedDecision.allowed ? "ALLOW" : "DENY",
  explanation:
    "Explicit non-production fixture used only to prove the positive QUALIFIED → APPROVED → deploy lifecycle and subsequent stale/revoked denial paths.",
});

const artifacts = [
  await artifactRef(r2.file, "R2", "Hugging Face evidence", "Exact repository evidence and remote-code preflight"),
  await artifactRef(r3.file, "R3", "SERV semantic evidence", "Bounded semantic evidence interpretation"),
  await artifactRef(r5.file, "R5", "Dolphin empirical run", "Frozen 144-case production-workload measurement"),
  await artifactRef(r6.file, "R6", "Qualification DAG", "Content-addressed orchestration and invalidation"),
  await artifactRef(r7.file, "R7", "Authorization proof", "Approval, stale, revocation, and deployment authority"),
  await artifactRef(r8.file, "R8", "Deploy verifier proof", "Zero-LLM manifest/context enforcement"),
];
for(const live of liveRecords){
  if(live.raw)artifacts.push(await artifactRef(live.summary.artifactPath.slice(8),'R13',live.target.model+' real workload run','REAL_DOLPHIN_EXECUTION · 144 frozen cases · PROVIDER_MODEL_IDENTITY · exact artifact binding unproven'));
  else if(live.partial)artifacts.push(await artifactRef(`r13/${live.target.slug}-partial-${live.partial.executionDigest}.json`,'R13',live.target.model+' provider execution status',`${live.partial.provenance} · ${live.summary.casesCompleted}/144 cases · ${live.summary.completionStatus} · no complete-run metrics`));
}

const input = {
  generatedAt: new Date().toISOString(),
  contract: {
    id: r6.value.contract.id,
    version: r6.value.contract.version,
    digest: r6.value.contract.digest,
    workload: contract.spec.purpose.workload,
    environment: contract.spec.purpose.environment,
  },
  candidate: {
    model: r5.value.responseModel,
    provider: "Dolphin",
    providerHost: r5.value.baseUrlHost,
    bindingScope: r6.value.executionBinding.scope,
    exactArtifactBindingProven: r6.value.executionBinding.exactArtifactBindingProven,
    empiricalFitness: r6.value.empiricalFitness.state,
    overallQualification: r6.value.fullQualificationCoverage.state,
    deployAllowed: r7.value.realRun.deploymentDecision.allowed,
  },
  metrics,
  empiricalBlockers: [
    ...r6.value.empiricalFitness.decisiveObligations,
  ],
  deploymentBlockers,
  missingObligations: [
    ...r6.value.fullQualificationCoverage.coverage.missingObligations,
  ],
  requalification: {
    unchanged: {
      reused: r6.value.workflow.unchangedRepeat.reusedKeys.length,
      recomputed: r6.value.workflow.unchangedRepeat.recomputedKeys.length,
    },
    policyChange: {
      reused: [...r6.value.incrementalRequalification.policyOnly.reusedKeys],
      recomputed: [...r6.value.incrementalRequalification.policyOnly.recomputedKeys],
    },
    artifactChange: {
      reused: [...r6.value.incrementalRequalification.artifactRevision.reusedKeys],
      recomputed: [...r6.value.incrementalRequalification.artifactRevision.recomputedKeys],
    },
  },
  authorization: {
    approvalDeniedForRealRun: r7.value.realRun.approvalDenied,
    realDeployAllowed: r7.value.realRun.deploymentDecision.allowed,
    viewerApprovalDenied: r7.value.acceptanceFixture.viewerApprovalDenied,
    fixtureApprovedDeployAllowed: r7.value.acceptanceFixture.approvedDecision.allowed,
    fixtureStaleDeployAllowed: r7.value.acceptanceFixture.staleDecision.allowed,
    fixtureStaleAuthorization: r7.value.acceptanceFixture.staleDecision.authorizationState,
    fixtureStaleValidity: r7.value.acceptanceFixture.staleDecision.validityState,
    fixtureRevokedAuthorization: r7.value.acceptanceFixture.revokedDecision.authorizationState,
  },
  verifier: {
    valid: r8.value.valid.allowed ? "ALLOW" : "DENY",
    tampered: r8.value.tampered.allowed ? "ALLOW" : "DENY",
    tamperedReason: r8.value.tampered.reasons.map((item) => item.code).join(","),
    rehashedRevisionChange: r8.value.selfConsistentRevisionMismatch.allowed ? "ALLOW" : "DENY",
    rehashedRevisionChangeReason: r8.value.selfConsistentRevisionMismatch.reasons.map((item) => item.code).join(","),
    stale: r8.value.stale.allowed ? "ALLOW" : "DENY",
    staleReason: r8.value.stale.reasons.map((item) => item.code).join(","),
    unapproved: r8.value.unapproved.allowed ? "ALLOW" : "DENY",
    unapprovedReason: r8.value.unapproved.reasons.map((item) => item.code).join(","),
    contractMismatch: r8.value.contractMismatch.allowed ? "ALLOW" : "DENY",
    contractMismatchReason: r8.value.contractMismatch.reasons.map((item) => item.code).join(","),
    networkCalls: 0,
  },
  integrations: {
    serv: {
      liveArtifactPresent: true,
      artifactFile: r3.file,
      role:
        "SERV interprets bounded natural-language evidence; Admissary verifies evidence references and keeps deterministic qualification authority.",
    },
    dolphin: {
      liveArtifactPresent: true,
      artifactFile: r5.file,
      runDigest: r5.value.runDigest,
      cases: r5.value.cases.length,
      role:
        "Dolphin executes the frozen production workload so qualification depends on what the model actually does, not only repository metadata.",
    },
  },
  artifacts,
  candidates,
};

const view = buildJudgeView(input);
const snapshotDigest = digestCanonicalJson(view);
const snapshot = {
  ...view,
  snapshotDigest,
};

await mkdir("web", { recursive: true });
await mkdir("results", { recursive: true });

await writeFile(
  "web/demo-snapshot.json",
  JSON.stringify(snapshot, null, 2) + "\n",
  "utf8",
);

const stamp = new Date()
  .toISOString()
  .replaceAll(":", "")
  .replaceAll(".", "");

const resultPath = join(
  "results",
  `ADMISSARY_R9_JUDGE_VIEW_${stamp}.json`,
);

await writeFile(
  resultPath,
  JSON.stringify(snapshot, null, 2) + "\n",
  "utf8",
);

console.log(`R9_SNAPSHOT_DIGEST=${snapshotDigest}`);
console.log(`R9_CANDIDATES=${snapshot.candidates.length}`);
console.log(`R9_REAL_MODEL=${snapshot.candidate.model}`);
console.log(`R9_EMPIRICAL_FITNESS=${snapshot.candidate.empiricalFitness}`);
console.log(`R9_OVERALL_QUALIFICATION=${snapshot.candidate.overallQualification}`);
console.log(`R9_DEPLOY_ALLOWED=${snapshot.candidate.deployAllowed ? "YES" : "NO"}`);
console.log(`R9_SERV_ARTIFACT=${r3.file}`);
console.log(`R9_DOLPHIN_ARTIFACT=${r5.file}`);
console.log(`R9_RESULT=${resultPath}`);
console.log("ADMISSARY_R9_JUDGE_DATA_GATE=PASS");
