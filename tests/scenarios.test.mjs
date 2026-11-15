import test from "node:test";
import assert from "node:assert/strict";

import {
  CANONICAL_CASE_PRIMITIVES,
  buildCanonicalCasePortfolio,
} from "../dist/index.js";

function audit() {
  return {
    schema:
      "admissary-product-deployment-audit/v1",
    deployment: {
      deploymentId:
        "incident",
    },
    candidate: {},
    contract: {},
    qualification: {},
    decision: {
      allowed: false,
    },
    approval: {
      approvalId:
        "approval",
    },
    attestation: {
      attestationDigest:
        "attestation",
    },
    exactIdentity: {},
    timeline: [
      {
        type:
          "APPROVAL_REVOKED",
      },
    ],
    rollbackTargets: [
      {
        deploymentId:
          "rollback",
      },
    ],
    auditDigest:
      "a".repeat(64),
  };
}

test("canonical portfolio carries four cases with one shared primitive set", () => {
  const portfolio =
    buildCanonicalCasePortfolio({
      generatedAt:
        "2026-11-14T20:30:00.000Z",
      caseA: {
        model:
          "deepseek-ai/DeepSeek-V4.1-Flash",
        macroF1:
          0.891408,
        criticalIntentRecall:
          0.825,
        schemaValidity:
          0.993056,
        injectionInvariance:
          0.958333,
        empiricalFitness:
          "UNFIT",
        overallQualification:
          "REVIEW_REQUIRED",
        deployAllowed:
          false,
        evidenceRefs:
          ["R5", "R6", "R7"],
      },
      caseB: {
        initialAllowed:
          true,
        driftAllowed:
          false,
        historicalApprovalPreserved:
          true,
        invalidatedNodes: [
          "source:artifact",
        ],
        reassessmentRequested:
          true,
        requalificationInheritedApproval:
          false,
        realWatcherRepository:
          "Qwen/Qwen3-0.6B",
        realWatcherOutcome:
          "UNCHANGED",
        evidenceRefs:
          ["R10C3"],
      },
      caseC: {
        selectedCandidateId:
          "fixture-qualified-efficient",
        selectedClaimScope:
          "FIXTURE_ONLY",
        excludedCandidateIds: [
          "real-deepseek",
        ],
        realQualifiedCandidateExists:
          false,
        evidenceRefs:
          ["R10C4"],
      },
      caseD: {
        audit:
          audit(),
        incidentDecisionAllowed:
          false,
        historicalAttestationCryptographicallyValid:
          true,
        currentAuthorityAllowed:
          false,
        rollbackTargetId:
          "rollback",
        evidenceRefs:
          ["R10D:audit"],
      },
    });

  assert.equal(
    portfolio.cases.length,
    4,
  );

  for (
    const item of
    portfolio.cases
  ) {
    assert.deepEqual(
      item.primitives,
      CANONICAL_CASE_PRIMITIVES,
    );
  }

  assert.equal(
    portfolio.selectedQualifiedCandidateClaimScope,
    "FIXTURE_ONLY",
  );

  assert.equal(
    portfolio.cases.find(
      (item) =>
        item.id === "CASE_A",
    )?.claimScope,
    "REAL",
  );
});

test("portfolio refuses a fake real winner when no real candidate qualified", () => {
  assert.throws(
    () =>
      buildCanonicalCasePortfolio({
        generatedAt:
          "2026-11-14T20:30:00.000Z",
        caseA: {
          model: "deepseek",
          macroF1: 0.89,
          criticalIntentRecall: 0.82,
          schemaValidity: 0.99,
          injectionInvariance: 0.95,
          empiricalFitness: "UNFIT",
          overallQualification: "REVIEW_REQUIRED",
          deployAllowed: false,
          evidenceRefs: ["R5"],
        },
        caseB: {
          initialAllowed: true,
          driftAllowed: false,
          historicalApprovalPreserved: true,
          invalidatedNodes: ["source:artifact"],
          reassessmentRequested: true,
          requalificationInheritedApproval: false,
          realWatcherRepository: "qwen",
          realWatcherOutcome: "UNCHANGED",
          evidenceRefs: ["R10C3"],
        },
        caseC: {
          selectedCandidateId: "fake-real",
          selectedClaimScope: "REAL",
          excludedCandidateIds: [],
          realQualifiedCandidateExists: false,
          evidenceRefs: ["R10C4"],
        },
        caseD: {
          audit: audit(),
          incidentDecisionAllowed: false,
          historicalAttestationCryptographicallyValid: true,
          currentAuthorityAllowed: false,
          rollbackTargetId: "rollback",
          evidenceRefs: ["R10D"],
        },
      }),
    /fixture winner as real/,
  );
});

test("portfolio requires Case D to contain a safe rollback target", () => {
  const noRollback = audit();
  noRollback.rollbackTargets = [];

  assert.throws(
    () =>
      buildCanonicalCasePortfolio({
        generatedAt:
          "2026-11-14T20:30:00.000Z",
        caseA: {
          model: "deepseek",
          macroF1: 0.89,
          criticalIntentRecall: 0.82,
          schemaValidity: 0.99,
          injectionInvariance: 0.95,
          empiricalFitness: "UNFIT",
          overallQualification: "REVIEW_REQUIRED",
          deployAllowed: false,
          evidenceRefs: ["R5"],
        },
        caseB: {
          initialAllowed: true,
          driftAllowed: false,
          historicalApprovalPreserved: true,
          invalidatedNodes: ["source:artifact"],
          reassessmentRequested: true,
          requalificationInheritedApproval: false,
          realWatcherRepository: "qwen",
          realWatcherOutcome: "UNCHANGED",
          evidenceRefs: ["R10C3"],
        },
        caseC: {
          selectedCandidateId: "fixture",
          selectedClaimScope: "FIXTURE_ONLY",
          excludedCandidateIds: [],
          realQualifiedCandidateExists: false,
          evidenceRefs: ["R10C4"],
        },
        caseD: {
          audit: noRollback,
          incidentDecisionAllowed: false,
          historicalAttestationCryptographicallyValid: true,
          currentAuthorityAllowed: false,
          rollbackTargetId: null,
          evidenceRefs: ["R10D"],
        },
      }),
    /safe rollback target/,
  );
});
