const OPERATIONAL_SCOPE = {deploymentId:"fixture-deployment",qualificationRunId:"fixture-run",environmentId:"fixture-environment",workloadId:"fixture-workload"};
import { readProof } from "./artifact-integrity.mjs";
import { readFile, writeFile } from "node:fs/promises";
import { generateKeyPairSync } from "node:crypto";

import {
  buildAdmissaryGuidanceMapping,
  buildQualificationAttestationStatement,
  buildQualificationManifest,
  compileContract,
  decideQualification,
  deriveQualificationWithCoverage,
  digestCanonicalJson,
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

const checks = [];

function pass(id, detail = null) {
  checks.push({ id, state: "PASS", detail });
}

function assert(condition, id, detail = "assertion failed") {
  if (!condition) {
    checks.push({ id, state: "FAIL", detail });
    throw new Error(`${id}: ${detail}`);
  }
  pass(id, detail);
}

async function assertRejects(action, predicate, id) {
  try {
    await action();
  } catch (error) {
    if (predicate(error)) {
      pass(id, error instanceof Error ? error.message : String(error));
      return;
    }
    checks.push({ id, state: "FAIL", detail: String(error) });
    throw error;
  }
  checks.push({ id, state: "FAIL", detail: "operation unexpectedly succeeded" });
  throw new Error(`${id}: operation unexpectedly succeeded`);
}

await readProof("results/ADMISSARY_R10C3_CONTINUOUS_ASSURANCE_PROOF.json", "proofDigest", "admissary-r10c3-continuous-assurance-proof/v1");
await readProof("results/ADMISSARY_R10C4_DECISION_WORKSPACE_PROOF.json", "proofDigest", "admissary-r10c4-decision-workspace-proof/v1");
await readProof("results/ADMISSARY_R10C5_PRODUCT_API_PROOF.json", "proofDigest", "admissary-r10c5-product-api-proof/v1");
await readProof("results/ADMISSARY_R10D_SCENARIO_PROOF.json", "portfolioDigest", "admissary-canonical-case-portfolio/v1");
await readProof("results/ADMISSARY_R10D_CASE_D_AUDIT_PROOF.json", "auditDigest", "admissary-product-deployment-audit/v1");
const contract = parseDeploymentContract(
  JSON.parse(
    await readFile("data/contracts/banking-support-prod.v1.json", "utf8"),
  ),
);
const plan = compileContract(contract);

function allResults(overrides = {}) {
  return plan.obligations.map((obligation) => ({
    obligationId: obligation.id,
    kind: obligation.kind,
    criticality: obligation.criticality,
    state: overrides[obligation.id] ?? "PASS",
  }));
}

// ------------------------------------------------------------------
// Evidence + qualification attacks.
// ------------------------------------------------------------------
for (const invalidState of [null, false, 0, "BOGUS"]) {
  const supplied = plan.obligations.map(o => ({ obligationId: o.id, kind: o.kind, criticality: o.criticality, state: invalidState }));
  let rejected = false;
  try { deriveQualificationWithCoverage(plan, supplied); } catch { rejected = true; }
  assert(rejected, `INVALID_EVIDENCE_STATE_${String(invalidState)}_DENY`);
}

const missingLicense = deriveQualificationWithCoverage(
  plan,
  allResults().filter((item) => item.obligationId !== "LIC_DECLARED"),
);
assert(
  missingLicense.state === "INCOMPLETE" &&
    missingLicense.coverage.missingObligations.includes("LIC_DECLARED"),
  "MISSING_LICENSE_INCOMPLETE",
  `state=${missingLicense.state}`,
);

const unlistedReview = decideQualification(
  allResults({
    LIC_DECLARED: "UNKNOWN",
    LIC_DEPLOYMENT_COMPATIBILITY: "UNKNOWN",
  }),
);
assert(
  unlistedReview.state === "REVIEW_REQUIRED" &&
    unlistedReview.decisiveObligations.includes("LIC_DEPLOYMENT_COMPATIBILITY"),
  "UNLISTED_LICENSE_REVIEW",
  `state=${unlistedReview.state}`,
);

const unlistedReject = decideQualification(
  allResults({ LIC_DECLARED: "FAIL" }),
);
assert(
  unlistedReject.state === "DISQUALIFIED" &&
    unlistedReject.decisiveObligations.includes("LIC_DECLARED"),
  "UNLISTED_LICENSE_REJECT",
  `state=${unlistedReject.state}`,
);

const remoteCode = decideQualification(
  allResults({ ART_REMOTE_CODE: "FAIL" }),
);
assert(
  remoteCode.state === "DISQUALIFIED" &&
    remoteCode.decisiveObligations.length === 1 &&
    remoteCode.decisiveObligations[0] === "ART_REMOTE_CODE",
  "REMOTE_CODE_PROHIBITED",
  `state=${remoteCode.state}`,
);

const semanticContradicted = decideQualification(
  allResults({ LIC_DEPLOYMENT_COMPATIBILITY: "FAIL" }),
);
assert(
  semanticContradicted.state === "DISQUALIFIED",
  "SEMANTIC_CONTRADICTED_DISQUALIFIES",
  `state=${semanticContradicted.state}`,
);

const semanticUnresolved = decideQualification(
  allResults({ LIC_DEPLOYMENT_COMPATIBILITY: "UNKNOWN" }),
);
assert(
  semanticUnresolved.state === "REVIEW_REQUIRED",
  "SEMANTIC_UNRESOLVED_REVIEW",
  `state=${semanticUnresolved.state}`,
);

const servEvidence = [
  { id: "E1", text: "Commercial use is permitted for customer-facing applications." },
];

try {
  parseServSemanticFinding(
    {
      result: "SUPPORTED",
      evidence_ids: ["FAKE"],
      evidence_quotes: [{ evidence_id: "FAKE", quote: "fabricated" }],
      explanation: "fabricated",
      uncertainties: [],
    },
    servEvidence,
  );
  throw new Error("hallucinated evidence ID accepted");
} catch (error) {
  assert(
    error?.code === "SERV_EVIDENCE_REFERENCE_ERROR" || /not supplied/.test(String(error)),
    "SERV_HALLUCINATED_EVIDENCE_ID",
    error instanceof Error ? error.message : String(error),
  );
}

try {
  parseServSemanticFinding(
    {
      result: "SUPPORTED",
      evidence_ids: ["E1"],
      evidence_quotes: [{ evidence_id: "E1", quote: "Commercial use is forbidden." }],
      explanation: "fabricated quote",
      uncertainties: [],
    },
    servEvidence,
  );
  throw new Error("non-verbatim evidence quote accepted");
} catch (error) {
  assert(
    error?.code === "SERV_EVIDENCE_REFERENCE_ERROR" || /not found verbatim/.test(String(error)),
    "SERV_INVALID_QUOTE",
    error instanceof Error ? error.message : String(error),
  );
}

const outageClient = new ServSemanticClient({
  apiKey: "r11-test",
  retryAttempts: 1,
  fetchImpl: async () => new Response("unavailable", { status: 503 }),
});
await assertRejects(
  () => outageClient.evaluate({
    controlId: "LIC",
    question: "Does evidence permit use?",
    deployment: {},
    evidence: [{ id: "E1", text: "Terms unavailable." }],
  }),
  (error) => error?.code === "SERV_HTTP_ERROR",
  "SERV_PROVIDER_OUTAGE_NO_PASS",
);

const miniSuite = {
  schema: "admissary-evaluation-suite/v1",
  suiteId: "r11-mini",
  generatorVersion: "r11",
  source: {
    dataset: "mini",
    datasetVersion: "1",
    split: "test",
    url: "fixture://r11-mini",
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

try {
  scoreEvaluation(
    miniSuite,
    [
      {
        caseId: "b1",
        schemaValid: true,
        predictedIntent: "alpha",
        latencyMs: 10,
      },
    ],
  );
  throw new Error("partial Dolphin result set was scored");
} catch (error) {
  assert(
    /Evaluation is incomplete/.test(String(error)),
    "DOLPHIN_PARTIAL_RUN_EXCLUDED",
    error instanceof Error ? error.message : String(error),
  );
}

const criticalGate = evaluateMetricThreshold(
  "critical_intent_recall",
  0.825,
  { operator: "gte", value: 0.90, criticality: "MANDATORY" },
);
assert(
  criticalGate.state === "FAIL",
  "DOLPHIN_CRITICAL_THRESHOLD_FAIL",
  `observed=${criticalGate.observed}; threshold=${criticalGate.threshold.value}`,
);

const empiricalUnfit = decideQualification([
  {
    obligationId: "EVAL_CRITICAL_INTENT_RECALL",
    kind: "EMPIRICAL",
    criticality: "MANDATORY",
    state: criticalGate.state,
  },
  {
    obligationId: "EVAL_P95_LATENCY_MS",
    kind: "EMPIRICAL",
    criticality: "ADVISORY",
    state: "FAIL",
  },
]);
assert(
  empiricalUnfit.state === "UNFIT",
  "DOLPHIN_MANDATORY_FAIL_UNFIT",
  `state=${empiricalUnfit.state}`,
);

const advisoryOnly = decideQualification([
  {
    obligationId: "EVAL_P95_LATENCY_MS",
    kind: "EMPIRICAL",
    criticality: "ADVISORY",
    state: "FAIL",
  },
]);
assert(
  advisoryOnly.state === "QUALIFIED",
  "ADVISORY_FAILURE_NO_BLOCK",
  `state=${advisoryOnly.state}`,
);

// ------------------------------------------------------------------
// Deploy-time identity + integrity attacks against the real verifier.
// ------------------------------------------------------------------
const seedManifest = JSON.parse(
  await readFile("deploy/seed/verifier-manifest.json", "utf8"),
);
const seedContext = JSON.parse(
  await readFile("deploy/seed/deployment-context.json", "utf8"),
);

const validVerifier = verifyDeploymentManifest(
  seedManifest,
  parseDeploymentVerificationContext(seedContext),
);
assert(validVerifier.allowed === true, "VERIFIER_BASELINE_ALLOW");

const verifierMutations = [
  ["candidate", "revision", "r11-changed-revision", "CANDIDATE_REVISION_MISMATCH"],
  ["candidate", "tokenizerRevision", "r11-changed-tokenizer", "TOKENIZER_REVISION_MISMATCH"],
  ["candidate", "artifactManifestDigest", "r11-changed-artifact", "ARTIFACT_MANIFEST_DIGEST_MISMATCH"],
  ["contract", "digest", "r11-changed-contract", "CONTRACT_DIGEST_MISMATCH"],
  ["policyPack", "digest", "r11-changed-policy", "POLICY_DIGEST_MISMATCH"],
  ["evaluation", "digest", "r11-changed-evaluation", "EVALUATION_DIGEST_MISMATCH"],
  ["evidenceGraph", "rootDigest", "r11-changed-graph", "EVIDENCE_GRAPH_ROOT_MISMATCH"],
];

for (const [group, field, value, code] of verifierMutations) {
  const changed = structuredClone(seedContext);
  changed[group][field] = value;
  const result = verifyDeploymentManifest(
    seedManifest,
    parseDeploymentVerificationContext(changed),
  );
  assert(
    result.allowed === false && result.reasons.some((reason) => reason.code === code),
    `VERIFIER_${code}`,
    result.reasons.map((reason) => reason.code).join(","),
  );
}

const rawTamper = structuredClone(seedManifest);
rawTamper.candidate.revision = "r11-raw-tamper";
const tamperResult = verifyDeploymentManifest(
  rawTamper,
  parseDeploymentVerificationContext(seedContext),
);
assert(
  tamperResult.allowed === false && tamperResult.reasons[0]?.code === "MANIFEST_INTEGRITY_ERROR",
  "MANIFEST_RAW_TAMPER",
  tamperResult.reasons.map((reason) => reason.code).join(","),
);

for (const [label, patch, expected] of [
  ["STALE", { validity: { state: "STALE" } }, "VALIDITY_NOT_CURRENT"],
  ["UNAPPROVED", { authorization: { state: "PENDING" } }, "AUTHORIZATION_NOT_APPROVED"],
  ["NONQUALIFIED", { qualification: { state: "REVIEW_REQUIRED" } }, "QUALIFICATION_NOT_QUALIFIED"],
]) {
  const { manifestDigest: _old, ...payload } = seedManifest;
  const mutated = buildQualificationManifest({ ...payload, ...patch });
  const result = verifyDeploymentManifest(
    mutated,
    parseDeploymentVerificationContext(seedContext),
  );
  assert(
    result.allowed === false && result.reasons.some((reason) => reason.code === expected),
    `VERIFIER_${label}`,
    result.reasons.map((reason) => reason.code).join(","),
  );
}

// ------------------------------------------------------------------
// Authorization + selection attacks.
// ------------------------------------------------------------------
const authRepository = new MemoryPersistenceRepository();
const authService = new QualificationHistoryService(authRepository);
await authService.finalizeQualificationRun({
  record: {
    runId: "r11-qualified",
    contractId: "banking-support-prod",
    contractVersion: "1.0.0",
    contractDigest: "r11-contract",
    candidateIdentity: "r11/model@sha256:abc",
    qualificationState: "QUALIFIED",
    graphRootDigest: "r11-graph",
    exactArtifactBindingProven: true,
    finalizedAt: "2026-11-14T20:50:00.000Z",
    sourceArtifactDigest: "r11:fixture",
  },
  actor: { id: "r11-system", roles: ["SYSTEM"] },
});
const authBefore = await authRepository.read();
await assertRejects(
  () => authService.approve({
    runId: "r11-qualified",
    actor: { id: "r11-viewer", roles: ["VIEWER"] },
    occurredAt: "2026-11-14T20:51:00.000Z",
    reason: "hostile unauthorized approval",
  }),
  (error) => error?.code === "AUTH_FORBIDDEN",
  "UNAUTHORIZED_APPROVAL_DENIED",
);
assert(
  JSON.stringify(await authRepository.read()) === JSON.stringify(authBefore),
  "UNAUTHORIZED_APPROVAL_NO_MUTATION",
);

const metric = (value) => ({
  value,
  provenance: value === null ? "UNKNOWN" : "REAL",
  sourceRef: value === null ? null : "r11",
});
const noWinner = selectCandidates({
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
      displayName: "review",
      qualificationState: "REVIEW_REQUIRED",
      exactArtifactBindingProven: false,
      blockers: ["SEMANTIC_UNKNOWN"],
      operational: {
        provider: "fixture",
        p95LatencyMs: metric(1),
        costPerMillionTokensUsd: metric(null),
        modelSizeB: metric(null),
      },
    },
    {
      candidateId: "unfit",
      displayName: "unfit",
      qualificationState: "UNFIT",
      exactArtifactBindingProven: true,
      blockers: ["CRITICAL_RECALL"],
      operational: {
        provider: "fixture",
        p95LatencyMs: metric(0.1),
        costPerMillionTokensUsd: metric(null),
        modelSizeB: metric(null),
      },
    },
  ],
});
assert(
  noWinner.selectedCandidateId === null && noWinner.claimScope === "NO_SELECTION",
  "NO_QUALIFIED_CANDIDATE_NO_SELECTION",
);

// ------------------------------------------------------------------
// Signed-attestation attacks.
// ------------------------------------------------------------------
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const keyId = "r11-attestation-key";
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const statement = buildQualificationAttestationStatement({
      operationalScope: OPERATIONAL_SCOPE,
  manifest: seedManifest,
  deploymentContext: seedContext,
  exactArtifactBindingProven: true,
  issuedAt: "2026-11-14T20:52:00.000Z",
  keyId,
});
const signed = signQualificationAttestation({ statement, privateKeyPem, keyId });
const trustStore = { [keyId]: publicKeyPem };
assert(
  verifySignedQualificationAttestation(signed, trustStore).valid === true,
  "ATTESTATION_BASELINE_VALID",
);

const tamperedAttestation = structuredClone(signed);
tamperedAttestation.statement.subject[0].name = "attacker/model";
assert(
  verifySignedQualificationAttestation(tamperedAttestation, trustStore).valid === false,
  "ATTESTATION_PAYLOAD_TAMPER_DENY",
);

const { publicKey: wrongPublicKey } = generateKeyPairSync("ed25519");
assert(
  verifySignedQualificationAttestation(signed, {
    [keyId]: wrongPublicKey.export({ type: "spki", format: "pem" }).toString(),
  }).valid === false,
  "ATTESTATION_WRONG_KEY_DENY",
);

const changedAttestationContext = structuredClone(seedContext);
changedAttestationContext.candidate.revision = "r11-attestation-context-change";
assert(
  verifyHistoricalAttestationProof({
      operationalScope: OPERATIONAL_SCOPE,
    attestation: signed,
    currentContext: changedAttestationContext,
    trustStore,
  }).allowed === false,
  "ATTESTATION_CHANGED_SUBJECT_CONTEXT_DENY",
);

// ------------------------------------------------------------------
// Bind adversarial acceptance back to the real/canonical Windows proofs.
// ------------------------------------------------------------------
const judge = JSON.parse(await readFile("web/demo-snapshot.json", "utf8"));
assert(
  judge.candidate?.model === "deepseek-ai/DeepSeek-V4.1-Flash" &&
    judge.candidate?.empiricalFitness === "UNFIT" &&
    judge.candidate?.overallQualification === "REVIEW_REQUIRED" &&
    judge.candidate?.deployAllowed === false,
  "REAL_DEEPSEEK_TRUTH_PRESERVED",
);

const criticalMetric = judge.metrics?.find((metric) => metric.id === "critical_intent_recall");
const schemaMetric = judge.metrics?.find((metric) => metric.id === "schema_validity");
assert(
  criticalMetric?.state === "FAIL" &&
    criticalMetric?.criticality === "MANDATORY" &&
    schemaMetric?.state === "FAIL" &&
    schemaMetric?.criticality === "MANDATORY",
  "REAL_DOLPHIN_THRESHOLDS_VISIBLE",
);

const r10c3 = JSON.parse(
  await readFile("results/ADMISSARY_R10C3_CONTINUOUS_ASSURANCE_PROOF.json", "utf8"),
);
assert(
  r10c3.caseB?.initialAllowed === true &&
    r10c3.caseB?.driftAllowed === false &&
    r10c3.caseB?.preservedHistoricalApprovalState === "APPROVED" &&
    r10c3.caseB?.afterReassessmentBeforeNewApprovalAllowed === false,
  "CANONICAL_APPROVED_TO_DRIFT_DENY",
);
assert(
  r10c3.liveHuggingFace?.currentMainVsExactOutcome === "UNCHANGED" &&
    ["UNCHANGED", "MATERIAL_CHANGE"].includes(r10c3.liveHuggingFace?.historicalToCurrentOutcome),
  "WATCHER_REAL_HF_TRUTH_PRESERVED",
);

const r10c4 = JSON.parse(
  await readFile("results/ADMISSARY_R10C4_DECISION_WORKSPACE_PROOF.json", "utf8"),
);
assert(
  r10c4.selection?.claimScope === "FIXTURE_ONLY" &&
    r10c4.selection?.excluded?.some((item) => item.candidateId === "real-deepseek-v41-flash"),
  "CANDIDATE_SELECTION_PROVENANCE_BOUNDARY",
);

const r10c5 = JSON.parse(
  await readFile("results/ADMISSARY_R10C5_PRODUCT_API_PROOF.json", "utf8"),
);
assert(
  r10c5.realDeepSeekDeployAllowed === false &&
    r10c5.qualificationRequest?.providerCalls === 0 &&
    r10c5.webUsesProductApi === true,
  "PRODUCT_API_TRUTH_AND_WEB_CONSISTENCY",
);

const portfolio = JSON.parse(
  await readFile("results/ADMISSARY_R10D_SCENARIO_PROOF.json", "utf8"),
);
assert(
  portfolio.cases?.length === 4 &&
    portfolio.cases.find((item) => item.id === "CASE_C")?.facts?.fakeWinner === false,
  "CANONICAL_CASES_NO_FAKE_WINNER",
);

const caseD = portfolio.cases.find((item) => item.id === "CASE_D");
assert(
  caseD?.facts?.historicalAttestationCryptographicallyValid === true &&
    caseD?.facts?.currentAuthorityAllowed === false &&
    caseD?.facts?.rollbackTargetId === "deployment-r10d-baseline",
  "HISTORICAL_CRYPTO_CURRENT_AUTHORITY_SPLIT",
);

const audit = JSON.parse(
  await readFile("results/ADMISSARY_R10D_CASE_D_AUDIT_PROOF.json", "utf8"),
);
assert(
  audit.decision?.allowed === false &&
    audit.decision?.lifecycleState === "REVOKED" &&
    audit.rollbackTargets?.some((item) =>
      item.deploymentId === "deployment-r10d-baseline" &&
      item.reason === "QUALIFIED_EXACT_BOUND_APPROVED_CURRENT_ATTESTED_SAME_SCOPE"
    ),
  "SAFE_ROLLBACK_SCOPE_ENFORCED",
);

const guidance = buildAdmissaryGuidanceMapping();
assert(
  guidance.mappings.some((item) => item.coverage === "NOT_COVERED") &&
    /not a claim/i.test(guidance.disclaimer),
  "GUIDANCE_NO_COMPLIANCE_OVERCLAIM",
);

const appJs = await readFile("web/app.js", "utf8");
assert(
  appJs.includes("/v1/product/judge-view") &&
    appJs.includes("/v1/product/verifier-demo") &&
    appJs.includes("/v1/product/scenarios"),
  "WEB_PRODUCT_API_ONLY_FOR_ACTIVE_SURFACES",
);

const failures = checks.filter((item) => item.state !== "PASS");
if (failures.length > 0) {
  throw new Error(`R11 failures: ${JSON.stringify(failures)}`);
}

const proof = {
  schema: "admissary-r11-adversarial-acceptance/v1",
  generatedAt: new Date().toISOString(),
  matrix: {
    total: checks.length,
    passed: checks.length,
    failed: 0,
    checks,
  },
  canonicalTruth: {
    realModel: judge.candidate.model,
    empiricalFitness: judge.candidate.empiricalFitness,
    overallQualification: judge.candidate.overallQualification,
    deployAllowed: judge.candidate.deployAllowed,
    caseBDriftAllowed: r10c3.caseB.driftAllowed,
    caseCClaimScope: r10c4.selection.claimScope,
    caseDCurrentAuthorityAllowed: caseD.facts.currentAuthorityAllowed,
    caseDRollbackTargetId: caseD.facts.rollbackTargetId,
  },
  providerCalls: {
    serv: 0,
    dolphin: 0,
    note: "R11 uses deterministic fixtures and previously captured canonical evidence; the only provider-network regression remains the R10C3 real Hugging Face watcher executed earlier in RUN_WINDOWS.",
  },
};
proof.proofDigest = digestCanonicalJson(proof);

await writeFile(
  "results/ADMISSARY_R11_ADVERSARIAL_ACCEPTANCE_PROOF.json",
  JSON.stringify(proof, null, 2) + "\n",
  "utf8",
);

console.log(`R11_MATRIX_TOTAL=${proof.matrix.total}`);
console.log(`R11_MATRIX_PASS=${proof.matrix.passed}`);
console.log("R11_MATRIX_FAIL=0");
console.log("R11_MISSING_LICENSE=INCOMPLETE");
console.log("R11_UNLISTED_LICENSE_REVIEW=REVIEW_REQUIRED");
console.log("R11_UNLISTED_LICENSE_REJECT=DISQUALIFIED");
console.log("R11_REMOTE_CODE_PROHIBITED=DISQUALIFIED");
console.log("R11_SERV_HALLUCINATED_EVIDENCE_ID=DENY");
console.log("R11_SERV_INVALID_QUOTE=DENY");
console.log("R11_SERV_OUTAGE=ERROR_NO_PASS");
console.log("R11_DOLPHIN_PARTIAL_RUN=EXCLUDED");
console.log("R11_DOLPHIN_MANDATORY_THRESHOLD=UNFIT");
console.log("R11_ADVISORY_LATENCY_ONLY=NON_BLOCKING");
console.log("R11_MANIFEST_TAMPER=DENY");
console.log("R11_MODEL_REVISION_CHANGE=DENY");
console.log("R11_TOKENIZER_CHANGE=DENY");
console.log("R11_ARTIFACT_CHANGE=DENY");
console.log("R11_CONTRACT_CHANGE=DENY");
console.log("R11_POLICY_CHANGE=DENY");
console.log("R11_EVALUATION_CHANGE=DENY");
console.log("R11_EVIDENCE_GRAPH_CHANGE=DENY");
console.log("R11_STALE=DENY");
console.log("R11_UNAPPROVED=DENY");
console.log("R11_NONQUALIFIED=DENY");
console.log("R11_UNAUTHORIZED_APPROVAL=DENY_NO_MUTATION");
console.log("R11_NO_QUALIFIED_CANDIDATE=NO_SELECTION");
console.log("R11_ATTESTATION_TAMPER=DENY");
console.log("R11_ATTESTATION_WRONG_KEY=DENY");
console.log("R11_ATTESTATION_CHANGED_CONTEXT=DENY");
console.log("R11_REAL_DEEPSEEK_TRUTH=PASS");
console.log("R11_CANONICAL_DRIFT_TO_DENY=PASS");
console.log("R11_CASE_C_PROVENANCE_BOUNDARY=PASS");
console.log("R11_HISTORICAL_CRYPTO_CURRENT_AUTHORITY=PASS");
console.log("R11_SAFE_ROLLBACK_SCOPE=PASS");
console.log("R11_PRODUCT_API_WEB_CONSISTENCY=PASS");
console.log("R11_GUIDANCE_NO_OVERCLAIM=PASS");
console.log("R11_SERV_PROVIDER_CALLS=ZERO");
console.log("R11_DOLPHIN_PROVIDER_CALLS=ZERO");
console.log(`R11_PROOF_DIGEST=${proof.proofDigest}`);
console.log("ADMISSARY_R11_ADVERSARIAL_ACCEPTANCE_GATE=PASS");
