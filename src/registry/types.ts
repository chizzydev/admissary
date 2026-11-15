import type {
  AuthorizationState,
  QualificationState,
  ValidityState,
} from "../qualification/types.js";

export interface RegistryOrganization {
  id: string;
  name: string;
}

export interface RegistryEnvironment {
  id: string;
  organizationId: string;
  name: string;
  tier:
    | "DEVELOPMENT"
    | "STAGING"
    | "PRODUCTION";
  region?: string;
}

export interface RegistryWorkload {
  id: string;
  packId: string;
  packVersion: string;
  packDigest: string;
  name: string;
}

export interface RegistryCandidate {
  id: string;
  organizationId: string;
  displayName: string;
  source:
    | "HUGGING_FACE"
    | "DOLPHIN"
    | "OTHER";
  repositoryOrModelId: string;
  accountableOwner: string;
  createdAt: string;
}

export interface RegistryArtifactRevision {
  id: string;
  candidateId: string;
  immutableRevision: string | null;
  tokenizerRevision: string | null;
  artifactDigest: string | null;
  runtimeBindingScope:
    | "PROVIDER_MODEL_IDENTITY"
    | "EXACT_ARTIFACT";
  exactArtifactBindingProven: boolean;
  createdAt: string;
}

export interface RegistryDeployment {
  id: string;
  organizationId: string;
  environmentId: string;
  workloadId: string;
  contractId: string;
  contractVersion: string;
  candidateId: string;
  artifactRevisionId: string;
  qualificationState: QualificationState;
  authorizationState: AuthorizationState;
  validityState: ValidityState;
  activeBlockers: string[];
  latestQualificationRunId: string | null;
  latestAttestationDigest: string | null;
  nextReassessmentAt: string | null;
  updatedAt: string;
}

export interface RegistryEvent {
  id: string;
  type:
    | "ORGANIZATION_REGISTERED"
    | "ENVIRONMENT_REGISTERED"
    | "WORKLOAD_REGISTERED"
    | "CANDIDATE_REGISTERED"
    | "ARTIFACT_REGISTERED"
    | "DEPLOYMENT_REGISTERED"
    | "DEPLOYMENT_DECISION_UPDATED";
  entityId: string;
  occurredAt: string;
  detail: string;
}

export interface ModelRegistryState {
  schema: "admissary-model-registry/v1";
  revision: number;
  organizations: RegistryOrganization[];
  environments: RegistryEnvironment[];
  workloads: RegistryWorkload[];
  candidates: RegistryCandidate[];
  artifactRevisions: RegistryArtifactRevision[];
  deployments: RegistryDeployment[];
  events: RegistryEvent[];
}

export interface RegistryDeploymentSummary {
  deploymentId: string;
  environment: string;
  workload: string;
  candidate: string;
  artifactIdentity: string;
  qualificationState: QualificationState;
  authorizationState: AuthorizationState;
  validityState: ValidityState;
  blockers: string[];
  nextReassessmentAt: string | null;
  exactArtifactBindingProven: boolean;
}
