import test from "node:test";
import assert from "node:assert/strict";

import {
  buildQualificationManifest,
  canonicalJson,
  compileContract,
  decideQualification,
  digestCanonicalJson,
  evaluateExpr,
  fingerprintNode,
  minimalBlockingSets,
  parseDeploymentContract,
  verifyQualificationManifest,
} from "../dist/index.js";

const contractInput = {
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
      approvedIdentifiers: ["apache-2.0", "mit", "bsd-3-clause"],
      unlistedLicense: {
        action: "review",
      },
    },
    workloadAcceptance: {
      suite: "banking-routing-v1",
      requirements: [
        { metric: "macro_f1", operator: "gte", value: 0.82 },
        { metric: "critical_intent_recall", operator: "gte", value: 0.9 },
        { metric: "schema_validity", operator: "eq", value: 1 },
        { metric: "injection_invariance", operator: "gte", value: 0.95 },
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
};

test("canonical JSON is stable across object key order", () => {
  const a = { z: 1, a: { y: 2, x: 3 } };
  const b = { a: { x: 3, y: 2 }, z: 1 };

  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(digestCanonicalJson(a), digestCanonicalJson(b));
});

test("canonical JSON keeps array order significant", () => {
  assert.notEqual(
    digestCanonicalJson({ values: ["a", "b"] }),
    digestCanonicalJson({ values: ["b", "a"] }),
  );
});

test("canonical JSON rejects undefined rather than silently dropping evidence", () => {
  assert.throws(() => canonicalJson({ a: undefined }), /undefined/);
});

test("contract parser accepts the frozen R4 banking contract", () => {
  const contract = parseDeploymentContract(contractInput);
  assert.equal(contract.metadata.id, "banking-support-prod");
});

test("contract parser rejects duplicate metric names", () => {
  const bad = structuredClone(contractInput);
  bad.spec.workloadAcceptance.requirements.push({
    metric: "macro_f1",
    operator: "gte",
    value: 0.5,
  });

  assert.throws(
    () => parseDeploymentContract(bad),
    /duplicates metric "macro_f1"/,
  );
});

test("compiler emits deterministic, semantic and empirical obligations", () => {
  const contract = parseDeploymentContract(contractInput);
  const plan = compileContract(contract);

  assert.ok(plan.obligations.some((o) => o.kind === "DETERMINISTIC"));
  assert.ok(plan.obligations.some((o) => o.kind === "SEMANTIC"));
  assert.ok(plan.obligations.some((o) => o.kind === "EMPIRICAL"));
  assert.ok(
    plan.obligations.some(
      (o) => o.id === "EVAL_P95_LATENCY_MS" && o.criticality === "ADVISORY",
    ),
  );
});

test("ALL expression fails when one mandatory leaf fails", () => {
  const expr = {
    type: "all",
    children: [
      { type: "control", controlId: "A" },
      { type: "control", controlId: "B" },
    ],
  };

  assert.equal(evaluateExpr(expr, { A: "PASS", B: "FAIL" }), "FAIL");
});

test("ANY expression passes when one alternative passes even if another errored", () => {
  const expr = {
    type: "any",
    children: [
      { type: "control", controlId: "A" },
      { type: "control", controlId: "B" },
    ],
  };

  assert.equal(evaluateExpr(expr, { A: "ERROR", B: "PASS" }), "PASS");
});

test("minimal blocker analysis returns independent blocker and failed alternative path", () => {
  const expr = {
    type: "all",
    children: [
      { type: "control", controlId: "A" },
      { type: "control", controlId: "B" },
      {
        type: "any",
        children: [
          { type: "control", controlId: "C" },
          { type: "control", controlId: "D" },
        ],
      },
    ],
  };

  assert.deepEqual(
    minimalBlockingSets(expr, {
      A: "PASS",
      B: "FAIL",
      C: "FAIL",
      D: "FAIL",
    }),
    [["B"], ["C", "D"]],
  );
});

test("system error has highest qualification precedence", () => {
  const decision = decideQualification([
    {
      obligationId: "STATIC_FAIL",
      kind: "DETERMINISTIC",
      criticality: "MANDATORY",
      state: "FAIL",
    },
    {
      obligationId: "SERV_OUTAGE",
      kind: "SEMANTIC",
      criticality: "MANDATORY",
      state: "ERROR",
    },
  ]);

  assert.equal(decision.state, "ERROR");
  assert.deepEqual(decision.decisiveObligations, ["SERV_OUTAGE"]);
});

test("hard admissibility failure cannot be compensated by excellent empirical results", () => {
  const decision = decideQualification([
    {
      obligationId: "REMOTE_CODE",
      kind: "DETERMINISTIC",
      criticality: "MANDATORY",
      state: "FAIL",
    },
    {
      obligationId: "MACRO_F1",
      kind: "EMPIRICAL",
      criticality: "MANDATORY",
      state: "PASS",
    },
  ]);

  assert.equal(decision.state, "DISQUALIFIED");
});

test("semantic unknown requires human review", () => {
  const decision = decideQualification([
    {
      obligationId: "LICENSE",
      kind: "SEMANTIC",
      criticality: "MANDATORY",
      state: "UNKNOWN",
    },
  ]);

  assert.equal(decision.state, "REVIEW_REQUIRED");
});

test("missing empirical evidence is incomplete, not unfit", () => {
  const decision = decideQualification([
    {
      obligationId: "MACRO_F1",
      kind: "EMPIRICAL",
      criticality: "MANDATORY",
      state: "UNKNOWN",
    },
  ]);

  assert.equal(decision.state, "INCOMPLETE");
});

test("empirical failure produces UNFIT after admissibility passes", () => {
  const decision = decideQualification([
    {
      obligationId: "LICENSE",
      kind: "SEMANTIC",
      criticality: "MANDATORY",
      state: "PASS",
    },
    {
      obligationId: "MACRO_F1",
      kind: "EMPIRICAL",
      criticality: "MANDATORY",
      state: "FAIL",
    },
  ]);

  assert.equal(decision.state, "UNFIT");
});

test("advisory failure cannot block qualification", () => {
  const decision = decideQualification([
    {
      obligationId: "MACRO_F1",
      kind: "EMPIRICAL",
      criticality: "MANDATORY",
      state: "PASS",
    },
    {
      obligationId: "LATENCY",
      kind: "EMPIRICAL",
      criticality: "ADVISORY",
      state: "FAIL",
    },
  ]);

  assert.equal(decision.state, "QUALIFIED");
});

test("node fingerprint ignores caller ordering of digest sets", () => {
  const left = fingerprintNode({
    nodeType: "CONTROL",
    evaluatorVersion: "v1",
    configuration: { threshold: 0.82 },
    inputDigests: ["b", "a"],
    dependencyResultDigests: ["d", "c"],
  });

  const right = fingerprintNode({
    nodeType: "CONTROL",
    evaluatorVersion: "v1",
    configuration: { threshold: 0.82 },
    inputDigests: ["a", "b"],
    dependencyResultDigests: ["c", "d"],
  });

  assert.equal(left, right);
});

test("manifest verifies and tampering is detected", () => {
  const manifest = buildQualificationManifest({
    schema: "qualification-manifest/v1",
    candidate: {
      repository: "Qwen/Qwen3-4B",
      revision: "abc123",
      tokenizerRevision: "tok123",
      artifactManifestDigest: "sha256:artifact",
    },
    contract: {
      id: "banking-support-prod",
      version: "1.0.0",
      digest: "sha256:contract",
    },
    policyPack: {
      version: "1.0.0",
      digest: "sha256:policy",
    },
    evaluation: {
      suite: "banking-routing-v1",
      digest: "sha256:evaluation",
    },
    evidenceGraph: {
      rootDigest: "sha256:evidence",
    },
    qualification: {
      state: "QUALIFIED",
    },
    authorization: {
      state: "PENDING",
    },
    validity: {
      state: "CURRENT",
    },
  });

  assert.equal(verifyQualificationManifest(manifest), true);

  const tampered = structuredClone(manifest);
  tampered.candidate.revision = "def789";

  assert.equal(verifyQualificationManifest(tampered), false);
});
