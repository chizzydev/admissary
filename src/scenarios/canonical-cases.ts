import {
  digestCanonicalJson,
} from "../qualification/canonical.js";
import type {
  ProductDeploymentAudit,
} from "../product/audit.js";

export const CANONICAL_CASE_PRIMITIVES = [
  "registry",
  "deployment-contract",
  "evidence-graph",
  "SERV-semantic-evidence",
  "empirical-evaluation",
  "deterministic-qualification",
  "approval",
  "signed-attestation",
  "admission-verifier",
  "watcher-staleness",
  "history",
] as const;

export type CanonicalCasePrimitive =
  typeof CANONICAL_CASE_PRIMITIVES[number];

export type CanonicalCaseId =
  | "CASE_A"
  | "CASE_B"
  | "CASE_C"
  | "CASE_D";

export type CanonicalCaseClaimScope =
  | "REAL"
  | "ACCEPTANCE_FIXTURE_WITH_REAL_WATCHER"
  | "MIXED_REAL_FAILURES_FIXTURE_QUALIFIED"
  | "ACCEPTANCE_FIXTURE";

export interface CanonicalOperationalCase {
  id: CanonicalCaseId;
  title: string;
  claimScope:
    CanonicalCaseClaimScope;
  headline: string;
  judgeTakeaway: string;
  outcome: string;
  primitives:
    CanonicalCasePrimitive[];
  evidenceRefs: string[];
  steps: string[];
  facts:
    Record<
      string,
      string | number | boolean | string[] | null
    >;
}

export interface CanonicalCasePortfolio {
  schema:
    "admissary-canonical-case-portfolio/v1";
  generatedAt: string;
  sharedPrimitives:
    CanonicalCasePrimitive[];
  primitiveClaim: "COMPOSITION_VOCABULARY_ONLY";
  cases:
    CanonicalOperationalCase[];
  demoCausalChain: string[];
  realQualifiedCandidateExists:
    boolean;
  selectedQualifiedCandidateClaimScope:
    "FIXTURE_ONLY" | "REAL";
  portfolioDigest: string;
}

export interface CanonicalCasePortfolioInput {
  generatedAt: string;
  caseA: {
    model: string;
    macroF1: number;
    criticalIntentRecall: number;
    schemaValidity: number;
    injectionInvariance: number;
    empiricalFitness: string;
    overallQualification: string;
    deployAllowed: boolean;
    evidenceRefs: string[];
  };
  caseB: {
    initialAllowed: boolean;
    driftAllowed: boolean;
    historicalApprovalPreserved: boolean;
    invalidatedNodes: string[];
    reassessmentRequested: boolean;
    requalificationInheritedApproval: boolean;
    realWatcherRepository: string;
    realWatcherOutcome: string;
    evidenceRefs: string[];
  };
  caseC: {
    realCandidateStates?: string[];
    realSelectionStatus?: string;
    selectedCandidateId: string | null;
    selectedClaimScope:
      "FIXTURE_ONLY" | "REAL" | "MIXED" | "NO_SELECTION";
    excludedCandidateIds: string[];
    realQualifiedCandidateExists: boolean;
    evidenceRefs: string[];
  };
  caseD: {
    audit: ProductDeploymentAudit;
    incidentDecisionAllowed: boolean;
    historicalAttestationCryptographicallyValid: boolean;
    currentAuthorityAllowed: boolean;
    rollbackTargetId: string | null;
    evidenceRefs: string[];
  };
}

function sharedPrimitives():
  CanonicalCasePrimitive[] {
  return [
    ...CANONICAL_CASE_PRIMITIVES,
  ];
}

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(
      `CANONICAL_CASE_INVALID: ${message}`,
    );
  }
}

export function buildCanonicalCasePortfolio(
  input:
    CanonicalCasePortfolioInput,
): CanonicalCasePortfolio {
  assert(
    input.caseA.empiricalFitness ===
      "UNFIT",
    "Case A must preserve real DeepSeek empirical UNFIT",
  );

  assert(
    input.caseA.deployAllowed ===
      false,
    "Case A must remain deployment denied",
  );

  assert(
    input.caseB.initialAllowed ===
      true &&
      input.caseB.driftAllowed ===
        false,
    "Case B must prove ALLOW to DENY after material drift",
  );

  assert(
    input.caseB
      .historicalApprovalPreserved ===
      true,
    "Case B must preserve historical approval",
  );

  assert(
    input.caseB
      .reassessmentRequested ===
      true,
    "Case B must request reassessment",
  );

  assert(
    input.caseB
      .requalificationInheritedApproval ===
      false,
    "Case B must not inherit historical approval",
  );

  if (
    !input.caseC
      .realQualifiedCandidateExists
  ) {
    assert(
      input.caseC
        .selectedClaimScope ===
        "FIXTURE_ONLY",
      "Case C cannot present a fixture winner as real",
    );
  }

  assert(
    input.caseD
      .incidentDecisionAllowed ===
      false,
    "Case D incident deployment must be denied",
  );

  assert(
    input.caseD
      .historicalAttestationCryptographicallyValid ===
      true,
    "Case D must preserve historical attestation verification",
  );

  assert(
    input.caseD
      .currentAuthorityAllowed ===
      false,
    "Case D current authority must deny after incident",
  );

  assert(
    input.caseD
      .audit.rollbackTargets
      .length > 0,
    "Case D requires at least one safe rollback target",
  );

  assert(
    input.caseD
      .rollbackTargetId !== null,
    "Case D rollback target ID is required",
  );

  const cases:
    CanonicalOperationalCase[] = [
      {
        id:
          "CASE_A",
        title:
          "Strong model, unsafe deployment",
        claimScope:
          "REAL",
        headline:
          "Strong aggregate quality still fails the workload that matters.",
        judgeTakeaway:
          "Aggregate quality is not deployment fitness.",
        outcome:
          "DEPLOY_DENIED",
        primitives:
          sharedPrimitives(),
        evidenceRefs:
          [...input.caseA.evidenceRefs],
        steps: [
          "Team proposes a respected open model.",
          "Dolphin runs the frozen 144-case banking workload.",
          "Macro F1 and injection invariance look strong.",
          "Mandatory critical-intent recall fails.",
          "Mandatory schema validity fails.",
          "Deterministic qualification refuses deployment.",
        ],
        facts: {
          model:
            input.caseA.model,
          macroF1:
            input.caseA.macroF1,
          criticalIntentRecall:
            input.caseA.criticalIntentRecall,
          schemaValidity:
            input.caseA.schemaValidity,
          injectionInvariance:
            input.caseA.injectionInvariance,
          empiricalFitness:
            input.caseA.empiricalFitness,
          overallQualification:
            input.caseA.overallQualification,
          deployAllowed:
            input.caseA.deployAllowed,
        },
      },
      {
        id:
          "CASE_B",
        title:
          "Approved yesterday, stale today",
        claimScope:
          "ACCEPTANCE_FIXTURE_WITH_REAL_WATCHER",
        headline:
          "Approval belongs to exact proof, not a model name.",
        judgeTakeaway:
          "Approval belongs to an exact deployment proof, not to a model name forever.",
        outcome:
          "ALLOW_TO_DENY_ON_DRIFT",
        primitives:
          sharedPrimitives(),
        evidenceRefs:
          [...input.caseB.evidenceRefs],
        steps: [
          "Exact candidate qualifies and receives scoped human approval.",
          "A signed qualification attestation is accepted.",
          "Deployment admission returns ALLOW.",
          "A protected identity input changes.",
          "Watcher marks only affected proof branches stale.",
          "Historical approval remains in history but no longer authorizes the changed deployment.",
          "Admission returns DENY and reassessment is requested.",
        ],
        facts: {
          initialAllowed:
            input.caseB.initialAllowed,
          driftAllowed:
            input.caseB.driftAllowed,
          historicalApprovalPreserved:
            input.caseB.historicalApprovalPreserved,
          invalidatedNodes:
            [...input.caseB.invalidatedNodes],
          reassessmentRequested:
            input.caseB.reassessmentRequested,
          requalificationInheritedApproval:
            input.caseB.requalificationInheritedApproval,
          realWatcherRepository:
            input.caseB.realWatcherRepository,
          realWatcherOutcome:
            input.caseB.realWatcherOutcome,
        },
      },
      {
        id:
          "CASE_C",
        title:
          "Choose the best admissible replacement",
        claimScope:
          input.caseC
            .realQualifiedCandidateExists
            ? "MIXED_REAL_FAILURES_FIXTURE_QUALIFIED"
            : "MIXED_REAL_FAILURES_FIXTURE_QUALIFIED",
        headline:
          "Qualification gates the leaderboard.",
        judgeTakeaway:
          "Admissary turns model selection into an admissible decision, not a leaderboard.",
        outcome:
          input.caseC.selectedCandidateId
            ? "QUALIFICATION_FIRST_SELECTION"
            : "NO_ADMISSIBLE_SELECTION",
        primitives:
          sharedPrimitives(),
        evidenceRefs:
          [...input.caseC.evidenceRefs],
        steps: [
          "The same deployment contract is applied to every candidate.",
          "Deterministic failures are excluded before optimization.",
          "Empirically unfit or incomplete candidates are excluded before optimization.",
          "Only qualified, exact-bound candidates may enter cost/latency/resource comparison.",
          "The selected candidate retains explicit evidence provenance.",
        ],
        facts: {
          selectedCandidateId:
            input.caseC.selectedCandidateId,
          realCandidateStates: input.caseC.realCandidateStates ?? [],
          realSelectionStatus: input.caseC.realSelectionStatus ?? (input.caseC.realQualifiedCandidateExists ? "REAL_ADMISSIBLE_SELECTION" : "NO_REAL_ADMISSIBLE_SELECTION"),
          selectedClaimScope:
            input.caseC.selectedClaimScope,
          excludedCandidateIds:
            [...input.caseC.excludedCandidateIds],
          realQualifiedCandidateExists:
            input.caseC.realQualifiedCandidateExists,
          fakeWinner:
            false,
        },
      },
      {
        id:
          "CASE_D",
        title:
          "Audit, incident and safe rollback",
        claimScope:
          "ACCEPTANCE_FIXTURE",
        headline:
          "Operational memory survives the incident.",
        judgeTakeaway:
          "Admissary is operational memory and control, not only pre-deployment testing.",
        outcome:
          "INCIDENT_DENY_WITH_SAFE_ROLLBACK",
        primitives:
          sharedPrimitives(),
        evidenceRefs:
          [...input.caseD.evidenceRefs],
        steps: [
          "Security asks which exact model was running and who approved it.",
          "Audit returns exact candidate, contract, policy, evaluation and evidence-root identity.",
          "Signed attestation and approval remain visible in history.",
          "Incident revocation makes the current deployment non-admissible.",
          "Rollback query searches only qualified, exact-bound, approved, current and attested deployments in the same workload/environment.",
          "The last safe deployment is returned as rollback target.",
        ],
        facts: {
          incidentDeploymentId:
            input.caseD.audit
              .deployment
              .deploymentId,
          incidentAllowed:
            input.caseD.incidentDecisionAllowed,
          historicalAttestationCryptographicallyValid:
            input.caseD.historicalAttestationCryptographicallyValid,
          currentAuthorityAllowed:
            input.caseD.currentAuthorityAllowed,
          approvalId:
            input.caseD.audit
              .approval
              ?.approvalId ??
            null,
          attestationDigest:
            input.caseD.audit
              .attestation
              ?.attestationDigest ??
            null,
          timelineEvents:
            input.caseD.audit
              .timeline.length,
          rollbackTargetId:
            input.caseD.rollbackTargetId,
          rollbackTargetCount:
            input.caseD.audit
              .rollbackTargets.length,
          auditDigest:
            input.caseD.audit
              .auditDigest,
        },
      },
    ];

  for (const item of cases) {
    // Primitives list describes composition vocabulary, not executed coverage.
    // Actual subsystem assertions live in their referenced evidence gates.

    assert(
      item.evidenceRefs.length >
        0,
      `${item.id} must carry evidence references`,
    );
  }

  const demoCausalChain = [
    "Show one frozen production contract and the candidate states.",
    "Show real DeepSeek: strong macro F1, still UNFIT and denied.",
    "Show an explicitly labeled qualified exact-bound acceptance deployment and its signed approval.",
    "Verify deterministic admission ALLOW.",
    "Trigger one protected identity change.",
    "Show watcher invalidation and stale proof.",
    "Verify admission flips to DENY.",
    "Show historical approval/attestation still present in audit history.",
    "Show the minimal requalification or safe rollback path.",
  ];

  const payload = {
    schema:
      "admissary-canonical-case-portfolio/v1" as const,
    primitiveClaim: "COMPOSITION_VOCABULARY_ONLY" as const,
    generatedAt:
      input.generatedAt,
    sharedPrimitives:
      sharedPrimitives(),
    cases,
    demoCausalChain,
    realQualifiedCandidateExists:
      input.caseC
        .realQualifiedCandidateExists,
    selectedQualifiedCandidateClaimScope:
      input.caseC
        .realQualifiedCandidateExists
        ? "REAL" as const
        : "FIXTURE_ONLY" as const,
  };

  return {
    ...payload,
    portfolioDigest:
      digestCanonicalJson(
        payload,
      ),
  };
}
