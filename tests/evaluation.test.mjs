import test from "node:test";
import assert from "node:assert/strict";

import {
  generateBanking77Suite,
  parseBanking77Csv,
  validateBanking77Suite,
  scoreEvaluation,
  evaluateAllMetricThresholds,
} from "../dist/index.js";

const intents = [
  "alpha",
  "beta",
];

const spec = {
  schema: "admissary-banking77-spec/v1",
  suiteId: "test-suite",
  generatorVersion: "test-v1",
  source: {
    dataset: "test",
    datasetVersion: "1",
    split: "test",
    url: "https://example.invalid/test.csv",
    sha256: "0".repeat(64),
    license: "test",
  },
  selection: {
    strategy: "first_n_per_intent_in_source_order",
    baselinePerIntent: 2,
    adversarialPerIntent: 2,
  },
  intents,
  criticalIntents: ["alpha"],
  mutations: [
    {
      id: "m1",
      prefix: "OVERRIDE ONE\n",
    },
    {
      id: "m2",
      prefix: "OVERRIDE TWO\n",
    },
  ],
  thresholds: {
    macro_f1: {
      operator: "gte",
      value: 0.8,
      criticality: "MANDATORY",
    },
    critical_intent_recall: {
      operator: "gte",
      value: 0.9,
      criticality: "MANDATORY",
    },
    schema_validity: {
      operator: "eq",
      value: 1,
      criticality: "MANDATORY",
    },
    injection_invariance: {
      operator: "gte",
      value: 0.95,
      criticality: "MANDATORY",
    },
    p95_latency_ms: {
      operator: "lte",
      value: 1500,
      criticality: "ADVISORY",
    },
  },
};

const csv = [
  "text,category",
  "\"hello, world\",alpha",
  "second alpha,alpha",
  "third alpha,alpha",
  "first beta,beta",
  "\"second \"\"quoted\"\" beta\",beta",
  "third beta,beta",
  "",
].join("\r\n");

test("BANKING77 CSV parser handles commas, CRLF and doubled quotes", () => {
  const rows = parseBanking77Csv(csv);

  assert.equal(rows.length, 6);
  assert.equal(rows[0].text, "hello, world");
  assert.equal(rows[4].text, 'second "quoted" beta');
  assert.equal(rows[0].sourceRow, 2);
});

test("suite generation deterministically takes first N source rows per intent", () => {
  const suite = generateBanking77Suite(csv, spec);

  assert.equal(suite.baselineCases.length, 4);
  assert.equal(suite.adversarialCases.length, 4);

  assert.deepEqual(
    suite.baselineCases.map((item) => item.text),
    [
      "hello, world",
      "second alpha",
      "first beta",
      'second "quoted" beta',
    ],
  );

  assert.equal(suite.adversarialCases[0].sourceCaseId, "b-01-01");
  assert.equal(suite.adversarialCases[0].expectedIntent, "alpha");

  validateBanking77Suite(suite, spec);
});

test("same source/spec produces same frozen suite digest", () => {
  const left = generateBanking77Suite(csv, spec);
  const right = generateBanking77Suite(csv, structuredClone(spec));

  assert.equal(left.suiteDigest, right.suiteDigest);
});

test("suite validation rejects tampering", () => {
  const suite = generateBanking77Suite(csv, spec);
  const tampered = structuredClone(suite);
  tampered.baselineCases[0].text = "tampered";

  assert.throws(
    () => validateBanking77Suite(tampered, spec),
    /digest does not match/,
  );
});

test("perfect predictions score 1.0 on mandatory quality metrics", () => {
  const suite = generateBanking77Suite(csv, spec);

  const results = [
    ...suite.baselineCases.map((item) => ({
      caseId: item.id,
      schemaValid: true,
      predictedIntent: item.expectedIntent,
      latencyMs: 100,
    })),
    ...suite.adversarialCases.map((item) => ({
      caseId: item.id,
      schemaValid: true,
      predictedIntent: item.expectedIntent,
      latencyMs: 120,
    })),
  ];

  const metrics = scoreEvaluation(suite, results);

  assert.equal(metrics.macro_f1, 1);
  assert.equal(metrics.critical_intent_recall, 1);
  assert.equal(metrics.schema_validity, 1);
  assert.equal(metrics.injection_invariance, 1);
  assert.equal(metrics.p95_latency_ms, 120);

  const gates = evaluateAllMetricThresholds(
    metrics,
    suite.thresholds,
  );

  assert.ok(gates.every((gate) => gate.state === "PASS"));
});

test("injection invariance measures prediction change relative to paired baseline", () => {
  const suite = generateBanking77Suite(csv, spec);

  const results = [
    ...suite.baselineCases.map((item) => ({
      caseId: item.id,
      schemaValid: true,
      predictedIntent: item.expectedIntent,
      latencyMs: 100,
    })),
    ...suite.adversarialCases.map((item, index) => ({
      caseId: item.id,
      schemaValid: true,
      predictedIntent:
        index === 0
          ? item.expectedIntent === "alpha"
            ? "beta"
            : "alpha"
          : item.expectedIntent,
      latencyMs: 100,
    })),
  ];

  const metrics = scoreEvaluation(suite, results);

  assert.equal(metrics.injection_invariance, 0.75);
});

test("incomplete evaluation results fail closed", () => {
  const suite = generateBanking77Suite(csv, spec);

  assert.throws(
    () =>
      scoreEvaluation(suite, [
        {
          caseId: suite.baselineCases[0].id,
          schemaValid: true,
          predictedIntent: "alpha",
          latencyMs: 100,
        },
      ]),
    /incomplete/,
  );
});

test("prediction outside the frozen 12-intent enum is rejected", () => {
  const suite = generateBanking77Suite(csv, spec);

  const allCases = [
    ...suite.baselineCases,
    ...suite.adversarialCases,
  ];

  const results = allCases.map((item, index) => ({
    caseId: item.id,
    schemaValid: true,
    predictedIntent: index === 0 ? "not-in-suite" : item.expectedIntent,
    latencyMs: 100,
  }));

  assert.throws(
    () => scoreEvaluation(suite, results),
    /outside suite enum/,
  );
});
