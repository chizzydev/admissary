export interface JudgeMetric {
  id: string;
  label: string;
  observed: number;
  operator: string;
  threshold: number;
  criticality: "MANDATORY" | "ADVISORY";
  state: "PASS" | "FAIL";
}

export interface JudgeArtifactRef {
  phase: string;
  label: string;
  file: string;
  digest?: string;
  role: string;
}

export interface JudgeCandidate {
  id: string;
  label: string;
  provenance: "REAL_EVIDENCE" | "ACCEPTANCE_FIXTURE";
  stage: string;
  qualificationState: string;
  empiricalFitness?: string;
  deploymentState: "ALLOW" | "DENY" | "NOT_EVALUATED";
  explanation: string;
  execution?: {
    provenance: "REAL_DOLPHIN_EXECUTION" | "REAL_PROVIDER_STATUS_NO_EXECUTION";
    completionStatus: string;
    casesCompleted: number;
    caseCount: number;
    bindingScope: "PROVIDER_MODEL_IDENTITY";
    exactArtifactBindingProven: false;
    runDigest: string | null;
    metrics: JudgeMetric[];
  };
}

export interface JudgeViewInput {
  generatedAt: string;
  contract: {
    id: string;
    version: string;
    digest: string;
    workload: string;
    environment: string;
  };
  candidate: {
    model: string;
    provider: string;
    providerHost: string;
    bindingScope: string;
    exactArtifactBindingProven: boolean;
    empiricalFitness: string;
    overallQualification: string;
    deployAllowed: boolean;
  };
  metrics: JudgeMetric[];
  empiricalBlockers: string[];
  deploymentBlockers: string[];
  missingObligations: string[];
  requalification: {
    unchanged: {
      reused: number;
      recomputed: number;
    };
    policyChange: {
      reused: string[];
      recomputed: string[];
    };
    artifactChange: {
      reused: string[];
      recomputed: string[];
    };
  };
  authorization: {
    approvalDeniedForRealRun: boolean;
    realDeployAllowed: boolean;
    viewerApprovalDenied: boolean;
    fixtureApprovedDeployAllowed: boolean;
    fixtureStaleDeployAllowed: boolean;
    fixtureStaleAuthorization: string;
    fixtureStaleValidity: string;
    fixtureRevokedAuthorization: string;
  };
  verifier: {
    valid: "ALLOW" | "DENY";
    tampered: "ALLOW" | "DENY";
    tamperedReason: string;
    rehashedRevisionChange: "ALLOW" | "DENY";
    rehashedRevisionChangeReason: string;
    stale: "ALLOW" | "DENY";
    staleReason: string;
    unapproved: "ALLOW" | "DENY";
    unapprovedReason: string;
    contractMismatch: "ALLOW" | "DENY";
    contractMismatchReason: string;
    networkCalls: 0;
  };
  integrations: {
    serv: {
      liveArtifactPresent: boolean;
      artifactFile: string;
      role: string;
    };
    dolphin: {
      liveArtifactPresent: boolean;
      artifactFile: string;
      runDigest: string;
      cases: number;
      role: string;
    };
  };
  artifacts: JudgeArtifactRef[];
  candidates: JudgeCandidate[];
}

export interface JudgeViewModel extends JudgeViewInput {
  schema: "admissary-judge-view/v1";
  authoritySemantics: { historicalProof: string; currentAdmission: string };
  thesis: string;
  punchline: string;
  headlineState: "BLOCKED" | "DEPLOYABLE";
  headlineReason: string;
  judgeSummary: string;
}

export function buildJudgeView(
  input: JudgeViewInput,
): JudgeViewModel {
  const headlineState = input.candidate.deployAllowed
    ? "DEPLOYABLE"
    : "BLOCKED";

  const mandatoryFailures = input.metrics.filter(
    (metric) =>
      metric.criticality === "MANDATORY" &&
      metric.state === "FAIL",
  );

  const headlineReason = input.candidate.deployAllowed
    ? "Exact deployment context matches a QUALIFIED, APPROVED, CURRENT proof."
    : input.deploymentBlockers.length > 0
      ? input.deploymentBlockers.join(" · ")
      : "Current proof does not authorize deployment.";

  const judgeSummary = mandatoryFailures.length > 0
    ? `The model looks strong on aggregate, but ${mandatoryFailures.length} mandatory production gate${mandatoryFailures.length === 1 ? "" : "s"} failed. Admissary blocks deployment instead of averaging the failures away.`
    : "All mandatory workload gates passed; deployment still requires exact identity, authorization, and current proof.";

  return {
    ...input,
    schema: "admissary-judge-view/v1",
    authoritySemantics: { historicalProof: "Offline fixture consistency only; may remain valid after revocation.", currentAdmission: "State-aware Product admission and CI require current approval, signed proof and fresh Assurance; historical proof alone grants no authority." },
    thesis:
      "A model name is not a deployment decision. Admissary proves whether the exact model you are about to ship is fit for this workload.",
    punchline:
      "Change the model, policy, evidence, or workload — and the proof expires.",
    headlineState,
    headlineReason,
    judgeSummary,
  };
}
