import { verifyWorkloadPack, type WorkloadPack } from "../workloads/pack.js";
import type { Banking77Suite } from "../evaluation/banking77.js";
import {
  digestCanonicalJson,
} from "../qualification/canonical.js";
import {
  decideQualification, validateObligationResults,
} from "../qualification/decision.js";
import type {
  QualificationPlan,
} from "../qualification/compiler.js";
import type {
  Obligation,
  ObligationResult,
  QualificationState,
} from "../qualification/types.js";
import type {
  DolphinEvaluationRun,
} from "../providers/dolphin.js";
import type {
  WorkflowExecution,
  WorkflowNodeSpec,
} from "./dependency-graph.js";
import {
  executeWorkflowGraph,
} from "./dependency-graph.js";

export const R6_WORKFLOW_VERSION =
  "qualification-orchestrator/v1";

export type EmpiricalBindingScope =
  | "PROVIDER_MODEL_IDENTITY"
  | "EXACT_ARTIFACT";

export interface EmpiricalBinding {
  scope: EmpiricalBindingScope;
  provider: "dolphin";
  baseUrlHost: string;
  requestedModel: string;
  responseModel: string;
  modelCatalogDigest: string;
  exactArtifactRevision: string | null;
  exactArtifactBindingProven: boolean;
}

export interface EmpiricalFitnessDecision {
  state: QualificationState;
  decisiveObligations: string[];
  obligationResults: ObligationResult[];
}

export interface QualificationCoverage {
  expectedObligations: string[];
  suppliedObligations: string[];
  missingObligations: string[];
  synthesizedUnknownObligations: string[];
}

export interface QualificationCoverageDecision {
  state: QualificationState;
  decisiveObligations: string[];
  coverage: QualificationCoverage;
  obligationResults: ObligationResult[];
}

export interface ManifestEligibility {
  eligible: boolean;
  reasons: string[];
}

export class OrchestrationError extends Error {
  readonly code: string;

  constructor(
    code: string,
    message: string,
  ) {
    super(message);
    this.name = "OrchestrationError";
    this.code = code;
  }
}

function metricId(metric: string): string {
  return metric
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function canonicalDolphinPayload(
  run: DolphinEvaluationRun,
): Omit<DolphinEvaluationRun, "runDigest"> {
  const {
    runDigest: _runDigest,
    ...payload
  } = run;

  return payload;
}

export function verifyDolphinRunIntegrity(
  run: DolphinEvaluationRun,
): boolean {
  return (
    digestCanonicalJson(
      canonicalDolphinPayload(run),
    ) === run.runDigest
  );
}

function empiricalObligations(
  plan: QualificationPlan,
): Obligation[] {
  return plan.obligations.filter(
    (obligation) => obligation.kind === "EMPIRICAL",
  );
}

export function mapDolphinRunToEmpiricalResults(
  plan: QualificationPlan,
  run: DolphinEvaluationRun,
): ObligationResult[] {
  if (!verifyDolphinRunIntegrity(run)) {
    throw new OrchestrationError(
      "R6_DOLPHIN_RUN_TAMPER",
      "Dolphin run digest verification failed",
    );
  }

  if (
    run.suiteId !== plan.evaluationSuite
  ) {
    throw new OrchestrationError(
      "R6_SUITE_MISMATCH",
      `Qualification plan expects ${plan.evaluationSuite}, run contains ${run.suiteId}`,
    );
  }

  const byMetric = new Map(
    run.metricGates.map(
      (gate) => [gate.metric, gate],
    ),
  );

  const results: ObligationResult[] = [];

  for (const obligation of empiricalObligations(plan)) {
    const evaluatorPrefix = "dolphin.metric.";

    if (!obligation.evaluator.startsWith(evaluatorPrefix)) {
      throw new OrchestrationError(
        "R6_EMPIRICAL_EVALUATOR_ERROR",
        `Unsupported empirical evaluator: ${obligation.evaluator}`,
      );
    }

    const metric = obligation.evaluator
      .slice(evaluatorPrefix.length)
      .replace(/\/v1$/, "");

    const gate = byMetric.get(metric);

    if (!gate) {
      throw new OrchestrationError(
        "R6_METRIC_MISSING",
        `Dolphin run is missing metric gate ${metric}`,
      );
    }

    const expectedObligationId =
      `EVAL_${metricId(metric)}`;

    if (obligation.id !== expectedObligationId) {
      throw new OrchestrationError(
        "R6_METRIC_BINDING_ERROR",
        `Empirical obligation ${obligation.id} does not match metric ${metric}`,
      );
    }

    if (
      gate.threshold.criticality !==
      obligation.criticality
    ) {
      throw new OrchestrationError(
        "R6_CRITICALITY_MISMATCH",
        `Metric ${metric} criticality differs between contract and run`,
      );
    }

    const requirement =
      obligation.requirement as {
        operator?: unknown;
        value?: unknown;
      };

    if (
      gate.threshold.operator !== requirement.operator ||
      gate.threshold.value !== requirement.value
    ) {
      throw new OrchestrationError(
        "R6_THRESHOLD_MISMATCH",
        `Metric ${metric} threshold differs between contract and run`,
      );
    }

    results.push({
      obligationId: obligation.id,
      kind: obligation.kind,
      criticality: obligation.criticality,
      state: gate.state,
      detail:
        `${metric} observed=${gate.observed} ` +
        `${gate.threshold.operator} ${gate.threshold.value}`,
    });
  }

  return results.sort(
    (a, b) => a.obligationId.localeCompare(b.obligationId),
  );
}

export function deriveEmpiricalFitnessDecision(
  plan: QualificationPlan,
  run: DolphinEvaluationRun,
): EmpiricalFitnessDecision {
  const obligationResults =
    mapDolphinRunToEmpiricalResults(
      plan,
      run,
    );

  const decision =
    decideQualification(obligationResults);

  return {
    state: decision.state,
    decisiveObligations:
      decision.decisiveObligations,
    obligationResults,
  };
}

export function deriveQualificationWithCoverage(
  plan: QualificationPlan,
  suppliedResults: readonly ObligationResult[],
): QualificationCoverageDecision {
  validateObligationResults(suppliedResults);
  const expected = new Map(
    plan.obligations.map(
      (obligation) => [obligation.id, obligation],
    ),
  );

  const supplied = new Map<string, ObligationResult>();

  for (const result of suppliedResults) {
    if (!expected.has(result.obligationId)) {
      throw new OrchestrationError(
        "R6_UNKNOWN_OBLIGATION_RESULT",
        `Result supplied for unknown obligation ${result.obligationId}`,
      );
    }

    if (supplied.has(result.obligationId)) {
      throw new OrchestrationError(
        "R6_DUPLICATE_OBLIGATION_RESULT",
        `Duplicate result for obligation ${result.obligationId}`,
      );
    }

    const obligation = expected.get(result.obligationId)!;

    if (
      result.kind !== obligation.kind ||
      result.criticality !== obligation.criticality
    ) {
      throw new OrchestrationError(
        "R6_OBLIGATION_IDENTITY_MISMATCH",
        `Result identity differs from compiled obligation ${result.obligationId}`,
      );
    }

    supplied.set(result.obligationId, result);
  }

  const completeResults: ObligationResult[] = [];
  const missing: string[] = [];
  const synthesized: string[] = [];

  for (const obligation of plan.obligations) {
    const result = supplied.get(obligation.id);

    if (result) {
      completeResults.push(result);
      continue;
    }

    missing.push(obligation.id);
    synthesized.push(obligation.id);

    completeResults.push({
      obligationId: obligation.id,
      kind: obligation.kind,
      criticality: obligation.criticality,
      state: "UNKNOWN",
      detail: "No current evidence result supplied",
    });
  }

  const decision =
    decideQualification(completeResults);

  return {
    state: decision.state,
    decisiveObligations:
      decision.decisiveObligations,
    coverage: {
      expectedObligations: [
        ...expected.keys(),
      ].sort(),
      suppliedObligations: [
        ...supplied.keys(),
      ].sort(),
      missingObligations: missing.sort(),
      synthesizedUnknownObligations:
        synthesized.sort(),
    },
    obligationResults:
      completeResults.sort(
        (a, b) =>
          a.obligationId.localeCompare(
            b.obligationId,
          ),
      ),
  };
}

export function providerBindingFromDolphinRun(
  run: DolphinEvaluationRun,
): EmpiricalBinding {
  if (!verifyDolphinRunIntegrity(run)) {
    throw new OrchestrationError(
      "R6_DOLPHIN_RUN_TAMPER",
      "Dolphin run digest verification failed",
    );
  }

  return {
    scope: "PROVIDER_MODEL_IDENTITY",
    provider: "dolphin",
    baseUrlHost: run.baseUrlHost,
    requestedModel: run.requestedModel,
    responseModel: run.responseModel,
    modelCatalogDigest:
      run.modelCatalogDigest,
    exactArtifactRevision: null,
    exactArtifactBindingProven: false,
  };
}

export function evaluateManifestEligibility(
  input: {
    qualificationState: QualificationState;
    exactArtifactBindingProven: boolean;
    graphCurrent: boolean;
  },
): ManifestEligibility {
  const reasons: string[] = [];

  if (input.qualificationState !== "QUALIFIED") {
    reasons.push(
      `QUALIFICATION_${input.qualificationState}`,
    );
  }

  if (!input.exactArtifactBindingProven) {
    reasons.push(
      "EXACT_ARTIFACT_BINDING_UNPROVEN",
    );
  }

  if (!input.graphCurrent) {
    reasons.push(
      "QUALIFICATION_GRAPH_STALE",
    );
  }

  return {
    eligible: reasons.length === 0,
    reasons,
  };
}

export interface R5WorkflowGraphInput {
  contractDigest: string;
  suiteDigest: string;
  workloadPack: WorkloadPack;
  evaluationSuite: Banking77Suite;
  run: DolphinEvaluationRun;
  plan: QualificationPlan;
}

export function buildR5EmpiricalWorkflowSpecs(
  input: R5WorkflowGraphInput,
): WorkflowNodeSpec[] {
  if (input.suiteDigest !== input.run.suiteDigest || input.plan.evaluationSuite !== input.run.suiteId) {
    throw new OrchestrationError("R6_SUITE_BINDING_MISMATCH", "Run, plan and graph evaluation suite identity/digest must match");
  }
  const pack = input.workloadPack, suite = input.evaluationSuite;
  if (!pack || !suite || !verifyWorkloadPack(pack) || suite.schema !== "admissary-evaluation-suite/v1" ||
      input.plan.evaluationDigest !== input.run.suiteDigest || pack.legacyBinding?.suiteDigest !== input.run.suiteDigest ||
      pack.legacyBinding?.suiteId !== input.run.suiteId || suite.suiteDigest !== input.run.suiteDigest || suite.suiteId !== input.run.suiteId) {
    throw new OrchestrationError("R6_SUITE_BINDING_MISMATCH", "Run, workload pack, compiled plan and graph source must match the full evaluation identity/digest");
  }
  const { suiteDigest: stored, ...suitePayload } = suite;
  if (digestCanonicalJson(suitePayload) !== stored) throw new OrchestrationError("R6_SUITE_BINDING_MISMATCH", "Evaluation suite digest verification failed");
  const cases = [...suite.baselineCases, ...suite.adversarialCases];
  if (pack.cases.length !== cases.length || pack.cases.some(c => {
    const source = cases.find(x => x.id === c.id);
    return !source || source.kind !== c.kind || source.text !== c.input.text || source.expectedIntent !== c.expected.intent ||
      (c.kind === "ADVERSARIAL" && (!('sourceCaseId' in source) || source.sourceCaseId !== c.sourceCaseId));
  }) || pack.metrics.some(m => digestCanonicalJson(m.threshold) !== digestCanonicalJson(suite.thresholds[m.id]))) {
    throw new OrchestrationError("R6_SUITE_BINDING_MISMATCH", "Workload pack cases/thresholds do not represent the bound suite");
  }
  const binding =
    providerBindingFromDolphinRun(input.run);

  const empiricalResults =
    mapDolphinRunToEmpiricalResults(
      input.plan,
      input.run,
    );

  const specs: WorkflowNodeSpec[] = [
    {
      key: "source:contract",
      nodeType: "SOURCE",
      evaluatorVersion: "source.contract/v1",
      configuration: {
        contractId: input.plan.contractId,
        contractVersion:
          input.plan.contractVersion,
      },
      inputDigests: [input.contractDigest],
      dependencies: [],
      evaluate: () => ({
        contractId: input.plan.contractId,
        contractVersion:
          input.plan.contractVersion,
        contractDigest: input.contractDigest,
      }),
    },
    {
      key: "source:evaluation-suite",
      nodeType: "SOURCE",
      evaluatorVersion:
        "source.evaluation-suite/v1",
      configuration: {
        suiteId: input.plan.evaluationSuite,
      },
      inputDigests: [input.suiteDigest, input.workloadPack.packDigest],
      dependencies: [],
      evaluate: () => ({
        suiteId: input.plan.evaluationSuite,
        suiteDigest: input.suiteDigest,
        workloadPackDigest: input.workloadPack.packDigest,
      }),
    },
    {
      key: "source:dolphin-provider-model",
      nodeType: "SOURCE",
      evaluatorVersion:
        "source.dolphin-provider-model/v1",
      configuration: {
        provider: "dolphin",
      },
      inputDigests: [
        digestCanonicalJson(binding),
      ],
      dependencies: [],
      evaluate: () => binding,
    },
    {
      key: "evaluation:dolphin-r5",
      nodeType: "EVALUATION",
      evaluatorVersion:
        "dolphin.banking-routing/v2",
      configuration: {
        promptProtocol:
          input.run.promptProtocol,
        promptProtocolDigest:
          input.run.promptProtocolDigest,
        generationConfig:
          input.run.generationConfig,
        generationConfigDigest:
          input.run.generationConfigDigest,
      },
      inputDigests: [
        input.run.runDigest,
      ],
      dependencies: [
        "source:evaluation-suite",
        "source:dolphin-provider-model",
      ],
      evaluate: () => ({
        runDigest: input.run.runDigest,
        requestedModel:
          input.run.requestedModel,
        responseModel:
          input.run.responseModel,
        casesCompleted:
          input.run.cases.length,
        metrics: input.run.metrics,
        mandatoryMetricsPass:
          input.run.mandatoryMetricsPass,
      }),
    },
  ];

  for (const result of empiricalResults) {
    specs.push({
      key:
        `control:${result.obligationId}`,
      nodeType: "CONTROL",
      evaluatorVersion:
        "control.empirical-metric/v1",
      configuration: {
        obligationId:
          result.obligationId,
        criticality:
          result.criticality,
      },
      inputDigests: [],
      dependencies: [
        "evaluation:dolphin-r5",
      ],
      evaluate: () => result,
    });
  }

  specs.push({
    key: "decision:empirical-fitness",
    nodeType: "DECISION",
    evaluatorVersion:
      "decision.empirical-fitness/v1",
    configuration: {
      plan: `${input.plan.contractId}@${input.plan.contractVersion}`,
    },
    inputDigests: [],
    dependencies: empiricalResults.map(
      (result) =>
        `control:${result.obligationId}`,
    ),
    evaluate: () =>
      deriveEmpiricalFitnessDecision(
        input.plan,
        input.run,
      ),
  });

  return specs;
}

export function executeR5EmpiricalWorkflow(
  input: R5WorkflowGraphInput,
  previous?: WorkflowExecution,
): WorkflowExecution {
  return executeWorkflowGraph(
    buildR5EmpiricalWorkflowSpecs(input),
    previous,
  );
}

export interface RequalificationDemoInput {
  artifactRevisionDigest: string;
  policyDigest: string;
  evaluationSuiteDigest: string;
  empiricalRunDigest: string;
}

export function buildRequalificationDemoSpecs(
  input: RequalificationDemoInput,
): WorkflowNodeSpec[] {
  return [
    {
      key: "source:artifact",
      nodeType: "SOURCE",
      evaluatorVersion: "source.artifact/v1",
      configuration: {},
      inputDigests: [
        input.artifactRevisionDigest,
      ],
      dependencies: [],
      evaluate: () => ({
        artifactRevisionDigest:
          input.artifactRevisionDigest,
      }),
    },
    {
      key: "source:policy",
      nodeType: "SOURCE",
      evaluatorVersion: "source.policy/v1",
      configuration: {},
      inputDigests: [
        input.policyDigest,
      ],
      dependencies: [],
      evaluate: () => ({
        policyDigest:
          input.policyDigest,
      }),
    },
    {
      key: "source:suite",
      nodeType: "SOURCE",
      evaluatorVersion: "source.suite/v1",
      configuration: {},
      inputDigests: [
        input.evaluationSuiteDigest,
      ],
      dependencies: [],
      evaluate: () => ({
        evaluationSuiteDigest:
          input.evaluationSuiteDigest,
      }),
    },
    {
      key: "evidence:artifact",
      nodeType: "EVIDENCE",
      evaluatorVersion:
        "evidence.artifact/v1",
      configuration: {},
      inputDigests: [],
      dependencies: [
        "source:artifact",
      ],
      evaluate: (context) => ({
        artifact:
          context.dependencyResults.get(
            "source:artifact",
          ),
      }),
    },
    {
      key: "evaluation:workload",
      nodeType: "EVALUATION",
      evaluatorVersion:
        "evaluation.workload/v1",
      configuration: {},
      inputDigests: [
        input.empiricalRunDigest,
      ],
      dependencies: [
        "source:artifact",
        "source:suite",
      ],
      evaluate: (context) => ({
        runDigest:
          input.empiricalRunDigest,
        boundArtifactResultDigest:
          context.dependencyResultDigests.get(
            "source:artifact",
          ),
        suiteResultDigest:
          context.dependencyResultDigests.get(
            "source:suite",
          ),
      }),
    },
    {
      key: "control:license-policy",
      nodeType: "CONTROL",
      evaluatorVersion:
        "control.license-policy/v1",
      configuration: {},
      inputDigests: [],
      dependencies: [
        "evidence:artifact",
        "source:policy",
      ],
      evaluate: (context) => ({
        state: "PASS",
        artifactEvidenceResultDigest:
          context.dependencyResultDigests.get(
            "evidence:artifact",
          ),
        policyResultDigest:
          context.dependencyResultDigests.get(
            "source:policy",
          ),
      }),
    },
    {
      key: "control:workload",
      nodeType: "CONTROL",
      evaluatorVersion:
        "control.workload/v1",
      configuration: {},
      inputDigests: [],
      dependencies: [
        "evaluation:workload",
      ],
      evaluate: (context) => ({
        state: "PASS",
        evaluationResultDigest:
          context.dependencyResultDigests.get(
            "evaluation:workload",
          ),
      }),
    },
    {
      key: "decision:qualification",
      nodeType: "DECISION",
      evaluatorVersion:
        "decision.qualification/v1",
      configuration: {},
      inputDigests: [],
      dependencies: [
        "control:license-policy",
        "control:workload",
      ],
      evaluate: (context) => ({
        state: "QUALIFIED",
        controlResultDigests: [
          context.dependencyResultDigests.get(
            "control:license-policy",
          ),
          context.dependencyResultDigests.get(
            "control:workload",
          ),
        ],
      }),
    },
  ];
}
