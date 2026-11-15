import type {
  QualificationState,
} from "../qualification/types.js";

export type AssuranceLifecycleState =
  | "CURRENT"
  | "REASSESSMENT_REQUIRED"
  | "EXPIRED"
  | "REVOKED";

export type MonitoringStatus =
  | "HEALTHY"
  | "DEGRADED";

export interface DeploymentAssuranceIdentity {
  candidateRepository: string;
  candidateRevision: string;
  tokenizerRevision: string;
  artifactManifestDigest: string;
  contractId: string;
  contractVersion: string;
  contractDigest: string;
  policyVersion: string;
  policyDigest: string;
  evaluationSuite: string;
  evaluationDigest: string;
  evidenceGraphRootDigest: string;
  environmentId: string;
  workloadId: string;
}

export interface MonitoringPolicy {
  maxEvidenceAgeMs: number;
  failClosedWhenOverdue: boolean;
}

export interface AssuranceDeploymentRecord {
  deploymentId: string;
  qualificationRunId: string;
  qualificationState: QualificationState;
  exactArtifactBindingProven: boolean;
  identity: DeploymentAssuranceIdentity;
  lifecycleState: AssuranceLifecycleState;
  activeApprovalId: string | null;
  monitoringStatus: MonitoringStatus;
  monitoringPolicy: MonitoringPolicy;
  lastSuccessfulCheckAt: string | null;
  lastCheckAt: string | null;
  latestInvalidatedNodes: string[];
  createdAt: string;
  updatedAt: string;
}

export type ScopedApprovalState =
  | "APPROVED"
  | "REVOKED"
  | "EXPIRED";

export interface ApprovalScope {
  deploymentId: string;
  qualificationRunId: string;
  environmentId: string;
  workloadId: string;
  candidateIdentityDigest: string;
  contractDigest: string;
  policyDigest: string;
  evaluationDigest: string;
  evidenceGraphRootDigest: string;
  fullIdentityDigest: string;
}

export interface ScopedApprovalRecord {
  approvalId: string;
  scope: ApprovalScope;
  state: ScopedApprovalState;
  actorId: string;
  issuedAt: string;
  expiresAt: string | null;
  stateChangedAt: string;
  reason: string;
}

export type WatchChangeKind =
  | "REPOSITORY_REVISION"
  | "MODEL_METADATA"
  | "FILE_MANIFEST"
  | "MODEL_CARD"
  | "LICENSE"
  | "CONFIG"
  | "REMOTE_CODE";

export interface HuggingFaceWatchSnapshot {
  schema: "admissary-hf-watch-snapshot/v1";
  repository: string;
  requestedRevision: string;
  resolvedRevision: string;
  modelMetadataDigest: string;
  fileManifestDigest: string;
  modelCardDigest: string | null;
  licenseDigest: string | null;
  configDigest: string | null;
  remoteCodeDigest: string;
  evidenceBundleDigest: string;
  capturedAt: string;
  snapshotDigest: string;
}

export interface WatchComparison {
  outcome:
    | "UNCHANGED"
    | "MATERIAL_CHANGE";
  changes: WatchChangeKind[];
  invalidatedNodes: string[];
  previousSnapshotDigest: string;
  currentSnapshotDigest: string;
}

export interface WatchCheckRecord {
  checkId: string;
  deploymentId: string;
  source: "HUGGING_FACE";
  outcome:
    | "UNCHANGED"
    | "MATERIAL_CHANGE"
    | "CHECK_ERROR";
  checkedAt: string;
  previousSnapshotDigest: string | null;
  currentSnapshotDigest: string | null;
  changes: WatchChangeKind[];
  invalidatedNodes: string[];
  errorCode: string | null;
  errorDetail: string | null;
}

export interface ReassessmentRequest {
  requestId: string;
  deploymentId: string;
  previousQualificationRunId: string;
  requestedAt: string;
  reason: string;
  invalidatedNodes: string[];
  status:
    | "REQUESTED"
    | "COMPLETED";
  completedAt: string | null;
  replacementQualificationRunId: string | null;
}

export interface AssuranceEvent {
  recordedAt?: string;
  appendSequence?: number;
  eventId: string;
  deploymentId: string;
  occurredAt: string;
  type:
    | "DEPLOYMENT_REGISTERED"
    | "APPROVAL_GRANTED"
    | "APPROVAL_REVOKED"
    | "APPROVAL_EXPIRED"
    | "WATCH_UNCHANGED"
    | "WATCH_ERROR"
    | "MATERIAL_CHANGE_DETECTED"
    | "REASSESSMENT_REQUESTED"
    | "REASSESSMENT_COMPLETED";
  detail: string;
}

export interface ContinuousAssuranceState {
  schema:
    "admissary-continuous-assurance/v1";
  revision: number;
  deployments:
    AssuranceDeploymentRecord[];
  approvals:
    ScopedApprovalRecord[];
  watchChecks:
    WatchCheckRecord[];
  reassessments:
    ReassessmentRequest[];
  events:
    AssuranceEvent[];
}

export interface AssuranceDecision {
  allowed: boolean;
  reasons: string[];
  lifecycleState:
    AssuranceLifecycleState;
  monitoringStatus:
    MonitoringStatus;
  approvalState:
    ScopedApprovalState | "NONE";
  approvalId: string | null;
  approvalExpiresAt: string | null;
  identityDigest: string;
}
