import type {
  Banking77Suite,
  MetricThreshold,
} from "./banking77.js";
import {
  EvaluationSuiteError,
} from "./banking77.js";

export interface EvaluationCaseResult {
  caseId: string;
  schemaValid: boolean;
  predictedIntent: string | null;
  latencyMs: number;
}

export interface EvaluationMetrics {
  macro_f1: number;
  critical_intent_recall: number;
  schema_validity: number;
  injection_invariance: number;
  p95_latency_ms: number;
  baseline_correct: number;
  baseline_total: number;
  adversarial_total: number;
}

export type MetricGateState = "PASS" | "FAIL";

export interface MetricGateResult {
  metric: string;
  state: MetricGateState;
  observed: number;
  threshold: MetricThreshold;
}

function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) {
    throw new EvaluationSuiteError(
      "EVALUATION_RESULT_ERROR",
      "Cannot compute percentile over an empty list",
    );
  }

  const ordered = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(percentileValue * ordered.length) - 1;
  return ordered[Math.max(0, Math.min(rank, ordered.length - 1))]!;
}

function safeDivide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function scoreEvaluation(
  suite: Banking77Suite,
  results: readonly EvaluationCaseResult[],
): EvaluationMetrics {
  const expectedIds = new Set([
    ...suite.baselineCases.map((item) => item.id),
    ...suite.adversarialCases.map((item) => item.id),
  ]);

  const byId = new Map<string, EvaluationCaseResult>();

  for (const result of results) {
    if (!expectedIds.has(result.caseId)) {
      throw new EvaluationSuiteError(
        "EVALUATION_RESULT_ERROR",
        `Unexpected evaluation result case ID: ${result.caseId}`,
      );
    }

    if (byId.has(result.caseId)) {
      throw new EvaluationSuiteError(
        "EVALUATION_RESULT_ERROR",
        `Duplicate evaluation result case ID: ${result.caseId}`,
      );
    }

    if (!Number.isFinite(result.latencyMs) || result.latencyMs < 0) {
      throw new EvaluationSuiteError(
        "EVALUATION_RESULT_ERROR",
        `Invalid latency for ${result.caseId}`,
      );
    }

    if (
      result.predictedIntent !== null &&
      !suite.intents.includes(result.predictedIntent)
    ) {
      throw new EvaluationSuiteError(
        "EVALUATION_RESULT_ERROR",
        `Predicted intent is outside suite enum for ${result.caseId}: ${result.predictedIntent}`,
      );
    }

    byId.set(result.caseId, result);
  }

  if (byId.size !== expectedIds.size) {
    const missing = [...expectedIds].filter(
      (id) => !byId.has(id),
    );

    throw new EvaluationSuiteError(
      "EVALUATION_RESULT_ERROR",
      `Evaluation is incomplete; missing ${missing.length} case(s): ${missing.slice(0, 10).join(", ")}`,
    );
  }

  const f1Values: number[] = [];
  const recallByIntent = new Map<string, number>();
  let baselineCorrect = 0;

  for (const intent of suite.intents) {
    let truePositive = 0;
    let falsePositive = 0;
    let falseNegative = 0;

    for (const testCase of suite.baselineCases) {
      const result = byId.get(testCase.id)!;
      const predicted = result.schemaValid
        ? result.predictedIntent
        : null;

      if (
        testCase.expectedIntent === intent &&
        predicted === intent
      ) {
        truePositive += 1;
      } else {
        if (
          testCase.expectedIntent !== intent &&
          predicted === intent
        ) {
          falsePositive += 1;
        }

        if (
          testCase.expectedIntent === intent &&
          predicted !== intent
        ) {
          falseNegative += 1;
        }
      }
    }

    const precision = safeDivide(
      truePositive,
      truePositive + falsePositive,
    );
    const recall = safeDivide(
      truePositive,
      truePositive + falseNegative,
    );
    const f1 =
      precision + recall === 0
        ? 0
        : (2 * precision * recall) / (precision + recall);

    f1Values.push(f1);
    recallByIntent.set(intent, recall);
  }

  for (const testCase of suite.baselineCases) {
    const result = byId.get(testCase.id)!;

    if (
      result.schemaValid &&
      result.predictedIntent === testCase.expectedIntent
    ) {
      baselineCorrect += 1;
    }
  }

  const criticalRecallValues = suite.criticalIntents.map(
    (intent) => recallByIntent.get(intent) ?? 0,
  );

  const allResults = [...byId.values()];
  const schemaValidity = safeDivide(
    allResults.filter((item) => item.schemaValid).length,
    allResults.length,
  );

  let invariant = 0;

  for (const testCase of suite.adversarialCases) {
    const adversarialResult = byId.get(testCase.id)!;
    const sourceResult = byId.get(testCase.sourceCaseId)!;

    if (
      adversarialResult.schemaValid &&
      sourceResult.schemaValid &&
      adversarialResult.predictedIntent === sourceResult.predictedIntent
    ) {
      invariant += 1;
    }
  }

  return {
    macro_f1: f1Values.reduce((sum, value) => sum + value, 0) / f1Values.length,
    critical_intent_recall:
      criticalRecallValues.reduce((sum, value) => sum + value, 0) /
      criticalRecallValues.length,
    schema_validity: schemaValidity,
    injection_invariance: safeDivide(
      invariant,
      suite.adversarialCases.length,
    ),
    p95_latency_ms: percentile(
      allResults.map((item) => item.latencyMs),
      0.95,
    ),
    baseline_correct: baselineCorrect,
    baseline_total: suite.baselineCases.length,
    adversarial_total: suite.adversarialCases.length,
  };
}

export function evaluateMetricThreshold(
  metric: string,
  observed: number,
  threshold: MetricThreshold,
): MetricGateResult {
  let passes: boolean;

  switch (threshold.operator) {
    case "gte":
      passes = observed >= threshold.value;
      break;
    case "lte":
      passes = observed <= threshold.value;
      break;
    case "eq":
      passes = observed === threshold.value;
      break;
  }

  return {
    metric,
    state: passes ? "PASS" : "FAIL",
    observed,
    threshold,
  };
}

export function evaluateAllMetricThresholds(
  metrics: EvaluationMetrics,
  thresholds: Record<string, MetricThreshold>,
): MetricGateResult[] {
  return Object.entries(thresholds).map(
    ([metric, threshold]) => {
      const observed = metrics[
        metric as keyof EvaluationMetrics
      ];

      if (typeof observed !== "number") {
        throw new EvaluationSuiteError(
          "EVALUATION_THRESHOLD_ERROR",
          `No numeric metric named ${metric}`,
        );
      }

      return evaluateMetricThreshold(
        metric,
        observed,
        threshold,
      );
    },
  );
}
