import type {
  AuthorizationState,
  QualificationState,
  ValidityState,
} from "../qualification/types.js";

export type ActorRole =
  | "VIEWER"
  | "APPROVER"
  | "ADMIN"
  | "SYSTEM";

export interface ActorIdentity {
  id: string;
  roles: ActorRole[];
}

export interface QualificationRunRecord {
  runId: string;
  contractId: string;
  contractVersion: string;
  contractDigest: string;
  candidateIdentity: string;
  qualificationState: QualificationState;
  graphRootDigest: string;
  exactArtifactBindingProven: boolean;
  finalizedAt: string;
  sourceArtifactDigest: string;
}

export interface AuthorizationEvent {
  id: string;
  runId: string;
  state: AuthorizationState;
  actorId: string;
  actorRoles: ActorRole[];
  occurredAt: string;
  reason: string;
}

export interface ValidityEvent {
  id: string;
  runId: string;
  state: ValidityState;
  actorId: string;
  occurredAt: string;
  reason: string;
}

export interface AuditEvent {
  id: string;
  type:
    | "QUALIFICATION_FINALIZED"
    | "AUTHORIZATION_APPROVED"
    | "AUTHORIZATION_REVOKED"
    | "VALIDITY_STALE";
  runId: string;
  actorId: string;
  occurredAt: string;
  detail: string;
}

export interface PersistenceState {
  schema: "admissary-persistence/v1";
  revision: number;
  qualificationRuns: QualificationRunRecord[];
  authorizationEvents: AuthorizationEvent[];
  validityEvents: ValidityEvent[];
  auditEvents: AuditEvent[];
}

export interface ProofTimelineEntry {
  occurredAt: string;
  type:
    | "QUALIFICATION"
    | "AUTHORIZATION"
    | "VALIDITY"
    | "AUDIT";
  runId: string;
  actorId: string;
  state?: string;
  detail: string;
}

export interface DeploymentAuthorizationDecision {
  allowed: boolean;
  reasons: string[];
  qualificationState: QualificationState;
  authorizationState: AuthorizationState;
  validityState: ValidityState;
  exactArtifactBindingProven: boolean;
}
