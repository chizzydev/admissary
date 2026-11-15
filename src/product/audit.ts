import { productProofMatches, attestationMatchesProof } from "./proof.js";
import {
  digestCanonicalJson,
} from "../qualification/canonical.js";
import type {
  AssuranceDecision,
  ContinuousAssuranceState,
  ScopedApprovalRecord,
} from "../assurance/types.js";
import type {
  ProductApplicationState,
  ProductAttestationRecord,
  ProductCandidateRecord,
  ProductContractRecord,
  ProductDeploymentRecord,
  ProductQualificationRunRecord,
} from "./state.js";

export interface ProductAuditTimelineItem {
  recordedAt: string | null;
  appendSequence: number;
  orderBasis: "SERVER_RECORDED_TIME" | "LEGACY_APPEND_ORDER_UNPROVEN";
  occurredAt: string;
  source:
    | "PRODUCT"
    | "ASSURANCE";
  type: string;
  actorId: string | null;
  detail: string;
}

export interface ProductRollbackTarget {
  deploymentId: string;
  candidateId: string;
  candidateDisplayName: string;
  candidateRepositoryOrModelId: string;
  candidateRevision: string | null;
  qualificationRunId: string;
  contractId: string;
  contractVersion: string;
  attestationDigest: string;
  approvalId: string;
  createdAt: string;
  reason:
    "QUALIFIED_EXACT_BOUND_APPROVED_CURRENT_ATTESTED_SAME_SCOPE";
}

export interface ProductDeploymentAudit {
  schema:
    "admissary-product-deployment-audit/v1";
  deployment: ProductDeploymentRecord;
  candidate: ProductCandidateRecord;
  contract: ProductContractRecord;
  qualification: ProductQualificationRunRecord;
  decision: AssuranceDecision;
  approval: ScopedApprovalRecord | null;
  attestation: ProductAttestationRecord | null;
  exactIdentity: {
    repositoryOrModelId: string;
    revision: string | null;
    tokenizerRevision: string | null;
    artifactManifestDigest: string | null;
    contractDigest: string;
    policyDigest: string | null;
    evaluationDigest: string | null;
    evidenceGraphRootDigest: string | null;
    environmentId: string;
    workloadId: string;
  };
  timeline: ProductAuditTimelineItem[];
  rollbackTargets: ProductRollbackTarget[];
  auditDigest: string;
}

export interface RollbackEligibilityInput {
  product: ProductApplicationState;
  assurance: ContinuousAssuranceState;
  currentDeploymentId: string;
  targetDeploymentId: string;
  targetDecision: AssuranceDecision;
}

function byDeployment(
  product: ProductApplicationState,
  deploymentId: string,
): ProductDeploymentRecord {
  const deployment =
    product.deployments.find(
      (item) =>
        item.deploymentId ===
        deploymentId,
    );

  if (!deployment) {
    throw new Error(
      `Deployment not found: ${deploymentId}`,
    );
  }

  return deployment;
}

function runFor(
  product: ProductApplicationState,
  deployment: ProductDeploymentRecord,
): ProductQualificationRunRecord {
  const run =
    product.qualificationRuns.find(
      (item) =>
        item.runId ===
        deployment.qualificationRunId,
    );

  if (!run) {
    throw new Error(
      `Qualification run not found: ${deployment.qualificationRunId}`,
    );
  }

  return run;
}

function candidateFor(
  product: ProductApplicationState,
  deployment: ProductDeploymentRecord,
): ProductCandidateRecord {
  const candidate =
    product.candidates.find(
      (item) =>
        item.candidateId ===
        deployment.candidateId,
    );

  if (!candidate) {
    throw new Error(
      `Candidate not found: ${deployment.candidateId}`,
    );
  }

  return candidate;
}

function contractFor(
  product: ProductApplicationState,
  deployment: ProductDeploymentRecord,
): ProductContractRecord {
  const contract =
    product.contracts.find(
      (item) =>
        item.contractId ===
          deployment.contractId &&
        item.version ===
          deployment.contractVersion,
    );

  if (!contract) {
    throw new Error(
      `Contract not found: ${deployment.contractId}@${deployment.contractVersion}`,
    );
  }

  return contract;
}

function assuranceDeploymentFor(
  assurance: ContinuousAssuranceState,
  deploymentId: string,
) {
  const deployment =
    assurance.deployments.find(
      (item) =>
        item.deploymentId ===
        deploymentId,
    );

  if (!deployment) {
    throw new Error(
      `Assurance deployment not found: ${deploymentId}`,
    );
  }

  return deployment;
}

export function rollbackTargetFromState(
  input: RollbackEligibilityInput,
): ProductRollbackTarget | null {
  if (
    input.currentDeploymentId ===
    input.targetDeploymentId
  ) {
    return null;
  }

  const current =
    byDeployment(
      input.product,
      input.currentDeploymentId,
    );

  const target =
    byDeployment(
      input.product,
      input.targetDeploymentId,
    );

  if (
    target.status !== "ACTIVE"
  ) {
    return null;
  }

  const currentRun =
    runFor(
      input.product,
      current,
    );

  const targetRun =
    runFor(
      input.product,
      target,
    );

  if (
    targetRun.status !== "COMPLETED" ||
    targetRun.qualificationState !==
      "QUALIFIED" ||
    !targetRun.exactArtifactBindingProven
  ) {
    return null;
  }

  if (
    targetRun.environmentId !==
      currentRun.environmentId ||
    targetRun.workloadId !==
      currentRun.workloadId
  ) {
    return null;
  }

  if (
    !input.targetDecision.allowed ||
    input.targetDecision.lifecycleState !==
      "CURRENT" ||
    input.targetDecision.approvalState !==
      "APPROVED" ||
    !input.targetDecision.approvalId
  ) {
    return null;
  }

  const targetAssurance =
    assuranceDeploymentFor(
      input.assurance,
      target.deploymentId,
    );

  if (
    targetAssurance.lifecycleState !==
      "CURRENT" ||
    !targetAssurance.exactArtifactBindingProven
  ) {
    return null;
  }

  const attestation =
    target.attestationId
      ? input.product.attestations.find(
          (item) =>
            item.attestationId ===
            target.attestationId,
        ) ?? null
      : null;

  if (!attestation || !productProofMatches(input.product, target, targetAssurance) || !attestationMatchesProof(attestation, targetAssurance)) {
    return null;
  }

  const candidate =
    candidateFor(
      input.product,
      target,
    );

  return {
    deploymentId:
      target.deploymentId,
    candidateId:
      target.candidateId,
    candidateDisplayName:
      candidate.displayName,
    candidateRepositoryOrModelId:
      candidate.repositoryOrModelId,
    candidateRevision:
      candidate.revision,
    qualificationRunId:
      target.qualificationRunId,
    contractId:
      target.contractId,
    contractVersion:
      target.contractVersion,
    attestationDigest:
      attestation.attestationDigest,
    approvalId:
      input.targetDecision.approvalId,
    createdAt:
      target.createdAt,
    reason:
      "QUALIFIED_EXACT_BOUND_APPROVED_CURRENT_ATTESTED_SAME_SCOPE",
  };
}

export function buildDeploymentAudit(
  input: {
    product:
      ProductApplicationState;
    assurance:
      ContinuousAssuranceState;
    deploymentId: string;
    decision:
      AssuranceDecision;
    rollbackTargets:
      ProductRollbackTarget[];
  },
): ProductDeploymentAudit {
  const deployment =
    byDeployment(
      input.product,
      input.deploymentId,
    );

  const candidate =
    candidateFor(
      input.product,
      deployment,
    );

  const contract =
    contractFor(
      input.product,
      deployment,
    );

  const qualification =
    runFor(
      input.product,
      deployment,
    );

  const assuranceDeployment =
    assuranceDeploymentFor(
      input.assurance,
      deployment.assuranceDeploymentId,
    );

  if (!productProofMatches(input.product, deployment, assuranceDeployment)) {
    throw new Error("CURRENT_PROOF_IDENTITY_MISMATCH: audit cannot represent a split product/assurance proof as current");
  }
  const approval =
    assuranceDeployment.activeApprovalId
      ? input.assurance.approvals.find(
          (item) =>
            item.approvalId ===
            assuranceDeployment.activeApprovalId,
        ) ?? null
      : null;

  const attestation =
    deployment.attestationId
      ? input.product.attestations.find(
          (item) =>
            item.attestationId ===
            deployment.attestationId,
        ) ?? null
      : null;

  const subjectIds =
    new Set([
      deployment.deploymentId,
      qualification.runId,
    ]);

  const productTimeline:
    ProductAuditTimelineItem[] =
      input.product.events
        .filter(
          (event) =>
            subjectIds.has(
              event.subjectId,
            ),
        )
        .map(
          (event) => ({
            recordedAt: event.recordedAt ?? null,
            appendSequence: event.appendSequence ?? input.product.events.indexOf(event) + 1,
            orderBasis: event.recordedAt ? "SERVER_RECORDED_TIME" as const : "LEGACY_APPEND_ORDER_UNPROVEN" as const,
            occurredAt:
              event.occurredAt,
            source:
              "PRODUCT" as const,
            type:
              event.type,
            actorId:
              event.actorId,
            detail:
              event.detail,
          }),
        );

  const assuranceTimeline:
    ProductAuditTimelineItem[] =
      input.assurance.events
        .filter(
          (event) =>
            event.deploymentId ===
            deployment
              .assuranceDeploymentId,
        )
        .map(
          (event) => ({
            recordedAt: event.recordedAt ?? null,
            appendSequence: event.appendSequence ?? input.assurance.events.indexOf(event) + 1,
            orderBasis: event.recordedAt ? "SERVER_RECORDED_TIME" as const : "LEGACY_APPEND_ORDER_UNPROVEN" as const,
            occurredAt:
              event.occurredAt,
            source:
              "ASSURANCE" as const,
            type:
              event.type,
            actorId: null,
            detail:
              event.detail,
          }),
        );

  const timeline = [...productTimeline, ...assuranceTimeline].sort((left, right) => {
    // Caller occurrence time is descriptive only, never authority chronology.
    if (left.recordedAt && right.recordedAt) return left.recordedAt.localeCompare(right.recordedAt) || left.source.localeCompare(right.source) || left.appendSequence - right.appendSequence;
    if (!!left.recordedAt !== !!right.recordedAt) return left.recordedAt ? 1 : -1;
    return left.source.localeCompare(right.source) || left.appendSequence - right.appendSequence;
  });

  const payload = {
    schema:
      "admissary-product-deployment-audit/v1" as const,
    deployment:
      structuredClone(
        deployment,
      ),
    candidate:
      structuredClone(
        candidate,
      ),
    contract:
      structuredClone(
        contract,
      ),
    qualification:
      structuredClone(
        qualification,
      ),
    decision:
      structuredClone(
        input.decision,
      ),
    approval:
      approval
        ? structuredClone(
            approval,
          )
        : null,
    attestation:
      attestation
        ? structuredClone(
            attestation,
          )
        : null,
    exactIdentity: {
      repositoryOrModelId:
        candidate
          .repositoryOrModelId,
      revision:
        candidate.revision,
      tokenizerRevision:
        candidate
          .tokenizerRevision,
      artifactManifestDigest:
        candidate
          .artifactManifestDigest,
      contractDigest:
        contract.digest,
      policyDigest:
        qualification
          .policyDigest,
      evaluationDigest:
        qualification
          .evaluationDigest,
      evidenceGraphRootDigest:
        qualification
          .evidenceGraphRootDigest,
      environmentId:
        qualification
          .environmentId,
      workloadId:
        qualification
          .workloadId,
    },
    timeline,
    rollbackTargets:
      structuredClone(
        input.rollbackTargets,
      ),
  };

  return {
    ...payload,
    auditDigest:
      digestCanonicalJson(
        payload,
      ),
  };
}
