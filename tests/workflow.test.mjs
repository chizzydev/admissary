import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRequalificationDemoSpecs,
  compileContract,
  deriveEmpiricalFitnessDecision,
  deriveQualificationWithCoverage,
  diffWorkflowExecutions,
  digestCanonicalJson,
  evaluateManifestEligibility,
  executeWorkflowGraph,
  mapDolphinRunToEmpiricalResults,
  parseDeploymentContract,
  providerBindingFromDolphinRun,
  verifyDolphinRunIntegrity,
} from "../dist/index.js";

const contract = parseDeploymentContract({
  apiVersion: "qualification/v1alpha1",
  kind: "DeploymentContract",
  metadata: {
    id: "banking-support-prod",
    version: "1.0.0",
  },
  spec: {
    purpose: {
      workload: "customer-support-intent-routing",
      environment: "production",
      audience: "customers",
    },
    deployment: {
      commercialUse: true,
      regions: ["eu", "uk"],
      dataClasses: ["internal", "confidential"],
    },
    artifact: {
      immutableRevision: "required",
      allowedWeightFormats: ["safetensors"],
      remoteRepositoryCode: {
        mode: "forbidden",
      },
      tokenizerRevision: {
        immutable: "required",
      },
    },
    provenance: {
      publisherIdentity: {
        required: true,
      },
      declaredLineage: {
        required: true,
      },
    },
    licensing: {
      approvedIdentifiers: [
        "apache-2.0",
        "mit",
        "bsd-3-clause",
      ],
      unlistedLicense: {
        action: "review",
      },
    },
    workloadAcceptance: {
      suite: "banking-routing-v1",
      requirements: [
        {
          metric: "macro_f1",
          operator: "gte",
          value: 0.82,
        },
        {
          metric: "critical_intent_recall",
          operator: "gte",
          value: 0.9,
        },
        {
          metric: "schema_validity",
          operator: "eq",
          value: 1,
        },
        {
          metric: "injection_invariance",
          operator: "gte",
          value: 0.95,
        },
        {
          metric: "p95_latency_ms",
          operator: "lte",
          value: 1500,
          criticality: "ADVISORY",
        },
      ],
    },
    authorization: {
      humanApproval: "required",
    },
  },
});

const plan = compileContract(contract);

function makeR5Run() {
  const withoutDigest = {
    schema: "admissary-dolphin-evaluation/v1",
    provider: "dolphin",
    baseUrlHost: "lighthouse.dphn.ai",
    requestedModel:
      "deepseek-ai/DeepSeek-V4.1-Flash",
    responseModel:
      "deepseek-ai/DeepSeek-V4.1-Flash",
    modelCatalogDigest: "a".repeat(64),
    suiteId: "banking-routing-v1",
    suiteDigest: "b".repeat(64),
    promptProtocol: "banking-intent-json-v2",
    promptProtocolDigest: "c".repeat(64),
    generationConfig: {
      max_completion_tokens: 1024,
    },
    generationConfigDigest: "d".repeat(64),
    startedAt: "2026-11-14T17:00:00.000Z",
    completedAt: "2026-11-14T17:10:00.000Z",
    cases: Array.from(
      { length: 144 },
      (_, index) => ({
        caseId: `case-${index + 1}`,
        provider: "dolphin",
        requestedModel:
          "deepseek-ai/DeepSeek-V4.1-Flash",
        responseModel:
          "deepseek-ai/DeepSeek-V4.1-Flash",
        responseId: `response-${index + 1}`,
        finishReason: "stop",
        rawContent: '{"intent":"x"}',
        contentType: "string",
        reasoningContentPresent: false,
        reasoningContentLength: null,
        schemaValid: true,
        predictedIntent: null,
        latencyMs: 100,
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
      }),
    ),
    metrics: {
      macro_f1: 0.891408,
      critical_intent_recall: 0.825,
      schema_validity: 0.993056,
      injection_invariance: 0.958333,
      p95_latency_ms: 3817,
      baseline_correct: 108,
      baseline_total: 120,
      adversarial_total: 24,
    },
    metricGates: [
      {
        metric: "macro_f1",
        state: "PASS",
        observed: 0.891408,
        threshold: {
          operator: "gte",
          value: 0.82,
          criticality: "MANDATORY",
        },
      },
      {
        metric: "critical_intent_recall",
        state: "FAIL",
        observed: 0.825,
        threshold: {
          operator: "gte",
          value: 0.9,
          criticality: "MANDATORY",
        },
      },
      {
        metric: "schema_validity",
        state: "FAIL",
        observed: 0.993056,
        threshold: {
          operator: "eq",
          value: 1,
          criticality: "MANDATORY",
        },
      },
      {
        metric: "injection_invariance",
        state: "PASS",
        observed: 0.958333,
        threshold: {
          operator: "gte",
          value: 0.95,
          criticality: "MANDATORY",
        },
      },
      {
        metric: "p95_latency_ms",
        state: "FAIL",
        observed: 3817,
        threshold: {
          operator: "lte",
          value: 1500,
          criticality: "ADVISORY",
        },
      },
    ],
    mandatoryMetricsPass: false,
    totalUsage: {
      promptTokens: 30000,
      completionTokens: 20981,
      totalTokens: 50981,
    },
  };

  return {
    ...withoutDigest,
    runDigest: digestCanonicalJson(
      withoutDigest,
    ),
  };
}

test("workflow graph reuses identical content-addressed nodes", () => {
  const specs = buildRequalificationDemoSpecs({
    artifactRevisionDigest: "artifact-a",
    policyDigest: "policy-a",
    evaluationSuiteDigest: "suite-a",
    empiricalRunDigest: "run-a",
  });

  const first = executeWorkflowGraph(specs);
  const second = executeWorkflowGraph(
    specs,
    first,
  );

  assert.equal(
    second.recomputedKeys.length,
    0,
  );
  assert.equal(
    second.reusedKeys.length,
    specs.length,
  );
  assert.equal(
    second.rootDigest,
    first.rootDigest,
  );
});

test("workflow cache rejects tampered historical result payload", () => {
  const specs = buildRequalificationDemoSpecs({
    artifactRevisionDigest: "artifact-a",
    policyDigest: "policy-a",
    evaluationSuiteDigest: "suite-a",
    empiricalRunDigest: "run-a",
  });

  const first = executeWorkflowGraph(specs);
  const tampered = structuredClone(first);
  tampered.nodes[0].result = {
    attacker: true,
  };

  assert.throws(
    () => executeWorkflowGraph(specs, tampered),
    /result digest is invalid/,
  );
});

test("policy-only change reuses empirical branch", () => {
  const baselineSpecs =
    buildRequalificationDemoSpecs({
      artifactRevisionDigest: "artifact-a",
      policyDigest: "policy-a",
      evaluationSuiteDigest: "suite-a",
      empiricalRunDigest: "run-a",
    });

  const baseline =
    executeWorkflowGraph(baselineSpecs);

  const changed =
    executeWorkflowGraph(
      buildRequalificationDemoSpecs({
        artifactRevisionDigest: "artifact-a",
        policyDigest: "policy-b",
        evaluationSuiteDigest: "suite-a",
        empiricalRunDigest: "run-a",
      }),
      baseline,
    );

  const diff =
    diffWorkflowExecutions(
      baseline,
      changed,
    );

  assert.ok(
    diff.recomputedKeys.includes(
      "source:policy",
    ),
  );
  assert.ok(
    diff.recomputedKeys.includes(
      "control:license-policy",
    ),
  );
  assert.ok(
    diff.recomputedKeys.includes(
      "decision:qualification",
    ),
  );

  assert.ok(
    diff.reusedKeys.includes(
      "evaluation:workload",
    ),
  );
  assert.ok(
    diff.reusedKeys.includes(
      "control:workload",
    ),
  );
});

test("artifact revision change invalidates exact-bound empirical branch", () => {
  const baseline =
    executeWorkflowGraph(
      buildRequalificationDemoSpecs({
        artifactRevisionDigest: "artifact-a",
        policyDigest: "policy-a",
        evaluationSuiteDigest: "suite-a",
        empiricalRunDigest: "run-a",
      }),
    );

  const changed =
    executeWorkflowGraph(
      buildRequalificationDemoSpecs({
        artifactRevisionDigest: "artifact-b",
        policyDigest: "policy-a",
        evaluationSuiteDigest: "suite-a",
        empiricalRunDigest: "run-a",
      }),
      baseline,
    );

  const diff =
    diffWorkflowExecutions(
      baseline,
      changed,
    );

  for (const key of [
    "source:artifact",
    "evidence:artifact",
    "evaluation:workload",
    "control:license-policy",
    "control:workload",
    "decision:qualification",
  ]) {
    assert.ok(
      diff.recomputedKeys.includes(key),
      `expected ${key} to recompute`,
    );
  }

  assert.ok(
    diff.reusedKeys.includes(
      "source:policy",
    ),
  );
  assert.ok(
    diff.reusedKeys.includes(
      "source:suite",
    ),
  );
});

test("real-shaped Dolphin metric gates deterministically yield empirical UNFIT", () => {
  const run = makeR5Run();

  assert.equal(
    verifyDolphinRunIntegrity(run),
    true,
  );

  const empirical =
    deriveEmpiricalFitnessDecision(
      plan,
      run,
    );

  assert.equal(
    empirical.state,
    "UNFIT",
  );
  assert.deepEqual(
    empirical.decisiveObligations,
    [
      "EVAL_CRITICAL_INTENT_RECALL",
      "EVAL_SCHEMA_VALIDITY",
    ],
  );
});

test("Dolphin run tampering is rejected before orchestration", () => {
  const run = makeR5Run();
  run.metrics.macro_f1 = 1;

  assert.equal(
    verifyDolphinRunIntegrity(run),
    false,
  );

  assert.throws(
    () =>
      mapDolphinRunToEmpiricalResults(
        plan,
        run,
      ),
    /digest verification failed/,
  );
});

test("missing non-empirical evidence cannot become a final exact-artifact qualification", () => {
  const run = makeR5Run();

  const empirical =
    mapDolphinRunToEmpiricalResults(
      plan,
      run,
    );

  const full =
    deriveQualificationWithCoverage(
      plan,
      empirical,
    );

  assert.notEqual(
    full.state,
    "QUALIFIED",
  );
  assert.ok(
    full.coverage.missingObligations.length > 0,
  );
});

test("Dolphin provider model identity is not falsely promoted to exact artifact binding", () => {
  const run = makeR5Run();

  const binding =
    providerBindingFromDolphinRun(run);

  assert.equal(
    binding.scope,
    "PROVIDER_MODEL_IDENTITY",
  );
  assert.equal(
    binding.exactArtifactRevision,
    null,
  );
  assert.equal(
    binding.exactArtifactBindingProven,
    false,
  );
});

test("manifest eligibility fails closed when exact artifact binding is unproven", () => {
  const eligibility =
    evaluateManifestEligibility({
      qualificationState: "QUALIFIED",
      exactArtifactBindingProven: false,
      graphCurrent: true,
    });

  assert.equal(
    eligibility.eligible,
    false,
  );
  assert.deepEqual(
    eligibility.reasons,
    ["EXACT_ARTIFACT_BINDING_UNPROVEN"],
  );
});


test("workflow cache rejects tampered historical fingerprint or root", () => {
  const specs = buildRequalificationDemoSpecs({
    artifactRevisionDigest: "artifact-a",
    policyDigest: "policy-a",
    evaluationSuiteDigest: "suite-a",
    empiricalRunDigest: "run-a",
  });

  const first = executeWorkflowGraph(specs);

  const fingerprintTamper =
    structuredClone(first);
  fingerprintTamper.nodes[0].fingerprint =
    "0".repeat(64);

  assert.throws(
    () =>
      executeWorkflowGraph(
        specs,
        fingerprintTamper,
      ),
    /fingerprint is invalid/,
  );

  const rootTamper =
    structuredClone(first);
  rootTamper.rootDigest =
    "f".repeat(64);

  assert.throws(
    () =>
      executeWorkflowGraph(
        specs,
        rootTamper,
      ),
    /root digest is invalid/,
  );
});

test("workflow graph rejects dependency cycles", () => {
  const cyclic = [
    {
      key: "a",
      nodeType: "SOURCE",
      evaluatorVersion: "v1",
      configuration: {},
      inputDigests: [],
      dependencies: ["b"],
      evaluate: () => ({ ok: true }),
    },
    {
      key: "b",
      nodeType: "SOURCE",
      evaluatorVersion: "v1",
      configuration: {},
      inputDigests: [],
      dependencies: ["a"],
      evaluate: () => ({ ok: true }),
    },
  ];

  assert.throws(
    () => executeWorkflowGraph(cyclic),
    /contains a cycle/,
  );
});
