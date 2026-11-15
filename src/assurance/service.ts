import { recordEventOrder } from "../persistence/event-order.js";
import {
  digestCanonicalJson,
} from "../qualification/canonical.js";
import type {
  QualificationState,
} from "../qualification/types.js";
import type {
  AssuranceRepository,
} from "./store.js";
import {
  AssuranceError,
} from "./store.js";
import type {
  AssuranceDecision,
  AssuranceDeploymentRecord,
  AssuranceEvent,
  ApprovalScope,
  ContinuousAssuranceState,
  DeploymentAssuranceIdentity,
  HuggingFaceWatchSnapshot,
  ReassessmentRequest,
  ScopedApprovalRecord,
  WatchCheckRecord,
  WatchComparison,
} from "./types.js";

function canonicalIso(
  value: string,
  label: string,
): string {
  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    ) ||
    date.toISOString() !==
      value
  ) {
    throw new AssuranceError(
      "ASSURANCE_INVALID_TIMESTAMP",
      `${label} must be canonical ISO-8601`,
    );
  }

  return value;
}

function eventId(
  type:
    AssuranceEvent["type"],
  deploymentId: string,
  occurredAt: string,
  detail: string,
): string {
  return `${type.toLowerCase()}-${digestCanonicalJson({
    deploymentId,
    occurredAt,
    detail,
  }).slice(0, 24)}`;
}

function pushEvent(
  events:
    AssuranceEvent[],
  input: {
    deploymentId: string;
    occurredAt: string;
    type:
      AssuranceEvent["type"];
    detail: string;
  },
): void {
  events.push({
    ...recordEventOrder(events),
    eventId:
      eventId(
        input.type,
        input.deploymentId,
        input.occurredAt,
        input.detail,
      ),
    deploymentId:
      input.deploymentId,
    occurredAt:
      input.occurredAt,
    type:
      input.type,
    detail:
      input.detail,
  });
}

export function deploymentAssuranceIdentityDigest(
  identity:
    DeploymentAssuranceIdentity,
): string {
  return digestCanonicalJson(
    identity,
  );
}

function candidateIdentityDigest(
  identity:
    DeploymentAssuranceIdentity,
): string {
  return digestCanonicalJson({
    repository:
      identity.candidateRepository,
    revision:
      identity.candidateRevision,
    tokenizerRevision:
      identity.tokenizerRevision,
    artifactManifestDigest:
      identity.artifactManifestDigest,
  });
}

function approvalScope(
  deployment:
    AssuranceDeploymentRecord,
): ApprovalScope {
  return {
    deploymentId:
      deployment.deploymentId,
    qualificationRunId:
      deployment.qualificationRunId,
    environmentId:
      deployment.identity
        .environmentId,
    workloadId:
      deployment.identity
        .workloadId,
    candidateIdentityDigest:
      candidateIdentityDigest(
        deployment.identity,
      ),
    contractDigest:
      deployment.identity
        .contractDigest,
    policyDigest:
      deployment.identity
        .policyDigest,
    evaluationDigest:
      deployment.identity
        .evaluationDigest,
    evidenceGraphRootDigest:
      deployment.identity
        .evidenceGraphRootDigest,
    fullIdentityDigest:
      deploymentAssuranceIdentityDigest(
        deployment.identity,
      ),
  };
}

function findDeployment(
  state:
    ContinuousAssuranceState,
  deploymentId: string,
): AssuranceDeploymentRecord {
  const deployment =
    state.deployments.find(
      (item) =>
        item.deploymentId ===
        deploymentId,
    );

  if (!deployment) {
    throw new AssuranceError(
      "ASSURANCE_DEPLOYMENT_NOT_FOUND",
      `Deployment not found: ${deploymentId}`,
    );
  }

  return deployment;
}

function activeApproval(
  state:
    ContinuousAssuranceState,
  deployment:
    AssuranceDeploymentRecord,
): ScopedApprovalRecord | null {
  if (
    !deployment.activeApprovalId
  ) {
    return null;
  }

  return (
    state.approvals.find(
      (item) =>
        item.approvalId ===
        deployment.activeApprovalId,
    ) ??
    null
  );
}

function approvalScopeMatches(
  approval:
    ScopedApprovalRecord,
  deployment:
    AssuranceDeploymentRecord,
): boolean {
  return digestCanonicalJson(approval.scope) === digestCanonicalJson(approvalScope(deployment));
}

function ageExceeded(
  deployment:
    AssuranceDeploymentRecord,
  now: string,
): boolean {
  if (
    !deployment.monitoringPolicy
      .failClosedWhenOverdue
  ) {
    return false;
  }

  if (
    deployment
      .lastSuccessfulCheckAt ===
    null
  ) {
    return true;
  }

  const elapsed =
    new Date(now).getTime() -
    new Date(
      deployment
        .lastSuccessfulCheckAt,
    ).getTime();

  return (
    elapsed >
    deployment.monitoringPolicy
      .maxEvidenceAgeMs
  );
}

export class ContinuousAssuranceService {
  private proofListeners: Array<() => Promise<void>> = [];
  onCurrentProofChanged(listener: () => Promise<void>): void { this.proofListeners.push(listener); }
  constructor(
    private readonly repository:
      AssuranceRepository,
  ) {}

  async registerDeployment(
    input: {
      deployment:
        AssuranceDeploymentRecord;
      occurredAt: string;
    },
  ): Promise<void> {
    canonicalIso(
      input.occurredAt,
      "occurredAt",
    );

    await this.repository.transact(
      (state) => {
        if (
          state.deployments.some(
            (item) =>
              item.deploymentId ===
              input.deployment
                .deploymentId,
          )
        ) {
          throw new AssuranceError(
            "ASSURANCE_DUPLICATE_DEPLOYMENT",
            `Deployment already exists: ${input.deployment.deploymentId}`,
          );
        }

        if (typeof input.deployment.monitoringPolicy.maxEvidenceAgeMs !== "number" ||
            !Number.isFinite(input.deployment.monitoringPolicy.maxEvidenceAgeMs) ||
            input.deployment.monitoringPolicy.maxEvidenceAgeMs <= 0 ||
            input.deployment.monitoringPolicy.failClosedWhenOverdue !== true) {
          throw new AssuranceError(
            "ASSURANCE_MONITORING_POLICY_ERROR",
            "maxEvidenceAgeMs must be positive",
          );
        }

        state.deployments.push(
          structuredClone(
            input.deployment,
          ),
        );

        pushEvent(
          state.events,
          {
            deploymentId:
              input.deployment
                .deploymentId,
            occurredAt:
              input.occurredAt,
            type:
              "DEPLOYMENT_REGISTERED",
            detail:
              `identity=${deploymentAssuranceIdentityDigest(input.deployment.identity)}`,
          },
        );
      },
    );
  }

  async approve(
    input: {
      deploymentId: string;
      actorId: string;
      issuedAt: string;
      expiresAt: string | null;
      reason: string;
    },
  ): Promise<ScopedApprovalRecord> {
    canonicalIso(
      input.issuedAt,
      "issuedAt",
    );

    if (
      input.expiresAt
    ) {
      canonicalIso(
        input.expiresAt,
        "expiresAt",
      );

      if (
        new Date(
          input.expiresAt,
        ).getTime() <=
        new Date(
          input.issuedAt,
        ).getTime()
      ) {
        throw new AssuranceError(
          "ASSURANCE_APPROVAL_EXPIRY_ERROR",
          "Approval expiry must be after issuance",
        );
      }
    }

    return this.repository.transact(
      (state) => {
        const deployment =
          findDeployment(
            state,
            input.deploymentId,
          );

        if (
          deployment
            .qualificationState !==
          "QUALIFIED"
        ) {
          throw new AssuranceError(
            "ASSURANCE_QUALIFICATION_REQUIRED",
            `Deployment qualification is ${deployment.qualificationState}`,
          );
        }

        if (
          !deployment
            .exactArtifactBindingProven
        ) {
          throw new AssuranceError(
            "ASSURANCE_EXACT_BINDING_REQUIRED",
            "Exact artifact binding is required for approval",
          );
        }

        if (
          deployment.lifecycleState !==
          "CURRENT"
        ) {
          throw new AssuranceError(
            "ASSURANCE_CURRENT_REQUIRED",
            `Deployment lifecycle is ${deployment.lifecycleState}`,
          );
        }

        const scope =
          approvalScope(
            deployment,
          );

        const approvalId =
          `approval-${digestCanonicalJson({
            scope,
            actorId:
              input.actorId,
            issuedAt:
              input.issuedAt,
          }).slice(0, 24)}`;

        if (
          state.approvals.some(
            (item) =>
              item.approvalId ===
              approvalId,
          )
        ) {
          throw new AssuranceError(
            "ASSURANCE_DUPLICATE_APPROVAL",
            `Approval already exists: ${approvalId}`,
          );
        }

        const approval:
          ScopedApprovalRecord = {
            approvalId,
            scope,
            state:
              "APPROVED",
            actorId:
              input.actorId,
            issuedAt:
              input.issuedAt,
            expiresAt:
              input.expiresAt,
            stateChangedAt:
              input.issuedAt,
            reason:
              input.reason,
          };

        state.approvals.push(
          approval,
        );

        deployment.activeApprovalId =
          approvalId;
        deployment.updatedAt =
          input.issuedAt;

        pushEvent(
          state.events,
          {
            deploymentId:
              input.deploymentId,
            occurredAt:
              input.issuedAt,
            type:
              "APPROVAL_GRANTED",
            detail:
              `approval=${approvalId}; scope=${scope.fullIdentityDigest}`,
          },
        );

        return structuredClone(
          approval,
        );
      },
    );
  }

  async revokeApproval(
    input: {
      deploymentId: string;
      actorId: string;
      occurredAt: string;
      reason: string;
    },
  ): Promise<ScopedApprovalRecord> {
    canonicalIso(
      input.occurredAt,
      "occurredAt",
    );

    return this.repository.transact(
      (state) => {
        const deployment =
          findDeployment(
            state,
            input.deploymentId,
          );

        const approval =
          activeApproval(
            state,
            deployment,
          );

        if (
          !approval ||
          approval.state !==
            "APPROVED"
        ) {
          throw new AssuranceError(
            "ASSURANCE_APPROVAL_REQUIRED",
            "An active APPROVED approval is required for revocation",
          );
        }

        approval.state =
          "REVOKED";
        approval.stateChangedAt =
          input.occurredAt;
        approval.reason =
          input.reason;

        deployment.lifecycleState =
          "REVOKED";
        deployment.updatedAt =
          input.occurredAt;

        pushEvent(
          state.events,
          {
            deploymentId:
              input.deploymentId,
            occurredAt:
              input.occurredAt,
            type:
              "APPROVAL_REVOKED",
            detail:
              `${approval.approvalId}; actor=${input.actorId}; ${input.reason}`,
          },
        );

        return structuredClone(
          approval,
        );
      },
    );
  }

  async expireApproval(
    input: {
      deploymentId: string;
      occurredAt: string;
    },
  ): Promise<ScopedApprovalRecord> {
    canonicalIso(
      input.occurredAt,
      "occurredAt",
    );

    return this.repository.transact(
      (state) => {
        const deployment =
          findDeployment(
            state,
            input.deploymentId,
          );

        const approval =
          activeApproval(
            state,
            deployment,
          );

        if (
          !approval ||
          approval.state !==
            "APPROVED"
        ) {
          throw new AssuranceError(
            "ASSURANCE_APPROVAL_REQUIRED",
            "An active APPROVED approval is required for expiry",
          );
        }

        if (
          !approval.expiresAt ||
          new Date(
            input.occurredAt,
          ).getTime() <
          new Date(
            approval.expiresAt,
          ).getTime()
        ) {
          throw new AssuranceError(
            "ASSURANCE_APPROVAL_NOT_EXPIRED",
            "Approval has not reached its expiry",
          );
        }

        approval.state =
          "EXPIRED";
        approval.stateChangedAt =
          input.occurredAt;

        deployment.lifecycleState =
          "EXPIRED";
        deployment.updatedAt =
          input.occurredAt;

        pushEvent(
          state.events,
          {
            deploymentId:
              input.deploymentId,
            occurredAt:
              input.occurredAt,
            type:
              "APPROVAL_EXPIRED",
            detail:
              approval.approvalId,
          },
        );

        return structuredClone(
          approval,
        );
      },
    );
  }

  async recordWatchError(
    input: {
      deploymentId: string;
      checkedAt: string;
      previousSnapshotDigest:
        string | null;
      errorCode: string;
      errorDetail: string;
    },
  ): Promise<WatchCheckRecord> {
    canonicalIso(
      input.checkedAt,
      "checkedAt",
    );

    return this.repository.transact(
      (state) => {
        const deployment =
          findDeployment(
            state,
            input.deploymentId,
          );

        const check:
          WatchCheckRecord = {
            checkId:
              `watch-${digestCanonicalJson(input).slice(0, 24)}`,
            deploymentId:
              input.deploymentId,
            source:
              "HUGGING_FACE",
            outcome:
              "CHECK_ERROR",
            checkedAt:
              input.checkedAt,
            previousSnapshotDigest:
              input.previousSnapshotDigest,
            currentSnapshotDigest:
              null,
            changes: [],
            invalidatedNodes: [],
            errorCode:
              input.errorCode,
            errorDetail:
              input.errorDetail,
          };

        state.watchChecks.push(
          check,
        );

        deployment.monitoringStatus =
          "DEGRADED";
        deployment.lastCheckAt =
          input.checkedAt;
        deployment.updatedAt =
          input.checkedAt;

        pushEvent(
          state.events,
          {
            deploymentId:
              input.deploymentId,
            occurredAt:
              input.checkedAt,
            type:
              "WATCH_ERROR",
            detail:
              `${input.errorCode}: ${input.errorDetail}`,
          },
        );

        return structuredClone(
          check,
        );
      },
    );
  }

  async recordUnchangedWatch(
    input: {
      deploymentId: string;
      checkedAt: string;
      previousSnapshot:
        HuggingFaceWatchSnapshot;
      currentSnapshot:
        HuggingFaceWatchSnapshot;
    },
  ): Promise<WatchCheckRecord> {
    canonicalIso(
      input.checkedAt,
      "checkedAt",
    );

    return this.repository.transact(
      (state) => {
        const deployment =
          findDeployment(
            state,
            input.deploymentId,
          );

        const check:
          WatchCheckRecord = {
            checkId:
              `watch-${digestCanonicalJson(input).slice(0, 24)}`,
            deploymentId:
              input.deploymentId,
            source:
              "HUGGING_FACE",
            outcome:
              "UNCHANGED",
            checkedAt:
              input.checkedAt,
            previousSnapshotDigest:
              input.previousSnapshot
                .snapshotDigest,
            currentSnapshotDigest:
              input.currentSnapshot
                .snapshotDigest,
            changes: [],
            invalidatedNodes: [],
            errorCode: null,
            errorDetail: null,
          };

        state.watchChecks.push(
          check,
        );

        deployment.monitoringStatus =
          "HEALTHY";
        deployment.lastCheckAt =
          input.checkedAt;
        deployment.lastSuccessfulCheckAt =
          input.checkedAt;
        deployment.updatedAt =
          input.checkedAt;

        pushEvent(
          state.events,
          {
            deploymentId:
              input.deploymentId,
            occurredAt:
              input.checkedAt,
            type:
              "WATCH_UNCHANGED",
            detail:
              input.currentSnapshot
                .snapshotDigest,
          },
        );

        return structuredClone(
          check,
        );
      },
    );
  }

  async recordMaterialChange(
    input: {
      deploymentId: string;
      checkedAt: string;
      comparison:
        WatchComparison;
      nextIdentity:
        DeploymentAssuranceIdentity;
      reason: string;
    },
  ): Promise<{
    check:
      WatchCheckRecord;
    reassessment:
      ReassessmentRequest;
  }> {
    canonicalIso(
      input.checkedAt,
      "checkedAt",
    );

    if (
      input.comparison.outcome !==
      "MATERIAL_CHANGE" ||
      input.comparison
        .changes.length === 0
    ) {
      throw new AssuranceError(
        "ASSURANCE_MATERIAL_CHANGE_REQUIRED",
        "Material-change record requires a material comparison",
      );
    }

    return this.repository.transact(
      (state) => {
        const deployment =
          findDeployment(
            state,
            input.deploymentId,
          );

        const previousRunId =
          deployment.qualificationRunId;

        const check:
          WatchCheckRecord = {
            checkId:
              `watch-${digestCanonicalJson(input.comparison).slice(0, 24)}`,
            deploymentId:
              input.deploymentId,
            source:
              "HUGGING_FACE",
            outcome:
              "MATERIAL_CHANGE",
            checkedAt:
              input.checkedAt,
            previousSnapshotDigest:
              input.comparison
                .previousSnapshotDigest,
            currentSnapshotDigest:
              input.comparison
                .currentSnapshotDigest,
            changes: [
              ...input.comparison
                .changes,
            ],
            invalidatedNodes: [
              ...input.comparison
                .invalidatedNodes,
            ],
            errorCode: null,
            errorDetail: null,
          };

        state.watchChecks.push(
          check,
        );

        deployment.identity =
          structuredClone(
            input.nextIdentity,
          );
        deployment.lifecycleState =
          "REASSESSMENT_REQUIRED";
        deployment.monitoringStatus =
          "HEALTHY";
        deployment.lastCheckAt =
          input.checkedAt;
        deployment.lastSuccessfulCheckAt =
          input.checkedAt;
        deployment.latestInvalidatedNodes = [
          ...input.comparison
            .invalidatedNodes,
        ];
        deployment.updatedAt =
          input.checkedAt;

        const request:
          ReassessmentRequest = {
            requestId:
              `reassessment-${digestCanonicalJson({
                deploymentId:
                  input.deploymentId,
                previousRunId,
                checkedAt:
                  input.checkedAt,
                changes:
                  input.comparison
                    .changes,
              }).slice(0, 24)}`,
            deploymentId:
              input.deploymentId,
            previousQualificationRunId:
              previousRunId,
            requestedAt:
              input.checkedAt,
            reason:
              input.reason,
            invalidatedNodes: [
              ...input.comparison
                .invalidatedNodes,
            ],
            status:
              "REQUESTED",
            completedAt: null,
            replacementQualificationRunId:
              null,
          };

        state.reassessments.push(
          request,
        );

        pushEvent(
          state.events,
          {
            deploymentId:
              input.deploymentId,
            occurredAt:
              input.checkedAt,
            type:
              "MATERIAL_CHANGE_DETECTED",
            detail:
              `${input.comparison.changes.join(",")}; invalidated=${input.comparison.invalidatedNodes.join(",")}`,
          },
        );

        pushEvent(
          state.events,
          {
            deploymentId:
              input.deploymentId,
            occurredAt:
              input.checkedAt,
            type:
              "REASSESSMENT_REQUESTED",
            detail:
              request.requestId,
          },
        );

        return {
          check:
            structuredClone(
              check,
            ),
          reassessment:
            structuredClone(
              request,
            ),
        };
      },
    );
  }

  async requestReassessment(input: { deploymentId: string; requestedAt: string; reason: string }): Promise<ReassessmentRequest> {
    canonicalIso(input.requestedAt, "requestedAt");
    return this.repository.transact(state => {
      const d = findDeployment(state, input.deploymentId);
      const pending = state.reassessments.find(r => r.deploymentId === d.deploymentId && r.status === "REQUESTED");
      if (pending) return structuredClone(pending);
      const request: ReassessmentRequest = { requestId: `reassessment-${digestCanonicalJson({deploymentId:d.deploymentId,runId:d.qualificationRunId,requestedAt:input.requestedAt}).slice(0,24)}`,
        deploymentId:d.deploymentId,previousQualificationRunId:d.qualificationRunId,requestedAt:input.requestedAt,reason:input.reason,
        invalidatedNodes:["decision:qualification"],status:"REQUESTED",completedAt:null,replacementQualificationRunId:null };
      state.reassessments.push(request); d.lifecycleState="REASSESSMENT_REQUIRED"; d.updatedAt=input.requestedAt;
      pushEvent(state.events,{deploymentId:d.deploymentId,occurredAt:input.requestedAt,type:"REASSESSMENT_REQUESTED",detail:request.requestId});
      return structuredClone(request);
    });
  }

  async completeReassessment(
    input: {
      deploymentId: string;
      requestId: string;
      replacementQualificationRunId:
        string;
      qualificationState:
        QualificationState;
      exactArtifactBindingProven:
        boolean;
      evidenceGraphRootDigest:
        string;
      completedAt: string;
      expectedIdentityDigest?: string;
    },
  ): Promise<void> {
    canonicalIso(
      input.completedAt,
      "completedAt",
    );

    await this.repository.transact(
      (state) => {
        const deployment =
          findDeployment(
            state,
            input.deploymentId,
          );

        if (input.expectedIdentityDigest !== undefined && deploymentAssuranceIdentityDigest(deployment.identity) !== input.expectedIdentityDigest) {
          throw new AssuranceError("ASSURANCE_REASSESSMENT_IDENTITY_CHANGED", "Observed replacement identity changed during reconciliation");
        }
        const request =
          state.reassessments.find(
            (item) =>
              item.requestId ===
              input.requestId &&
              item.deploymentId ===
              input.deploymentId,
          );

        if (
          !request ||
          request.status !==
            "REQUESTED"
        ) {
          throw new AssuranceError(
            "ASSURANCE_REASSESSMENT_NOT_FOUND",
            "Requested reassessment was not found",
          );
        }

        request.status =
          "COMPLETED";
        request.completedAt =
          input.completedAt;
        request.replacementQualificationRunId =
          input.replacementQualificationRunId;

        deployment.qualificationRunId =
          input.replacementQualificationRunId;
        deployment.qualificationState =
          input.qualificationState;
        deployment.exactArtifactBindingProven =
          input.exactArtifactBindingProven;
        deployment.identity
          .evidenceGraphRootDigest =
          input.evidenceGraphRootDigest;
        deployment.lifecycleState =
          "CURRENT";
        deployment.activeApprovalId =
          null;
        deployment.latestInvalidatedNodes = [];
        deployment.updatedAt =
          input.completedAt;

        pushEvent(
          state.events,
          {
            deploymentId:
              input.deploymentId,
            occurredAt:
              input.completedAt,
            type:
              "REASSESSMENT_COMPLETED",
            detail:
              `${request.requestId}; replacement=${input.replacementQualificationRunId}; qualification=${input.qualificationState}`,
          },
        );
      },
    );
    for (const listener of this.proofListeners) await listener();
  }

  async decision(
    deploymentId: string,
    now: string,
  ): Promise<AssuranceDecision> {
    canonicalIso(
      now,
      "now",
    );

    const state =
      await this.repository.read();

    const deployment =
      findDeployment(
        state,
        deploymentId,
      );

    const approval =
      activeApproval(
        state,
        deployment,
      );

    const reasons:
      string[] = [];

    if (
      deployment
        .qualificationState !==
      "QUALIFIED"
    ) {
      reasons.push(
        `QUALIFICATION_${deployment.qualificationState}`,
      );
    }

    if (
      !deployment
        .exactArtifactBindingProven
    ) {
      reasons.push(
        "EXACT_ARTIFACT_BINDING_UNPROVEN",
      );
    }

    if (
      deployment.lifecycleState !==
      "CURRENT"
    ) {
      reasons.push(
        `LIFECYCLE_${deployment.lifecycleState}`,
      );
    }

    if (approval && new Date(now).getTime() < new Date(approval.issuedAt).getTime()) reasons.push("APPROVAL_NOT_YET_EFFECTIVE");
    if (!approval) {
      reasons.push(
        "APPROVAL_NONE",
      );
    } else {
      if (
        approval.state !==
        "APPROVED"
      ) {
        reasons.push(
          `APPROVAL_${approval.state}`,
        );
      }

      if (
        approval.expiresAt &&
        new Date(now).getTime() >=
          new Date(
            approval.expiresAt,
          ).getTime()
      ) {
        reasons.push(
          "APPROVAL_EXPIRED",
        );
      }

      if (
        !approvalScopeMatches(
          approval,
          deployment,
        )
      ) {
        reasons.push(
          "APPROVAL_SCOPE_MISMATCH",
        );
      }
    }

    if (
      ageExceeded(
        deployment,
        now,
      )
    ) {
      reasons.push(
        "ASSURANCE_CHECK_OVERDUE",
      );
    }

    return {
      allowed:
        reasons.length === 0,
      reasons,
      lifecycleState:
        deployment.lifecycleState,
      monitoringStatus:
        deployment.monitoringStatus,
      approvalState:
        approval?.state ??
        "NONE",
      approvalId:
        approval?.approvalId ??
        null,
      approvalExpiresAt:
        approval?.expiresAt ??
        null,
      identityDigest:
        deploymentAssuranceIdentityDigest(
          deployment.identity,
        ),
    };
  }

  async state():
    Promise<
      ContinuousAssuranceState
    > {
    return this.repository.read();
  }
}
