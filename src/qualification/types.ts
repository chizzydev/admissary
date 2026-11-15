export type EvidenceState = "PASS" | "FAIL" | "UNKNOWN" | "ERROR";

export type QualificationState =
  | "QUALIFIED"
  | "UNFIT"
  | "DISQUALIFIED"
  | "REVIEW_REQUIRED"
  | "INCOMPLETE"
  | "ERROR";

export type AuthorizationState =
  | "NOT_REQUESTED"
  | "PENDING"
  | "APPROVED"
  | "REVOKED";

export type ValidityState = "CURRENT" | "STALE";

export type ObligationKind = "DETERMINISTIC" | "SEMANTIC" | "EMPIRICAL";

export type Criticality = "MANDATORY" | "ADVISORY";

export interface Obligation {
  id: string;
  kind: ObligationKind;
  criticality: Criticality;
  evaluator: string;
  dependencies: string[];
  requirement: unknown;
}

export interface ObligationResult {
  obligationId: string;
  kind: ObligationKind;
  criticality: Criticality;
  state: EvidenceState;
  detail?: string;
}
