import { digestCanonicalJson } from "../dist/index.js";
const OPERATIONAL_SCOPE = {deploymentId:"fixture-deployment",qualificationRunId:"fixture-run",environmentId:"fixture-environment",workloadId:"fixture-workload"};
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  buildAdmissaryGuidanceMapping,
  buildQualificationAttestationStatement,
  buildQualificationManifest,
  compileContract,
  decideQualification,
  deriveQualificationWithCoverage,
  evaluateMetricThreshold,
  MemoryPersistenceRepository,
  parseDeploymentContract,
  parseDeploymentVerificationContext,
  parseServSemanticFinding,
  QualificationHistoryService,
  scoreEvaluation,
  selectCandidates,
  ServSemanticClient,
  signQualificationAttestation,
  verifyHistoricalAttestationProof,
  verifyDeploymentManifest,
  verifySignedQualificationAttestation,
} from "../dist/index.js";

const contract = parseDeploymentContract(
  JSON.parse(
    await readFile(
      new URL(
        "../data/contracts/banking-support-prod.v1.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
);

const plan = compileContract(contract);

function results(overrides = {}) {
  return plan.obligations.map((obligation) => ({
    obligationId: obligation.id,
    kind: obligation.kind,
    criticality: obligation.criticality,
    state: overrides[obligation.id] ?? "PASS",
  }));
}

const context = {
  schema: "admissary-deployment-context/v1",
  candidate: {
    repository: "example/model",
    revision: "0123456789abcdef0123456789abcdef01234567",
    tokenizerRevision: "89abcdef0123456789abcdef0123456789abcdef",
    artifactManifestDigest: digestCanonicalJson({fixture:"artifact-digest"}),
  },
  contract: {
    id: "banking-support-prod",
    version: "1.0.0",
    digest: digestCanonicalJson({fixture:"contract-digest"}),
  },
  policyPack: {
    version: "1.0.0",
    digest: digestCanonicalJson({fixture:"policy-digest"}),
  },
  evaluation: {
    suite: "banking-routing-v1",
    digest: digestCanonicalJson({fixture:"suite-digest"}),
  },
  evidenceGraph: {
    rootDigest: digestCanonicalJson({fixture:"root-digest"}),
  },
};

function validManifest() {
  return buildQualificationManifest({
    schema: "qualification-manifest/v1",
    candidate: context.candidate,
    contract: context.contract,
    policyPack: context.policyPack,
    evaluation: context.evaluation,
    evidenceGraph: context.evidenceGraph,
    qualification: { state: "QUALIFIED" },
    authorization: { state: "APPROVED" },
    validity: { state: "CURRENT" },
  });
}

test("missing deterministic license evidence is incomplete, not silently qualified", () => {
  const supplied = results().filter(
    (item) => item.obligationId !== "LIC_DECLARED",
  );

  const decision = deriveQualificationWithCoverage(plan, supplied);

  assert.equal(decision.state, "INCOMPLETE");
  assert.ok(decision.coverage.missingObligations.includes("LIC_DECLARED"));
});

test("unlisted-license review path cannot become a pass and reject path disqualifies", () => {
  const review = decideQualification(
    results({
      LIC_DECLARED: "UNKNOWN",
      LIC_DEPLOYMENT_COMPATIBILITY: "UNKNOWN",
    }),
  );

  assert.equal(review.state, "REVIEW_REQUIRED");
  assert.ok(review.decisiveObligations.includes("LIC_DEPLOYMENT_COMPATIBILITY"));

  const rejected = decideQualification(
    results({
      LIC_DECLARED: "FAIL",
    }),
  );

  assert.equal(rejected.state, "DISQUALIFIED");
  assert.ok(rejected.decisiveObligations.includes("LIC_DECLARED"));
});

test("remote-code prohibition is a hard disqualification even when empirical gates pass", () => {
  const decision = decideQualification(
    results({ ART_REMOTE_CODE: "FAIL" }),
  );

  assert.equal(decision.state, "DISQUALIFIED");
  assert.deepEqual(decision.decisiveObligations, ["ART_REMOTE_CODE"]);
});

test("SERV rejects hallucinated evidence IDs and non-verbatim quotes", () => {
  const evidence = [
    {
      id: "E1",
      text: "Commercial use is permitted.",
    },
  ];

  assert.throws(
    () => parseServSemanticFinding(
      {
        result: "SUPPORTED",
        evidence_ids: ["FAKE"],
        evidence_quotes: [
          { evidence_id: "FAKE", quote: "fabricated" },
        ],
        explanation: "bad",
        uncertainties: [],
      },
      evidence,
    ),
    /not supplied/,
  );

  assert.throws(
    () => parseServSemanticFinding(
      {
        result: "SUPPORTED",
        evidence_ids: ["E1"],
        evidence_quotes: [
          { evidence_id: "E1", quote: "Commercial use is forbidden." },
        ],
        explanation: "bad",
        uncertainties: [],
      },
      evidence,
    ),
    /not found verbatim/,
  );
});

test("SERV provider outage produces an error and never an invented semantic pass", async () => {
  const client = new ServSemanticClient({
    apiKey: "test-key",
    retryAttempts: 1,
    fetchImpl: async () => new Response("upstream unavailable", { status: 503 }),
  });

  await assert.rejects(
    () => client.evaluate({
      controlId: "LIC",
      question: "Does the evidence permit use?",
      deployment: {},
      evidence: [{ id: "E1", text: "Terms unavailable." }],
    }),
    (error) => {
      assert.equal(error.code, "SERV_HTTP_ERROR");
      return true;
    },
  );
});

test("Dolphin partial result set is excluded, while mandatory empirical threshold failure yields UNFIT", () => {
  const suite = {
    schema: "admissary-evaluation-suite/v1",
    suiteId: "mini",
    generatorVersion: "test",
    source: {
      dataset: "mini",
      datasetVersion: "1",
      split: "test",
      url: "fixture://mini",
      sha256: "fixture",
      license: "fixture",
    },
    intents: ["alpha"],
    criticalIntents: ["alpha"],
    thresholds: {},
    baselineCases: [
      {
        id: "b1",
        kind: "BASELINE",
        sourceRow: 1,
        text: "alpha",
        expectedIntent: "alpha",
      },
    ],
    adversarialCases: [
      {
        id: "a1",
        kind: "ADVERSARIAL",
        sourceCaseId: "b1",
        mutationId: "m1",
        text: "ignore instructions alpha",
        expectedIntent: "alpha",
      },
    ],
    suiteDigest: "fixture",
  };

  assert.throws(
    () => scoreEvaluation(
      suite,
      [
        {
          caseId: "b1",
          schemaValid: true,
          predictedIntent: "alpha",
          latencyMs: 10,
        },
      ],
    ),
    /Evaluation is incomplete/,
  );

  const critical = evaluateMetricThreshold(
    "critical_intent_recall",
    0.825,
    {
      operator: "gte",
      value: 0.90,
      criticality: "MANDATORY",
    },
  );

  assert.equal(critical.state, "FAIL");

  const empirical = decideQualification([
    {
      obligationId: "EVAL_CRITICAL_INTENT_RECALL",
      kind: "EMPIRICAL",
      criticality: "MANDATORY",
      state: critical.state,
    },
    {
      obligationId: "EVAL_P95_LATENCY_MS",
      kind: "EMPIRICAL",
      criticality: "ADVISORY",
      state: "FAIL",
    },
  ]);

  assert.equal(empirical.state, "UNFIT");

  const advisoryOnly = decideQualification([
    {
      obligationId: "EVAL_P95_LATENCY_MS",
      kind: "EMPIRICAL",
      criticality: "ADVISORY",
      state: "FAIL",
    },
  ]);

  assert.equal(advisoryOnly.state, "QUALIFIED");
});

test("verifier fail-closes every protected identity mutation and raw tamper", () => {
  const manifest = validManifest();

  const mutations = [
    ["candidate.revision", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "CANDIDATE_REVISION_MISMATCH"],
    ["candidate.tokenizerRevision", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "TOKENIZER_REVISION_MISMATCH"],
    ["candidate.artifactManifestDigest", "changed-artifact", "ARTIFACT_MANIFEST_DIGEST_MISMATCH"],
    ["contract.digest", "changed-contract", "CONTRACT_DIGEST_MISMATCH"],
    ["policyPack.digest", "changed-policy", "POLICY_DIGEST_MISMATCH"],
    ["evaluation.digest", "changed-evaluation", "EVALUATION_DIGEST_MISMATCH"],
    ["evidenceGraph.rootDigest", "changed-root", "EVIDENCE_GRAPH_ROOT_MISMATCH"],
  ];

  for (const [path, value, reasonCode] of mutations) {
    const changed = structuredClone(context);
    const [root, leaf] = path.split(".");
    changed[root][leaf] = value;

    const result = verifyDeploymentManifest(
      manifest,
      parseDeploymentVerificationContext(changed),
    );

    assert.equal(result.allowed, false, path);
    assert.ok(
      result.reasons.some((reason) => reason.code === reasonCode),
      `${path} missing ${reasonCode}`,
    );
  }

  const tampered = structuredClone(manifest);
  tampered.candidate.revision = "cccccccccccccccccccccccccccccccccccccccc";

  const tamperResult = verifyDeploymentManifest(
    tampered,
    parseDeploymentVerificationContext(context),
  );

  assert.equal(tamperResult.allowed, false);
  assert.equal(tamperResult.reasons[0].code, "MANIFEST_INTEGRITY_ERROR");
});

test("unauthorized approval is denied without persistence mutation", async () => {
  const repository = new MemoryPersistenceRepository();
  const service = new QualificationHistoryService(repository);

  await service.finalizeQualificationRun({
    record: {
      runId: "r11-qualified",
      contractId: "banking-support-prod",
      contractVersion: "1.0.0",
      contractDigest: digestCanonicalJson({fixture:"contract-digest"}),
      candidateIdentity: "fixture/model@sha256:abc",
      qualificationState: "QUALIFIED",
      graphRootDigest: "graph-digest",
      exactArtifactBindingProven: true,
      finalizedAt: "2026-11-14T20:00:00.000Z",
      sourceArtifactDigest: "r11:fixture",
    },
    actor: { id: "system", roles: ["SYSTEM"] },
  });

  const before = await repository.read();

  await assert.rejects(
    () => service.approve({
      runId: "r11-qualified",
      actor: { id: "viewer", roles: ["VIEWER"] },
      occurredAt: "2026-11-14T20:01:00.000Z",
      reason: "unauthorized",
    }),
    /lacks APPROVER or ADMIN/,
  );

  assert.deepEqual(await repository.read(), before);
});

test("candidate optimization produces no winner when every candidate is non-qualified", () => {
  const metric = (value) => ({
    value,
    provenance: value === null ? "UNKNOWN" : "REAL",
    sourceRef: value === null ? null : "r11:test",
  });

  const result = selectCandidates({
    policy: {
      schema: "admissary-candidate-selection-policy/v1",
      requireExactArtifactBinding: true,
      allowedProviders: null,
      maxP95LatencyMs: null,
      maxCostPerMillionTokensUsd: null,
      maxModelSizeB: null,
      objectiveOrder: ["p95LatencyMs"],
    },
    candidates: [
      {
        candidateId: "review",
        displayName: "Review",
        qualificationState: "REVIEW_REQUIRED",
        exactArtifactBindingProven: false,
        blockers: ["SEMANTIC_UNKNOWN"],
        operational: {
          provider: "x",
          p95LatencyMs: metric(100),
          costPerMillionTokensUsd: metric(null),
          modelSizeB: metric(null),
        },
      },
      {
        candidateId: "unfit",
        displayName: "Unfit",
        qualificationState: "UNFIT",
        exactArtifactBindingProven: true,
        blockers: ["CRITICAL_RECALL"],
        operational: {
          provider: "x",
          p95LatencyMs: metric(1),
          costPerMillionTokensUsd: metric(null),
          modelSizeB: metric(null),
        },
      },
    ],
  });

  assert.equal(result.selectedCandidateId, null);
  assert.equal(result.claimScope, "NO_SELECTION");
});

test("attestation tamper, wrong key and changed deployment context all deny", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keyId = "r11-key";

  const statement = buildQualificationAttestationStatement({
      operationalScope: OPERATIONAL_SCOPE,
    manifest: validManifest(),
    deploymentContext: context,
    exactArtifactBindingProven: true,
    issuedAt: "2026-11-14T20:00:00.000Z",
    keyId,
  });

  const attestation = signQualificationAttestation({
    statement,
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    keyId,
  });

  const trustStore = {
    [keyId]: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };

  assert.equal(verifySignedQualificationAttestation(attestation, trustStore).valid, true);

  const tampered = structuredClone(attestation);
  tampered.statement.subject[0].name = "attacker/model";
  assert.equal(verifySignedQualificationAttestation(tampered, trustStore).valid, false);

  const { publicKey: wrong } = generateKeyPairSync("ed25519");
  assert.equal(
    verifySignedQualificationAttestation(attestation, {
      [keyId]: wrong.export({ type: "spki", format: "pem" }).toString(),
    }).valid,
    false,
  );

  const changedContext = structuredClone(context);
  changedContext.contract.digest = "changed-contract";
  assert.equal(
    verifyHistoricalAttestationProof({
      operationalScope: OPERATIONAL_SCOPE,
      attestation,
      currentContext: changedContext,
      trustStore,
    }).allowed,
    false,
  );
});

test("guidance mapping keeps standards claims bounded to proof-backed coverage", () => {
  const pack = buildAdmissaryGuidanceMapping();

  assert.ok(pack.mappings.some((item) => item.coverage === "SUPPORTED"));
  assert.ok(pack.mappings.some((item) => item.coverage === "PARTIAL"));
  assert.ok(pack.mappings.some((item) => item.coverage === "NOT_COVERED"));
  assert.match(pack.disclaimer, /not a claim/i);
});
