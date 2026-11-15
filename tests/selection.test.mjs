import test from "node:test";
import assert from "node:assert/strict";

import {
  selectCandidates,
} from "../dist/index.js";

function metric(
  value,
  provenance = "REAL",
) {
  return {
    value,
    provenance,
    sourceRef:
      value === null
        ? null
        : "test",
  };
}

const policy = {
  schema:
    "admissary-candidate-selection-policy/v1",
  requireExactArtifactBinding:
    true,
  allowedProviders:
    null,
  maxP95LatencyMs:
    2000,
  maxCostPerMillionTokensUsd:
    5,
  maxModelSizeB:
    100,
  objectiveOrder: [
    "costPerMillionTokensUsd",
    "p95LatencyMs",
    "modelSizeB",
  ],
};

test("qualification is a hard prerequisite before economics", () => {
  const result =
    selectCandidates({
      policy,
      candidates: [
        {
          candidateId:
            "cheap-unfit",
          displayName:
            "Cheap but unfit",
          qualificationState:
            "UNFIT",
          exactArtifactBindingProven:
            true,
          blockers: [
            "CRITICAL_RECALL",
          ],
          operational: {
            provider: "x",
            p95LatencyMs:
              metric(10),
            costPerMillionTokensUsd:
              metric(0.01),
            modelSizeB:
              metric(1),
          },
        },
        {
          candidateId:
            "qualified",
          displayName:
            "Qualified",
          qualificationState:
            "QUALIFIED",
          exactArtifactBindingProven:
            true,
          blockers: [],
          operational: {
            provider: "x",
            p95LatencyMs:
              metric(1000),
            costPerMillionTokensUsd:
              metric(2),
            modelSizeB:
              metric(7),
          },
        },
      ],
    });

  assert.equal(
    result.selectedCandidateId,
    "qualified",
  );

  assert.ok(
    result.excluded
      .find(
        (item) =>
          item.candidateId ===
          "cheap-unfit",
      )
      ?.reasons.includes(
        "QUALIFICATION_UNFIT",
      ),
  );
});

test("selection is deterministic lexicographic rather than weighted", () => {
  const result =
    selectCandidates({
      policy,
      candidates: [
        {
          candidateId: "a",
          displayName: "A",
          qualificationState:
            "QUALIFIED",
          exactArtifactBindingProven:
            true,
          blockers: [],
          operational: {
            provider: "x",
            p95LatencyMs:
              metric(1500),
            costPerMillionTokensUsd:
              metric(1),
            modelSizeB:
              metric(20),
          },
        },
        {
          candidateId: "b",
          displayName: "B",
          qualificationState:
            "QUALIFIED",
          exactArtifactBindingProven:
            true,
          blockers: [],
          operational: {
            provider: "x",
            p95LatencyMs:
              metric(100),
            costPerMillionTokensUsd:
              metric(2),
            modelSizeB:
              metric(2),
          },
        },
      ],
    });

  assert.equal(
    result.selectedCandidateId,
    "a",
  );
  assert.deepEqual(
    result.ranked.map(
      (item) =>
        item.candidateId,
    ),
    ["a", "b"],
  );
});

test("fixture economics stay visibly fixture-scoped", () => {
  const result =
    selectCandidates({
      policy,
      candidates: [
        {
          candidateId:
            "fixture",
          displayName:
            "Fixture",
          qualificationState:
            "QUALIFIED",
          exactArtifactBindingProven:
            true,
          blockers: [],
          operational: {
            provider: "fixture",
            p95LatencyMs:
              metric(
                500,
                "FIXTURE",
              ),
            costPerMillionTokensUsd:
              metric(
                1,
                "FIXTURE",
              ),
            modelSizeB:
              metric(
                8,
                "FIXTURE",
              ),
          },
        },
      ],
    });

  assert.equal(
    result.claimScope,
    "FIXTURE_ONLY",
  );
});

test("unknown required optimization data fails candidate closed", () => {
  const result =
    selectCandidates({
      policy,
      candidates: [
        {
          candidateId:
            "unknown-cost",
          displayName:
            "Unknown cost",
          qualificationState:
            "QUALIFIED",
          exactArtifactBindingProven:
            true,
          blockers: [],
          operational: {
            provider: "x",
            p95LatencyMs:
              metric(500),
            costPerMillionTokensUsd:
              metric(
                null,
                "UNKNOWN",
              ),
            modelSizeB:
              metric(8),
          },
        },
      ],
    });

  assert.equal(
    result.selectedCandidateId,
    null,
  );

  assert.ok(
    result.excluded[0]
      .reasons.includes(
        "COST_UNKNOWN",
      ),
  );
});
