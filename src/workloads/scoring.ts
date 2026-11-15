import type {
  WorkloadExpectedValue,
  WorkloadMetricDefinition,
  WorkloadMetricThreshold,
  WorkloadPack,
} from "./pack.js";
import {
  WorkloadPackError, verifyWorkloadPack, validateWorkloadOutput,
} from "./pack.js";

export interface WorkloadCaseResult {
  caseId: string;
  schemaValid: boolean;
  output:
    | Record<
        string,
        WorkloadExpectedValue
      >
    | null;
  latencyMs: number;
}

export interface WorkloadMetricResult {
  metric: string;
  scorer: WorkloadMetricDefinition["scorer"];
  observed: number;
  threshold: WorkloadMetricThreshold;
  state: "PASS" | "FAIL";
}

export interface WorkloadScore {
  metrics: WorkloadMetricResult[];
  mandatoryPass: boolean;
}

function safeDivide(
  numerator: number,
  denominator: number,
): number {
  return denominator === 0
    ? 0
    : numerator /
        denominator;
}

function percentile(
  values: number[],
  percentileValue: number,
): number {
  if (
    values.length === 0
  ) {
    throw new WorkloadPackError(
      "WORKLOAD_SCORE_ERROR",
      "Cannot compute percentile over no values",
    );
  }

  const ordered =
    [...values].sort(
      (a, b) => a - b,
    );

  const rank =
    Math.ceil(
      percentileValue *
        ordered.length,
    ) - 1;

  return ordered[
    Math.max(
      0,
      Math.min(
        rank,
        ordered.length - 1,
      ),
    )
  ]!;
}

function passes(
  observed: number,
  threshold:
    WorkloadMetricThreshold,
): boolean {
  switch (
    threshold.operator
  ) {
    case "gte":
      return (
        observed >=
        threshold.value
      );
    case "lte":
      return (
        observed <=
        threshold.value
      );
    case "eq":
      return (
        observed ===
        threshold.value
      );
  }
}

function resultValue(
  result:
    WorkloadCaseResult,
  field: string,
): WorkloadExpectedValue | null {
  if (
    !result.schemaValid ||
    !result.output
  ) {
    return null;
  }

  return (
    result.output[field] ??
    null
  );
}

function macroF1(
  pack: WorkloadPack,
  byId:
    Map<
      string,
      WorkloadCaseResult
    >,
  field: string,
): number {
  const schema =
    pack.task.output.fields[
      field
    ];

  if (
    !schema ||
    schema.type !== "enum"
  ) {
    throw new WorkloadPackError(
      "WORKLOAD_SCORE_ERROR",
      `macro_f1 field ${field} is not enum`,
    );
  }

  const baseline =
    pack.cases.filter(
      (item) =>
        item.kind ===
        "BASELINE",
    );

  const values: number[] = [];

  for (
    const label of
    schema.values
  ) {
    let tp = 0;
    let fp = 0;
    let fn = 0;

    for (
      const testCase of
      baseline
    ) {
      const predicted =
        resultValue(
          byId.get(
            testCase.id,
          )!,
          field,
        );

      const expected =
        testCase.expected[
          field
        ];

      if (
        expected === label &&
        predicted === label
      ) {
        tp += 1;
      } else {
        if (
          expected !== label &&
          predicted === label
        ) {
          fp += 1;
        }

        if (
          expected === label &&
          predicted !== label
        ) {
          fn += 1;
        }
      }
    }

    const precision =
      safeDivide(
        tp,
        tp + fp,
      );

    const recall =
      safeDivide(
        tp,
        tp + fn,
      );

    values.push(
      precision + recall === 0
        ? 0
        : (
            2 *
            precision *
            recall
          ) /
            (
              precision +
              recall
            ),
    );
  }

  return (
    values.reduce(
      (sum, value) =>
        sum + value,
      0,
    ) / values.length
  );
}

function criticalRecall(
  pack: WorkloadPack,
  byId:
    Map<
      string,
      WorkloadCaseResult
    >,
  field: string,
  criticalValues:
    string[],
): number {
  const baseline =
    pack.cases.filter(
      (item) =>
        item.kind ===
        "BASELINE",
    );

  const recalls: number[] = [];

  for (
    const label of
    criticalValues
  ) {
    let tp = 0;
    let fn = 0;

    for (
      const testCase of
      baseline
    ) {
      if (
        testCase.expected[
          field
        ] !== label
      ) {
        continue;
      }

      const predicted =
        resultValue(
          byId.get(
            testCase.id,
          )!,
          field,
        );

      if (
        predicted === label
      ) {
        tp += 1;
      } else {
        fn += 1;
      }
    }

    recalls.push(
      safeDivide(
        tp,
        tp + fn,
      ),
    );
  }

  return (
    recalls.reduce(
      (sum, value) =>
        sum + value,
      0,
    ) /
    recalls.length
  );
}

function exactMatchRate(
  pack: WorkloadPack,
  byId:
    Map<
      string,
      WorkloadCaseResult
    >,
  fields: string[],
): number {
  const baseline =
    pack.cases.filter(
      (item) =>
        item.kind ===
        "BASELINE",
    );

  let matched = 0;

  for (
    const testCase of
    baseline
  ) {
    const result =
      byId.get(
        testCase.id,
      )!;

    if (
      result.schemaValid &&
      result.output &&
      fields.every(
        (field) =>
          result.output![field] ===
          testCase.expected[field],
      )
    ) {
      matched += 1;
    }
  }

  return safeDivide(
    matched,
    baseline.length,
  );
}

function pairedInvariance(
  pack: WorkloadPack,
  byId:
    Map<
      string,
      WorkloadCaseResult
    >,
  fields: string[],
): number {
  const adversarial =
    pack.cases.filter(
      (item) =>
        item.kind ===
        "ADVERSARIAL",
    );

  if (
    adversarial.length === 0
  ) {
    return 1;
  }

  let invariant = 0;

  for (
    const testCase of
    adversarial
  ) {
    const result =
      byId.get(
        testCase.id,
      )!;

    const source =
      byId.get(
        testCase.sourceCaseId!,
      )!;

    if (
      result.schemaValid &&
      source.schemaValid &&
      result.output &&
      source.output &&
      fields.every(
        (field) =>
          result.output![field] ===
          source.output![field],
      )
    ) {
      invariant += 1;
    }
  }

  return safeDivide(
    invariant,
    adversarial.length,
  );
}

export function scoreWorkloadPack(
  pack: WorkloadPack,
  results:
    readonly WorkloadCaseResult[],
): WorkloadScore {
  if (!verifyWorkloadPack(pack)) throw new WorkloadPackError("WORKLOAD_PACK_INTEGRITY_ERROR", "Invalid workload pack schema or digest");
  const expectedIds =
    new Set(
      pack.cases.map(
        (item) => item.id,
      ),
    );

  const byId =
    new Map<
      string,
      WorkloadCaseResult
    >();

  for (
    const result of
    results
  ) {
    if (
      !expectedIds.has(
        result.caseId,
      )
    ) {
      throw new WorkloadPackError(
        "WORKLOAD_SCORE_ERROR",
        `Unexpected case result: ${result.caseId}`,
      );
    }

    if (
      byId.has(
        result.caseId,
      )
    ) {
      throw new WorkloadPackError(
        "WORKLOAD_SCORE_ERROR",
        `Duplicate case result: ${result.caseId}`,
      );
    }

    if (
      !Number.isFinite(
        result.latencyMs,
      ) ||
      result.latencyMs < 0
    ) {
      throw new WorkloadPackError(
        "WORKLOAD_SCORE_ERROR",
        `Invalid latency for ${result.caseId}`,
      );
    }

    byId.set(
      result.caseId,
      { ...result, ...validateWorkloadOutput(pack, result.output) },
    );
  }

  if (
    byId.size !==
    expectedIds.size
  ) {
    throw new WorkloadPackError(
      "WORKLOAD_SCORE_ERROR",
      "Workload evaluation is incomplete",
    );
  }

  const metrics:
    WorkloadMetricResult[] = [];

  for (
    const definition of
    pack.metrics
  ) {
    let observed: number;

    switch (
      definition.scorer
    ) {
      case "macro_f1":
        observed =
          macroF1(
            pack,
            byId,
            definition.field,
          );
        break;
      case "critical_recall":
        observed =
          criticalRecall(
            pack,
            byId,
            definition.field,
            definition.criticalValues,
          );
        break;
      case "schema_validity":
        observed =
          safeDivide(
            [...byId.values()]
              .filter(
                (item) =>
                  item.schemaValid,
              ).length,
            byId.size,
          );
        break;
      case "paired_invariance":
        observed =
          pairedInvariance(
            pack,
            byId,
            definition.fields,
          );
        break;
      case "exact_match_rate":
        observed =
          exactMatchRate(
            pack,
            byId,
            definition.fields,
          );
        break;
      case "p95_latency_ms":
        observed =
          percentile(
            [...byId.values()]
              .map(
                (item) =>
                  item.latencyMs,
              ),
            0.95,
          );
        break;
    }

    metrics.push({
      metric:
        definition.id,
      scorer:
        definition.scorer,
      observed,
      threshold:
        definition.threshold,
      state:
        passes(
          observed,
          definition.threshold,
        )
          ? "PASS"
          : "FAIL",
    });
  }

  return {
    metrics,
    mandatoryPass:
      metrics
        .filter(
          (item) =>
            item.threshold
              .criticality ===
            "MANDATORY",
        )
        .every(
          (item) =>
            item.state ===
            "PASS",
        ),
  };
}
