import type {
  CandidateSelectionPolicy,
  CandidateSelectionResult,
  SelectionCandidate,
} from "../selection/candidate-selection.js";
import type {
  GuidanceMappingPack,
} from "../guidance/mapping.js";
import type {
  SignedQualificationAttestation,
  AdmissionFromAttestationResult,
} from "../attestations/qualification-attestation.js";
import type {
  DeploymentVerificationContext,
} from "../verifier/verifier.js";
import type {
  ProductAttestationRecord,
  ProductCandidateRecord,
  ProductContractRecord,
  ProductDeploymentRecord,
  ProductQualificationRunRecord,
} from "./state.js";
import type {
  ProductDeploymentView,
} from "./service.js";
import type {
  ProductDeploymentAudit,
  ProductRollbackTarget,
} from "./audit.js";
import type {
  CanonicalCasePortfolio,
} from "../scenarios/canonical-cases.js";
import type {
  QualificationState,
} from "../qualification/types.js";

export interface ProductRegistryCounts {
  organizations: number;
  environments: number;
  workloads: number;
  candidates: number;
  deployments: number;
}

export interface ProductOverview {
  schema: "admissary-product-overview/v1";
  registry: ProductRegistryCounts;
  applicationState: {
    candidates: number;
    contracts: number;
    qualificationRuns: number;
    deployments: number;
    attestations: number;
  };
  realCandidateTruth: {
    model: string;
    empiricalFitness: string;
    overallQualification: string;
    deployAllowed: boolean;
  };
  continuousAssurance: {
    available: boolean;
    caseBInitialAllowed: boolean | null;
    caseBDriftAllowed: boolean | null;
    historicalApprovalPreserved: boolean | null;
  };
  capabilities: {
    registry: true;
    workloadPacks: true;
    signedAttestations: true;
    ciAdmission: true;
    continuousAssurance: true;
    candidateSelection: true;
    guidanceMapping: true;
    lifecycleWriteApi: true;
  };
}

export interface CandidateSelectionRequest {
  schema: "admissary-product-selection-request/v1";
  candidateIds: string[];
  policy: CandidateSelectionPolicy;
}

export interface CandidateSelectionResponse {
  schema: "admissary-product-selection-response/v1";
  result: CandidateSelectionResult;
}

export interface GuidanceResponse {
  schema: "admissary-product-guidance-response/v1";
  mapping: GuidanceMappingPack;
}

export interface RegisterCandidateRequest {
  schema: "admissary-product-register-candidate/v1";
  candidateId: string;
  displayName: string;
  provider: string;
  repositoryOrModelId: string;
  revision: string | null;
  tokenizerRevision: string | null;
  artifactManifestDigest: string | null;
  occurredAt: string;
}

export interface RegisterCandidateResponse {
  schema: "admissary-product-register-candidate-response/v1";
  candidate: ProductCandidateRecord;
  created: boolean;
}

export interface RegisterContractRequest {
  schema: "admissary-product-register-contract/v1";
  contractId: string;
  version: string;
  digest: string;
  workloadId: string;
  environmentId: string;
  occurredAt: string;
}

export interface RegisterContractResponse {
  schema: "admissary-product-register-contract-response/v1";
  contract: ProductContractRecord;
  created: boolean;
}

export interface StartQualificationRequest {
  schema: "admissary-product-start-qualification/v1";
  candidateId: string;
  contractId: string;
  contractVersion: string;
  requestedAt: string;
  reason: string;
  replacesDeploymentId?: string | null;
}

export interface CompleteQualificationRequest {
  schema: "admissary-product-complete-qualification/v1";
  qualificationState: QualificationState;
  blockers: string[];
  exactArtifactBindingProven: boolean;
  evidenceGraphRootDigest: string;
  policyVersion: string | null;
  policyDigest: string | null;
  evaluationSuite: string | null;
  evaluationDigest: string | null;
  sourceRefs: string[];
  completedAt: string;
}

export interface QualificationResponse {
  schema: "admissary-product-qualification-response/v1";
  run: ProductQualificationRunRecord;
}

export interface BlockersResponse {
  schema: "admissary-product-blockers-response/v1";
  runId: string;
  blockers: string[];
}

export interface CreateDeploymentRequest {
  schema: "admissary-product-create-deployment/v1";
  deploymentId: string;
  runId: string;
  createdAt: string;
  maxEvidenceAgeMs: number;
}

export interface DeploymentResponse {
  schema: "admissary-product-deployment-response/v1";
  deployment: ProductDeploymentRecord;
}

export interface DeploymentViewResponse {
  schema: "admissary-product-deployment-view-response/v1";
  view: ProductDeploymentView;
}

export interface DeploymentListResponse {
  schema: "admissary-product-deployment-list-response/v1";
  deployments: ProductDeploymentView[];
}

export interface ApprovalRequest {
  schema: "admissary-product-approval-request/v1";
  issuedAt: string;
  expiresAt: string | null;
  reason: string;
}

export interface RevocationRequest {
  schema: "admissary-product-revocation-request/v1";
  occurredAt: string;
  reason: string;
}

export interface RequalificationRequest {
  schema: "admissary-product-requalification-request/v1";
  requestedAt: string;
  reason: string;
  candidateId?: string;
}

export interface CompleteReassessmentRequest {
  schema: "admissary-product-complete-reassessment/v1";
  requestId: string;
  replacementQualificationRunId: string;
  completedAt: string;
}
export interface MaterialChangeRequest {
  schema: "admissary-product-material-change/v1";
  checkedAt: string;
  comparison: import("../assurance/types.js").WatchComparison;
  nextIdentity: import("../assurance/types.js").DeploymentAssuranceIdentity;
  reason: string;
}

export interface RecordAttestationRequest {
  schema: "admissary-product-record-attestation/v1";
  attestation: SignedQualificationAttestation;
  recordedAt: string;
}

export interface AttestationResponse {
  schema: "admissary-product-attestation-response/v1";
  record: ProductAttestationRecord | null;
}

export interface HistoricalProofVerificationRequest {
  operationalScope: import("../attestations/qualification-attestation.js").OperationalScope;
  attestation: SignedQualificationAttestation;
  context: DeploymentVerificationContext;
}

export interface HistoricalProofVerificationResponse {
  schema: "admissary-historical-proof-verification/v1";
  valid: boolean;
  proofStatus: "VALID" | "INVALID";
  currentAuthority: "NOT_EVALUATED";
  attestation: AdmissionFromAttestationResult["attestation"];
  verification: AdmissionFromAttestationResult["deploymentVerification"];
}

export interface CurrentDeploymentAdmissionRequest {
  schema:
    "admissary-current-deployment-admission-request/v1";
  context:
    DeploymentVerificationContext;
}

export interface CurrentDeploymentAdmissionResponse {
  schema:
    "admissary-current-deployment-admission-decision/v1";
  decision:
    "ALLOW" | "DENY";
  allowed: boolean;
  deploymentId: string;
  cryptographic:
    AdmissionFromAttestationResult | null;
  currentAuthority: {
    allowed: boolean;
    reasons: string[];
    validity?: "CURRENT" | "STALE";
    lifecycleState?: string;
    approvalState?: string;
    attestationDigest?: string;
  };
}



export interface DeploymentAuditResponse {
  schema:
    "admissary-product-deployment-audit-response/v1";
  audit:
    ProductDeploymentAudit;
}

export interface RollbackTargetsResponse {
  schema:
    "admissary-product-rollback-targets-response/v1";
  deploymentId: string;
  targets:
    ProductRollbackTarget[];
}

export interface CanonicalCasesResponse {
  schema:
    "admissary-product-canonical-cases-response/v1";
  portfolio:
    CanonicalCasePortfolio;
}

export interface ProductTransport {
  request<T>(input: {
    method: "GET" | "POST";
    path: string;
    body?: unknown;
  }): Promise<T>;
}

export class AdmissaryProductClient {
  constructor(
    private readonly transport: ProductTransport,
  ) {}

  overview(): Promise<ProductOverview> {
    return this.transport.request<ProductOverview>({
      method: "GET",
      path: "/v1/product/overview",
    });
  }

  guidance(): Promise<GuidanceResponse> {
    return this.transport.request<GuidanceResponse>({
      method: "GET",
      path: "/v1/product/guidance",
    });
  }

  selectCandidates(
    request: CandidateSelectionRequest,
  ): Promise<CandidateSelectionResponse> {
    return this.transport.request<CandidateSelectionResponse>({
      method: "POST",
      path: "/v1/product/selection",
      body: request,
    });
  }

  candidates(): Promise<{ candidates: ProductCandidateRecord[] }> {
    return this.transport.request({
      method: "GET",
      path: "/v1/product/candidates",
    });
  }

  registerCandidate(
    request: RegisterCandidateRequest,
  ): Promise<RegisterCandidateResponse> {
    return this.transport.request({
      method: "POST",
      path: "/v1/product/candidates",
      body: request,
    });
  }

  contracts(): Promise<{ contracts: ProductContractRecord[] }> {
    return this.transport.request({
      method: "GET",
      path: "/v1/product/contracts",
    });
  }

  registerContract(
    request: RegisterContractRequest,
  ): Promise<RegisterContractResponse> {
    return this.transport.request({
      method: "POST",
      path: "/v1/product/contracts",
      body: request,
    });
  }

  startQualification(
    request: StartQualificationRequest,
  ): Promise<QualificationResponse> {
    return this.transport.request({
      method: "POST",
      path: "/v1/product/qualifications",
      body: request,
    });
  }

  qualification(
    runId: string,
  ): Promise<QualificationResponse> {
    return this.transport.request({
      method: "GET",
      path: `/v1/product/qualifications/${encodeURIComponent(runId)}`,
    });
  }

  blockers(
    runId: string,
  ): Promise<BlockersResponse> {
    return this.transport.request({
      method: "GET",
      path: `/v1/product/qualifications/${encodeURIComponent(runId)}/blockers`,
    });
  }

  completeQualification(
    runId: string,
    request: CompleteQualificationRequest,
  ): Promise<QualificationResponse> {
    return this.transport.request({
      method: "POST",
      path: `/v1/product/qualifications/${encodeURIComponent(runId)}/complete`,
      body: request,
    });
  }

  createDeployment(
    request: CreateDeploymentRequest,
  ): Promise<DeploymentResponse> {
    return this.transport.request({
      method: "POST",
      path: "/v1/product/deployments",
      body: request,
    });
  }

  deployments(
    validity: "ALL" | "CURRENT" | "STALE" = "ALL",
    now?: string,
  ): Promise<DeploymentListResponse> {
    const params = new URLSearchParams({ validity });
    if (now) params.set("now", now);
    return this.transport.request({
      method: "GET",
      path: `/v1/product/deployments?${params.toString()}`,
    });
  }

  deployment(
    deploymentId: string,
    now?: string,
  ): Promise<DeploymentViewResponse> {
    const query = now
      ? `?now=${encodeURIComponent(now)}`
      : "";
    return this.transport.request({
      method: "GET",
      path: `/v1/product/deployments/${encodeURIComponent(deploymentId)}${query}`,
    });
  }

  approve(
    deploymentId: string,
    request: ApprovalRequest,
  ) {
    return this.transport.request({
      method: "POST",
      path: `/v1/product/deployments/${encodeURIComponent(deploymentId)}/approve`,
      body: request,
    });
  }

  revoke(
    deploymentId: string,
    request: RevocationRequest,
  ) {
    return this.transport.request({
      method: "POST",
      path: `/v1/product/deployments/${encodeURIComponent(deploymentId)}/revoke`,
      body: request,
    });
  }

  requestRequalification(
    deploymentId: string,
    request: RequalificationRequest,
  ): Promise<QualificationResponse> {
    return this.transport.request({
      method: "POST",
      path: `/v1/product/deployments/${encodeURIComponent(deploymentId)}/requalification`,
      body: request,
    });
  }

  attestation(
    deploymentId: string,
  ): Promise<AttestationResponse> {
    return this.transport.request({
      method: "GET",
      path: `/v1/product/deployments/${encodeURIComponent(deploymentId)}/attestation`,
    });
  }

  recordAttestation(
    deploymentId: string,
    request: RecordAttestationRequest,
  ): Promise<AttestationResponse> {
    return this.transport.request({
      method: "POST",
      path: `/v1/product/deployments/${encodeURIComponent(deploymentId)}/attestation`,
      body: request,
    });
  }

  verifyHistoricalProof(request: HistoricalProofVerificationRequest): Promise<HistoricalProofVerificationResponse> {
    return this.transport.request({ method: "POST", path: "/v1/proofs/verify", body: request });
  }

  recordMaterialChange(deploymentId: string, request: MaterialChangeRequest) {
    return this.transport.request({ method: "POST", path: `/v1/product/deployments/${encodeURIComponent(deploymentId)}/material-change`, body: request });
  }

  completeReassessment(deploymentId: string, request: CompleteReassessmentRequest): Promise<DeploymentViewResponse> {
    return this.transport.request({ method: "POST", path: `/v1/product/deployments/${encodeURIComponent(deploymentId)}/complete-reassessment`, body: request });
  }

  currentAdmission(
    deploymentId: string,
    request:
      CurrentDeploymentAdmissionRequest,
  ):
    Promise<
      CurrentDeploymentAdmissionResponse
    > {
    return this.transport.request({
      method: "POST",
      path:
        `/v1/product/deployments/${encodeURIComponent(deploymentId)}/admission`,
      body: request,
    });
  }

  auditDeployment(
    deploymentId: string,
    now?: string,
  ): Promise<DeploymentAuditResponse> {
    const query = now
      ? `?now=${encodeURIComponent(now)}`
      : "";

    return this.transport.request({
      method: "GET",
      path:
        `/v1/product/deployments/${encodeURIComponent(deploymentId)}/audit${query}`,
    });
  }

  rollbackTargets(
    deploymentId: string,
    now?: string,
  ): Promise<RollbackTargetsResponse> {
    const query = now
      ? `?now=${encodeURIComponent(now)}`
      : "";

    return this.transport.request({
      method: "GET",
      path:
        `/v1/product/deployments/${encodeURIComponent(deploymentId)}/rollback-targets${query}`,
    });
  }

  canonicalCases():
    Promise<CanonicalCasesResponse> {
    return this.transport.request({
      method: "GET",
      path:
        "/v1/product/scenarios",
    });
  }
}
