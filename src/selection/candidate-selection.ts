import {
  digestCanonicalJson,
} from "../qualification/canonical.js";
import type {
  QualificationState,
} from "../qualification/types.js";

export type SelectionEvidenceProvenance =
  | "REAL"
  | "FIXTURE"
  | "DECLARED"
  | "UNKNOWN";

export interface SelectionMetric {
  value: number | null;
  provenance:
    SelectionEvidenceProvenance;
  sourceRef: string | null;
}

export interface CandidateOperationalProfile {
  provider: string;
  p95LatencyMs:
    SelectionMetric;
  costPerMillionTokensUsd:
    SelectionMetric;
  modelSizeB:
    SelectionMetric;
}

export interface SelectionCandidate {
  candidateId: string;
  displayName: string;
  qualificationState:
    QualificationState;
  exactArtifactBindingProven:
    boolean;
  blockers: string[];
  operational:
    CandidateOperationalProfile;
}

export type SelectionObjective =
  | "costPerMillionTokensUsd"
  | "p95LatencyMs"
  | "modelSizeB";

export interface CandidateSelectionPolicy {
  schema:
    "admissary-candidate-selection-policy/v1";
  requireExactArtifactBinding:
    boolean;
  allowedProviders:
    string[] | null;
  maxP95LatencyMs:
    number | null;
  maxCostPerMillionTokensUsd:
    number | null;
  maxModelSizeB:
    number | null;
  objectiveOrder:
    SelectionObjective[];
}

export interface CandidateExclusion {
  candidateId: string;
  reasons: string[];
}

export interface CandidateRank {
  candidateId: string;
  position: number;
  objectiveValues:
    Record<
      SelectionObjective,
      number
    >;
  provenance:
    Record<
      SelectionObjective,
      SelectionEvidenceProvenance
    >;
}

export interface CandidateSelectionResult {
  schema:
    "admissary-candidate-selection-result/v1";
  policyDigest: string;
  selectedCandidateId:
    string | null;
  ranked:
    CandidateRank[];
  excluded:
    CandidateExclusion[];
  claimScope:
    | "REAL"
    | "MIXED"
    | "FIXTURE_ONLY"
    | "NO_SELECTION";
  rationale: string[];
  resultDigest: string;
}

export class CandidateSelectionError
  extends Error {
  readonly code: string;

  constructor(
    code: string,
    message: string,
  ) {
    super(message);
    this.name =
      "CandidateSelectionError";
    this.code = code;
  }
}

function finiteOrNull(
  value: number | null,
  label: string,
): void {
  if (
    value !== null &&
    !Number.isFinite(value)
  ) {
    throw new CandidateSelectionError(
      "SELECTION_POLICY_ERROR",
      `${label} must be finite or null`,
    );
  }
}

function metricFor(
  candidate:
    SelectionCandidate,
  objective:
    SelectionObjective,
): SelectionMetric {
  return candidate
    .operational[objective];
}

function exclusionReasons(
  candidate:
    SelectionCandidate,
  policy:
    CandidateSelectionPolicy,
): string[] {
  const reasons:
    string[] = [];

  if (
    candidate
      .qualificationState !==
    "QUALIFIED"
  ) {
    reasons.push(
      `QUALIFICATION_${candidate.qualificationState}`,
    );
  }

  if (
    policy
      .requireExactArtifactBinding &&
    !candidate
      .exactArtifactBindingProven
  ) {
    reasons.push(
      "EXACT_ARTIFACT_BINDING_UNPROVEN",
    );
  }

  if (
    policy.allowedProviders &&
    !policy.allowedProviders.includes(
      candidate.operational
        .provider,
    )
  ) {
    reasons.push(
      "PROVIDER_NOT_ALLOWED",
    );
  }

  const latency =
    candidate.operational
      .p95LatencyMs.value;

  if (
    policy.maxP95LatencyMs !==
      null
  ) {
    if (
      latency === null
    ) {
      reasons.push(
        "P95_LATENCY_UNKNOWN",
      );
    } else if (
      latency >
      policy.maxP95LatencyMs
    ) {
      reasons.push(
        "P95_LATENCY_LIMIT_EXCEEDED",
      );
    }
  }

  const cost =
    candidate.operational
      .costPerMillionTokensUsd
      .value;

  if (
    policy
      .maxCostPerMillionTokensUsd !==
    null
  ) {
    if (
      cost === null
    ) {
      reasons.push(
        "COST_UNKNOWN",
      );
    } else if (
      cost >
      policy
        .maxCostPerMillionTokensUsd
    ) {
      reasons.push(
        "COST_LIMIT_EXCEEDED",
      );
    }
  }

  const size =
    candidate.operational
      .modelSizeB.value;

  if (
    policy.maxModelSizeB !==
      null
  ) {
    if (
      size === null
    ) {
      reasons.push(
        "MODEL_SIZE_UNKNOWN",
      );
    } else if (
      size >
      policy.maxModelSizeB
    ) {
      reasons.push(
        "MODEL_SIZE_LIMIT_EXCEEDED",
      );
    }
  }

  if (
    reasons.length === 0
  ) {
    for (
      const objective of
      policy.objectiveOrder
    ) {
      if (
        metricFor(
          candidate,
          objective,
        ).value === null
      ) {
        reasons.push(
          `OBJECTIVE_${objective.toUpperCase()}_UNKNOWN`,
        );
      }
    }
  }

  return reasons;
}

export function validateCandidateSelectionPolicy(
  policy:
    CandidateSelectionPolicy,
): void {
  if (
    policy.schema !==
    "admissary-candidate-selection-policy/v1"
  ) {
    throw new CandidateSelectionError(
      "SELECTION_POLICY_ERROR",
      "Unsupported selection policy schema",
    );
  }

  finiteOrNull(
    policy.maxP95LatencyMs,
    "maxP95LatencyMs",
  );
  finiteOrNull(
    policy
      .maxCostPerMillionTokensUsd,
    "maxCostPerMillionTokensUsd",
  );
  finiteOrNull(
    policy.maxModelSizeB,
    "maxModelSizeB",
  );

  if (
    policy.objectiveOrder
      .length === 0
  ) {
    throw new CandidateSelectionError(
      "SELECTION_POLICY_ERROR",
      "At least one objective is required",
    );
  }

  if (
    new Set(
      policy.objectiveOrder,
    ).size !==
    policy.objectiveOrder.length
  ) {
    throw new CandidateSelectionError(
      "SELECTION_POLICY_ERROR",
      "Objective order must not contain duplicates",
    );
  }

  if (
    policy.allowedProviders &&
    (
      policy.allowedProviders
        .length === 0 ||
      new Set(
        policy.allowedProviders,
      ).size !==
        policy.allowedProviders
          .length
    )
  ) {
    throw new CandidateSelectionError(
      "SELECTION_POLICY_ERROR",
      "allowedProviders must be null or a non-empty unique list",
    );
  }
}

export function selectCandidates(
  input: {
    candidates:
      readonly SelectionCandidate[];
    policy:
      CandidateSelectionPolicy;
  },
): CandidateSelectionResult {
  validateCandidateSelectionPolicy(
    input.policy,
  );

  const ids =
    input.candidates.map(
      (candidate) =>
        candidate.candidateId,
    );

  if (
    new Set(ids).size !==
    ids.length
  ) {
    throw new CandidateSelectionError(
      "SELECTION_CANDIDATE_ERROR",
      "Candidate IDs must be unique",
    );
  }

  const excluded:
    CandidateExclusion[] = [];

  const eligible:
    SelectionCandidate[] = [];

  for (
    const candidate of
    input.candidates
  ) {
    if (candidate.qualificationState === "QUALIFIED" && candidate.blockers.length) throw new CandidateSelectionError("SELECTION_CONTRADICTION", "Qualified candidate carries blockers");
    for (const metric of Object.values(candidate.operational).filter(v => typeof v === "object" && v !== null)) {
      if (!['REAL','FIXTURE','DECLARED','UNKNOWN'].includes(metric.provenance) ||
          metric.provenance === 'UNKNOWN' && metric.value !== null ||
          metric.value !== null && (!Number.isFinite(metric.value) || !metric.sourceRef)) throw new CandidateSelectionError("SELECTION_METRIC_INVALID", "Invalid metric provenance");
    }
    const reasons =
      exclusionReasons(
        candidate,
        input.policy,
      );

    if (
      reasons.length > 0
    ) {
      excluded.push({
        candidateId:
          candidate.candidateId,
        reasons:
          [...reasons].sort(),
      });
    } else {
      eligible.push(
        candidate,
      );
    }
  }

  const rankedCandidates =
    [...eligible].sort(
      (left, right) => {
        for (
          const objective of
          input.policy
            .objectiveOrder
        ) {
          const a =
            metricFor(
              left,
              objective,
            ).value!;

          const b =
            metricFor(
              right,
              objective,
            ).value!;

          if (a < b) {
            return -1;
          }

          if (a > b) {
            return 1;
          }
        }

        return left
          .candidateId
          .localeCompare(
            right.candidateId,
          );
      },
    );

  const ranked:
    CandidateRank[] =
      rankedCandidates.map(
        (
          candidate,
          index,
        ) => {
          const objectiveValues =
            {} as
              Record<
                SelectionObjective,
                number
              >;

          const provenance =
            {} as
              Record<
                SelectionObjective,
                SelectionEvidenceProvenance
              >;

          for (
            const objective of
            input.policy
              .objectiveOrder
          ) {
            const metric =
              metricFor(
                candidate,
                objective,
              );

            objectiveValues[
              objective
            ] =
              metric.value!;

            provenance[
              objective
            ] =
              metric.provenance;
          }

          return {
            candidateId:
              candidate.candidateId,
            position:
              index + 1,
            objectiveValues,
            provenance,
          };
        },
      );

  const selectedCandidateId =
    ranked[0]
      ?.candidateId ??
    null;

  const selected =
    selectedCandidateId
      ? eligible.find(
          (candidate) =>
            candidate
              .candidateId ===
            selectedCandidateId,
        )!
      : null;

  let claimScope:
    CandidateSelectionResult[
      "claimScope"
    ] =
      "NO_SELECTION";

  if (selected) {
    const provenance =
      input.policy
        .objectiveOrder
        .map(
          (objective) =>
            metricFor(
              selected,
              objective,
            ).provenance,
        );

    if (
      provenance.every(
        (item) =>
          item === "REAL",
      )
    ) {
      claimScope =
        "REAL";
    } else if (
      provenance.every(
        (item) =>
          item === "FIXTURE",
      )
    ) {
      claimScope =
        "FIXTURE_ONLY";
    } else {
      claimScope =
        "MIXED";
    }
  }

  const rationale = [
    "Mandatory qualification is a hard prerequisite; optimization never compensates for failed qualification.",
    "Exact artifact binding is enforced before operational optimization when required by policy.",
    "Candidates are ranked lexicographically using the declared objective order; no weighted score is used.",
  ];

  if (
    claimScope ===
    "FIXTURE_ONLY"
  ) {
    rationale.push(
      "The selected economics are explicit acceptance fixtures and must not be presented as real provider economics.",
    );
  }

  const payload = {
    schema:
      "admissary-candidate-selection-result/v1" as const,
    policyDigest:
      digestCanonicalJson(
        input.policy,
      ),
    selectedCandidateId,
    ranked,
    excluded:
      excluded.sort(
        (a, b) =>
          a.candidateId
            .localeCompare(
              b.candidateId,
            ),
      ),
    claimScope,
    rationale,
  };

  return {
    ...payload,
    resultDigest:
      digestCanonicalJson(
        payload,
      ),
  };
}
