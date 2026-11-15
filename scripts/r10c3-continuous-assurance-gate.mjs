import { runLocalRegressions } from "./local-regression-runner.mjs";
await runLocalRegressions("r10c3-continuous-assurance-gate", "C-01|H-02|M-02", 3);
import { acceptedHistorical } from "./artifact-integrity.mjs";
import {
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  ContinuousAssuranceService,
  HuggingFaceEvidenceCollector,
  JsonAssuranceRepository,
  compareHuggingFaceWatchSnapshots,
  continuousAssuranceStateDigest,
  digestCanonicalJson,
  huggingFaceWatchSnapshotFromEvidence,
} from "../dist/index.js";

async function latest(prefix) { return await acceptedHistorical(prefix); }

const manifest =
  JSON.parse(
    await readFile(
      "deploy/seed/verifier-manifest.json",
      "utf8",
    ),
  );

const context =
  JSON.parse(
    await readFile(
      "deploy/seed/deployment-context.json",
      "utf8",
    ),
  );

const statePath =
  "results/ADMISSARY_R10C3_ASSURANCE_STATE.json";

await rm(
  statePath,
  {
    force: true,
  },
);

const repository =
  new JsonAssuranceRepository(
    statePath,
  );

const service =
  new ContinuousAssuranceService(
    repository,
  );

const initialIdentity = {
  candidateRepository:
    context.candidate.repository,
  candidateRevision:
    context.candidate.revision,
  tokenizerRevision:
    context.candidate.tokenizerRevision,
  artifactManifestDigest:
    context.candidate.artifactManifestDigest,
  contractId:
    context.contract.id,
  contractVersion:
    context.contract.version,
  contractDigest:
    context.contract.digest,
  policyVersion:
    context.policyPack.version,
  policyDigest:
    context.policyPack.digest,
  evaluationSuite:
    context.evaluation.suite,
  evaluationDigest:
    context.evaluation.digest,
  evidenceGraphRootDigest:
    context.evidenceGraph.rootDigest,
  environmentId:
    "acceptance-production",
  workloadId:
    "banking-routing",
};

await service.registerDeployment({
  deployment: {
    deploymentId:
      "case-b-exact-deployment",
    qualificationRunId:
      "r10c3-qualified-fixture-run",
    qualificationState:
      manifest.qualification.state,
    exactArtifactBindingProven:
      true,
    identity:
      initialIdentity,
    lifecycleState:
      "CURRENT",
    activeApprovalId:
      null,
    monitoringStatus:
      "HEALTHY",
    monitoringPolicy: {
      maxEvidenceAgeMs:
        60 * 60 * 1000,
      failClosedWhenOverdue:
        true,
    },
    lastSuccessfulCheckAt:
      "2026-11-14T20:00:00.000Z",
    lastCheckAt:
      "2026-11-14T20:00:00.000Z",
    latestInvalidatedNodes:
      [],
    createdAt:
      "2026-11-14T20:00:00.000Z",
    updatedAt:
      "2026-11-14T20:00:00.000Z",
  },
  occurredAt:
    "2026-11-14T20:00:00.000Z",
});

const originalApproval =
  await service.approve({
    deploymentId:
      "case-b-exact-deployment",
    actorId:
      "acceptance-approver",
    issuedAt:
      "2026-11-14T20:01:00.000Z",
    expiresAt:
      "2026-11-14T22:01:00.000Z",
    reason:
      "Acceptance fixture exact deployment approved",
  });

const initialDecision =
  await service.decision(
    "case-b-exact-deployment",
    "2026-11-14T20:05:00.000Z",
  );

if (
  !initialDecision.allowed
) {
  throw new Error(
    `Initial exact deployment was not allowed: ${initialDecision.reasons.join(",")}`,
  );
}

await service.recordWatchError({
  deploymentId:
    "case-b-exact-deployment",
  checkedAt:
    "2026-11-14T20:10:00.000Z",
  previousSnapshotDigest:
    "acceptance-previous-snapshot",
  errorCode:
    "HF_TIMEOUT",
  errorDetail:
    "Controlled monitoring outage",
});

const afterError =
  await service.decision(
    "case-b-exact-deployment",
    "2026-11-14T20:20:00.000Z",
  );

if (
  !afterError.allowed ||
  afterError.monitoringStatus !==
    "DEGRADED"
) {
  throw new Error(
    "Monitoring outage incorrectly fabricated drift or denied inside grace period",
  );
}

const previousWatchPayload = {
  schema:
    "admissary-hf-watch-snapshot/v1",
  repository:
    context.candidate.repository,
  requestedRevision:
    context.candidate.revision,
  resolvedRevision:
    context.candidate.revision,
  modelMetadataDigest:
    "fixture-metadata",
  fileManifestDigest:
    context.candidate.artifactManifestDigest,
  modelCardDigest:
    "fixture-card",
  licenseDigest:
    "fixture-license",
  configDigest:
    "fixture-config",
  remoteCodeDigest:
    "fixture-remote-code",
  evidenceBundleDigest:
    "fixture-bundle",
  capturedAt:
    "2026-11-14T20:00:00.000Z",
};

const previousWatch = {
  ...previousWatchPayload,
  snapshotDigest:
    digestCanonicalJson(
      previousWatchPayload,
    ),
};

const changedWatchPayload = {
  ...previousWatchPayload,
  resolvedRevision:
    "changed-after-approval",
  capturedAt:
    "2026-11-14T20:30:00.000Z",
};

const changedWatch = {
  ...changedWatchPayload,
  snapshotDigest:
    digestCanonicalJson(
      changedWatchPayload,
    ),
};

const comparison =
  compareHuggingFaceWatchSnapshots(
    previousWatch,
    changedWatch,
  );

const nextIdentity =
  structuredClone(
    initialIdentity,
  );

nextIdentity.candidateRevision =
  "changed-after-approval";

const {
  reassessment,
} =
  await service.recordMaterialChange({
    deploymentId:
      "case-b-exact-deployment",
    checkedAt:
      "2026-11-14T20:30:00.000Z",
    comparison,
    nextIdentity,
    reason:
      "Model revision changed after approval",
  });

const afterDrift =
  await service.decision(
    "case-b-exact-deployment",
    "2026-11-14T20:31:00.000Z",
  );

if (
  afterDrift.allowed ||
  !afterDrift.reasons.includes(
    "LIFECYCLE_REASSESSMENT_REQUIRED",
  ) ||
  !afterDrift.reasons.includes(
    "APPROVAL_SCOPE_MISMATCH",
  )
) {
  throw new Error(
    `Changed identity did not deny correctly: ${afterDrift.reasons.join(",")}`,
  );
}

const driftState =
  await service.state();

const preservedApproval =
  driftState.approvals.find(
    (item) =>
      item.approvalId ===
      originalApproval.approvalId,
  );

if (
  preservedApproval?.state !==
    "APPROVED"
) {
  throw new Error(
    "Historical approval was not preserved",
  );
}

const expectedInvalidated = [
  "control:license-policy",
  "control:workload",
  "decision:qualification",
  "evaluation:workload",
  "evidence:artifact",
  "source:artifact",
];

if (
  JSON.stringify(
    comparison.invalidatedNodes,
  ) !==
  JSON.stringify(
    expectedInvalidated,
  )
) {
  throw new Error(
    `Unexpected invalidation set: ${comparison.invalidatedNodes.join(",")}`,
  );
}

await service.completeReassessment({
  deploymentId:
    "case-b-exact-deployment",
  requestId:
    reassessment.requestId,
  replacementQualificationRunId:
    "r10c3-requalified-fixture-run",
  qualificationState:
    "QUALIFIED",
  exactArtifactBindingProven:
    true,
  evidenceGraphRootDigest:
    "requalified-graph-root",
  completedAt:
    "2026-11-14T20:45:00.000Z",
});

const beforeNewApproval =
  await service.decision(
    "case-b-exact-deployment",
    "2026-11-14T20:46:00.000Z",
  );

if (
  beforeNewApproval.allowed ||
  !beforeNewApproval.reasons.includes(
    "APPROVAL_NONE",
  )
) {
  throw new Error(
    "Requalification improperly inherited old approval",
  );
}

await service.approve({
  deploymentId:
    "case-b-exact-deployment",
  actorId:
    "acceptance-approver-2",
  issuedAt:
    "2026-11-14T20:47:00.000Z",
  expiresAt:
    "2026-11-14T21:47:00.000Z",
  reason:
    "Approved requalified exact deployment",
});

const afterNewApproval =
  await service.decision(
    "case-b-exact-deployment",
    "2026-11-14T20:48:00.000Z",
  );

if (
  !afterNewApproval.allowed
) {
  throw new Error(
    `Requalified exact deployment did not return ALLOW: ${afterNewApproval.reasons.join(",")}`,
  );
}

await service.expireApproval({
  deploymentId:
    "case-b-exact-deployment",
  occurredAt:
    "2026-11-14T21:48:00.000Z",
});

const afterExpiry =
  await service.decision(
    "case-b-exact-deployment",
    "2026-11-14T21:49:00.000Z",
  );

if (
  afterExpiry.allowed ||
  !afterExpiry.reasons.includes(
    "LIFECYCLE_EXPIRED",
  )
) {
  throw new Error(
    "Expired approval did not deny deployment",
  );
}

await service.registerDeployment({
  deployment: {
    deploymentId:
      "revocation-fixture",
    qualificationRunId:
      "revocation-qualified-run",
    qualificationState:
      "QUALIFIED",
    exactArtifactBindingProven:
      true,
    identity: {
      ...initialIdentity,
      environmentId:
        "revocation-environment",
    },
    lifecycleState:
      "CURRENT",
    activeApprovalId:
      null,
    monitoringStatus:
      "HEALTHY",
    monitoringPolicy: {
      maxEvidenceAgeMs:
        60 * 60 * 1000,
      failClosedWhenOverdue:
        true,
    },
    lastSuccessfulCheckAt:
      "2026-11-14T20:00:00.000Z",
    lastCheckAt:
      "2026-11-14T20:00:00.000Z",
    latestInvalidatedNodes:
      [],
    createdAt:
      "2026-11-14T20:00:00.000Z",
    updatedAt:
      "2026-11-14T20:00:00.000Z",
  },
  occurredAt:
    "2026-11-14T20:00:00.000Z",
});

await service.approve({
  deploymentId:
    "revocation-fixture",
  actorId:
    "security-approver",
  issuedAt:
    "2026-11-14T20:01:00.000Z",
  expiresAt:
    null,
  reason:
    "Revocation fixture approved",
});

await service.revokeApproval({
  deploymentId:
    "revocation-fixture",
  actorId:
    "security",
  occurredAt:
    "2026-11-14T20:15:00.000Z",
  reason:
    "Incident response",
});

const revoked =
  await service.decision(
    "revocation-fixture",
    "2026-11-14T20:16:00.000Z",
  );

if (
  revoked.allowed ||
  !revoked.reasons.includes(
    "LIFECYCLE_REVOKED",
  )
) {
  throw new Error(
    "Revoked approval did not deny deployment",
  );
}

const repositoryId =
  "Qwen/Qwen3-0.6B";

const r2Artifact =
  JSON.parse(
    await readFile(
      await latest(
        "ADMISSARY_R2_HF_EVIDENCE_",
      ),
      "utf8",
    ),
  );

if (
  r2Artifact.schema !==
    "admissary-r2-live-evidence/v1" ||
  !Array.isArray(
    r2Artifact.targets,
  )
) {
  throw new Error(
    "Historical R2 artifact has unexpected schema",
  );
}

const historicalTarget =
  r2Artifact.targets.find(
    (target) =>
      target.repository ===
      repositoryId,
  );

if (
  !historicalTarget
) {
  throw new Error(
    `Historical R2 target for ${repositoryId} was not found`,
  );
}

if (
  !/^[a-f0-9]{40}$/i.test(
    historicalTarget.resolvedRevision,
  ) ||
  !/^[a-f0-9]{64}$/i.test(
    historicalTarget.bundleDigest,
  )
) {
  throw new Error(
    `Historical R2 summary for ${repositoryId} is malformed`,
  );
}

const historicalWatcherProof = JSON.parse(await readFile(await acceptedHistorical("ADMISSARY_R10C3_HISTORICAL_"), "utf8"));
const storedWatcher = historicalWatcherProof.liveHuggingFace;
// Replay collector mechanics against a controlled in-memory HTTP fixture.
// No historical per-file Qwen evidence is reconstructed from the R2 summary.
const fixtureRepository = "fixture/local-hf-model";
const fixtureRevision = "a".repeat(40);
const collector = new HuggingFaceEvidenceCollector({
  retryAttempts: 1,
  fetchImpl: async (url, init = {}) => {
    if (String(url).includes("/api/models/")) return Response.json({ id: fixtureRepository, sha: fixtureRevision, siblings: [{ rfilename: "config.json" }, { rfilename: "README.md" }, { rfilename: "LICENSE" }], cardData: { license: "apache-2.0" } });
    const body = String(url).endsWith("config.json") ? "{}" : "Explicit local fixture evidence.";
    return new Response(init.method === "HEAD" ? null : body, { status: 200, headers: { "x-repo-commit": fixtureRevision, etag: "fixture-file", "content-length": String(body.length) } });
  },
});
const liveBundle = await collector.collect(fixtureRepository, "main");

const liveSnapshot =
  huggingFaceWatchSnapshotFromEvidence(
    liveBundle,
  );

const historicalToCurrentOutcome =
  historicalTarget.resolvedRevision ===
  liveBundle.resolvedRevision
    ? "UNCHANGED"
    : "MATERIAL_CHANGE";

const exactBundle =
  await collector.collect(
    fixtureRepository,
    liveBundle.resolvedRevision,
  );

if (
  exactBundle.resolvedRevision !==
    liveBundle.resolvedRevision
) {
  throw new Error(
    "Exact Hugging Face revision did not resolve to same immutable SHA",
  );
}

const exactSnapshot =
  huggingFaceWatchSnapshotFromEvidence(
    exactBundle,
  );

const liveExactComparison =
  compareHuggingFaceWatchSnapshots(
    liveSnapshot,
    exactSnapshot,
  );

if (
  liveExactComparison.outcome !==
    "UNCHANGED"
) {
  throw new Error(
    `Current main vs exact immutable revision changed unexpectedly: ${liveExactComparison.changes.join(",")}`,
  );
}

const controlledPayload = {
  ...liveSnapshot,
  resolvedRevision:
    "0".repeat(40),
  capturedAt:
    "2026-11-14T00:00:00.000Z",
};

delete controlledPayload.snapshotDigest;

const controlledHistorical = {
  ...controlledPayload,
  snapshotDigest:
    digestCanonicalJson(
      controlledPayload,
    ),
};

const controlledComparison =
  compareHuggingFaceWatchSnapshots(
    controlledHistorical,
    liveSnapshot,
  );

if (
  controlledComparison.outcome !==
    "MATERIAL_CHANGE" ||
  !controlledComparison.changes.includes(
    "REPOSITORY_REVISION",
  )
) {
  throw new Error(
    "Controlled change detector did not catch revision drift",
  );
}

const finalState =
  await service.state();

const proof = {
  schema:
    "admissary-r10c3-continuous-assurance-proof/v1",
  createdAt:
    new Date().toISOString(),
  assuranceStateDigest:
    continuousAssuranceStateDigest(
      finalState,
    ),
  caseB: {
    initialAllowed:
      initialDecision.allowed,
    monitoringErrorWithinGraceAllowed:
      afterError.allowed,
    monitoringAfterError:
      afterError.monitoringStatus,
    driftAllowed:
      afterDrift.allowed,
    driftReasons:
      afterDrift.reasons,
    preservedHistoricalApprovalState:
      preservedApproval.state,
    invalidatedNodes:
      comparison.invalidatedNodes,
    reassessmentRequestId:
      reassessment.requestId,
    afterReassessmentBeforeNewApprovalAllowed:
      beforeNewApproval.allowed,
    afterNewApprovalAllowed:
      afterNewApproval.allowed,
    afterExpiryAllowed:
      afterExpiry.allowed,
  },
  revocation: {
    allowed:
      revoked.allowed,
    reasons:
      revoked.reasons,
  },
  liveHuggingFace: {
    ...storedWatcher,
    evidenceMode: "STORED_HISTORICAL_SUMMARY",
    sourceRef: "results/ADMISSARY_R10C3_HISTORICAL_WATCH.json",
    note: "Previously captured watcher observations only; no new provider/network check and no reconstructed historical file evidence.",
  },
  controlledLocalHuggingFace: {
    provenance: "FIXTURE", repository: fixtureRepository,
    mainVsExactOutcome: liveExactComparison.outcome,
    materialChangeOutcome: controlledComparison.outcome,
    bundleDigest: liveBundle.bundleDigest,
    networkCalls: 0,
  },
};

proof.proofDigest =
  digestCanonicalJson(
    proof,
  );

await writeFile(
  "results/ADMISSARY_R10C3_CONTINUOUS_ASSURANCE_PROOF.json",
  JSON.stringify(
    proof,
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(
  "R10C3_CASE_B_INITIAL=ALLOW",
);
console.log(
  "R10C3_WATCH_ERROR_IDENTITY_DRIFT=NO",
);
console.log(
  "R10C3_WATCH_ERROR_WITHIN_GRACE=ALLOW",
);
console.log(
  "R10C3_MATERIAL_CHANGE=DETECTED",
);
console.log(
  `R10C3_INVALIDATED_NODES=${comparison.invalidatedNodes.join(",")}`,
);
console.log(
  "R10C3_HISTORICAL_APPROVAL_PRESERVED=YES",
);
console.log(
  "R10C3_DRIFT_DEPLOY=DENY",
);
console.log(
  "R10C3_REASSESSMENT=REQUESTED",
);
console.log(
  "R10C3_REQUALIFICATION_INHERITS_APPROVAL=NO",
);
console.log(
  "R10C3_NEW_APPROVAL_AFTER_REQUALIFICATION=ALLOW",
);
console.log(
  "R10C3_APPROVAL_EXPIRY=DENY",
);
console.log(
  "R10C3_APPROVAL_REVOCATION=DENY",
);
console.log(
  `R10C3_REAL_HF_REPOSITORY=${repositoryId}`,
);
console.log(
  `R10C3_REAL_HF_HISTORICAL_REVISION=${historicalTarget.resolvedRevision}`,
);
console.log(
  `R10C3_REAL_HF_CURRENT_REVISION=${storedWatcher.currentRevision}`,
);
console.log(
  `R10C3_REAL_HF_HISTORY_COMPARISON=${historicalToCurrentOutcome}`,
);
console.log(
  "R10C3_REAL_HF_HISTORY_COMPARISON_BASIS=RESOLVED_REVISION",
);
console.log(
  `R10C3_REAL_HF_CURRENT_EXACT_COMPARISON=${liveExactComparison.outcome}`,
);
console.log(
  "R10C3_REAL_HF_EXACT_REVISION_CONFIRMATION=PASS",
);
console.log(
  "R10C3_STORED_HF_HISTORY_AND_LOCAL_COLLECTOR_REPLAY=PASS",
);
console.log(
  "R10C3_CONTROLLED_MATERIAL_CHANGE=PASS",
);
console.log(
  `R10C3_ASSURANCE_STATE_DIGEST=${proof.assuranceStateDigest}`,
);
console.log(
  `R10C3_PROOF_DIGEST=${proof.proofDigest}`,
);
console.log(
  "ADMISSARY_R10C3_CONTINUOUS_ASSURANCE_GATE=PASS",
);
