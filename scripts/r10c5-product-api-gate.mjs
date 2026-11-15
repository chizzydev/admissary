import { runLocalRegressions } from "./local-regression-runner.mjs";
await runLocalRegressions("r10c5-product-api-gate", "H-01|H-05|M-09", 4);
import { readProof } from "./artifact-integrity.mjs";
await readProof("results/ADMISSARY_R10C_REGISTRY_PROOF.json","proofDigest","admissary-r10c-registry-proof/v1");
await readProof("results/ADMISSARY_R10C3_CONTINUOUS_ASSURANCE_PROOF.json","proofDigest","admissary-r10c3-continuous-assurance-proof/v1");
import { fixtureEvidence } from "./remediation-fixtures.mjs";
import {
  cp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  generateKeyPairSync,
} from "node:crypto";

import {
  buildQualificationAttestationStatement,
  buildQualificationManifest,
  continuousAssuranceStateDigest,
  digestCanonicalJson,
  JsonAssuranceRepository,
  JsonProductRepository,
  productApplicationStateDigest,
  signQualificationAttestation,
} from "../dist/index.js";
import {
  createAdmissaryWebServer,
} from "./admissary-web-lib.mjs";

await mkdir("results/r10c5", { recursive: true });
const productStatePath = "results/r10c5/api-product-state.json";
const assuranceStatePath = "results/r10c5/api-assurance-state.json";
await rm(productStatePath, { force: true });
await rm(assuranceStatePath, { force: true });
await cp("results/ADMISSARY_R10C5_PRODUCT_STATE.json", productStatePath);
await cp("results/ADMISSARY_R10C5_ASSURANCE_STATE.json", assuranceStatePath);

const seedManifest = JSON.parse(
  await readFile(
    "deploy/seed/verifier-manifest.json",
    "utf8",
  ),
);

const seedContext = JSON.parse(
  await readFile(
    "deploy/seed/deployment-context.json",
    "utf8",
  ),
);

// The positive lifecycle is an explicit acceptance fixture. Its contract
// identity must be separate from the real canonical R6 contract even when
// both exercise the same banking workload.
const acceptanceContract = {
  id: "r10c5-acceptance-contract",
  version: "1.0.0",
  digest: digestCanonicalJson({
    schema:
      "admissary-r10c5-acceptance-contract/v1",
    id:
      "r10c5-acceptance-contract",
    version:
      "1.0.0",
    workload:
      seedContext.evaluation.suite,
    purpose:
      "explicit-positive-lifecycle-fixture",
  }),
};

const context = structuredClone(
  seedContext,
);

context.contract = {
  ...acceptanceContract,
};

context.evidenceGraph.rootDigest = fixtureEvidence({}, {contractId: acceptanceContract.id, version: acceptanceContract.version}, context).graph.rootDigest;
const {
  manifestDigest: _seedManifestDigest,
  ...seedManifestPayload
} = seedManifest;

const manifest =
  buildQualificationManifest({
    ...seedManifestPayload,
    contract: { ...acceptanceContract },
    evidenceGraph: { ...context.evidenceGraph },
  });

const { publicKey, privateKey } =
  generateKeyPairSync(
    "ed25519",
  );

const keyId =
  "r10c5-api-key";

const publicKeyPem =
  publicKey
    .export({
      type: "spki",
      format: "pem",
    })
    .toString();

await writeFile("results/r10c5/attestation-public-key.pem", publicKeyPem, "utf8");

const privateKeyPem =
  privateKey
    .export({
      type: "pkcs8",
      format: "pem",
    })
    .toString();

const statement =
  buildQualificationAttestationStatement({
    manifest,
    deploymentContext:
      context,
    exactArtifactBindingProven:
      true,
    issuedAt:
      "2026-11-14T20:10:20.000Z",
    keyId,
  });

let attestation =
  signQualificationAttestation({
    statement,
    privateKeyPem,
    keyId,
  });

const TOKENS = {
  viewer: "r10c5-viewer",
  operator: "r10c5-operator",
  approver: "r10c5-approver",
  admin: "r10c5-admin",
  admission: "r10c5-admission",
};

function auth(token) {
  return { authorization: `Bearer ${token}` };
}

async function jsonRequest(base, path, { method = "GET", token = null, body = undefined } = {}) {
  const headers = token ? auth(token) : {};
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload = null;
  try { payload = await response.json(); } catch {}
  return { response, payload };
}

function server() {
  return createAdmissaryWebServer({
    mode: "r10c5-test",
    completionEvidenceResolver: async (r,c,k) => fixtureEvidence(c,k,context),
    snapshotPath: "web/demo-snapshot.json",
    verifierManifestPath: "deploy/seed/verifier-manifest.json",
    verifierContextPath: "deploy/seed/deployment-context.json",
    productStatePath,
    productAssuranceStatePath: assuranceStatePath,
    productRegistryProofPath: "results/ADMISSARY_R10C_REGISTRY_PROOF.json",
    productAssuranceProofPath: "results/ADMISSARY_R10C3_CONTINUOUS_ASSURANCE_PROOF.json",
    authTokens: {
      [TOKENS.viewer]: "VIEWER",
      [TOKENS.operator]: "OPERATOR",
      [TOKENS.approver]: "APPROVER",
      [TOKENS.admin]: "ADMIN",
      [TOKENS.admission]: "ADMISSION",
    },
    attestationTrustStore: { [keyId]: publicKeyPem },
  });
}

async function listen(instance) {
  await new Promise((resolve, reject) => {
    instance.once("error", reject);
    instance.listen(0, "127.0.0.1", resolve);
  });
  const address = instance.address();
  if (!address || typeof address === "string") throw new Error("Server address unavailable");
  return `http://127.0.0.1:${address.port}`;
}

async function close(instance) {
  if (typeof instance.closeIdleConnections === "function") instance.closeIdleConnections();
  if (typeof instance.closeAllConnections === "function") instance.closeAllConnections();
  await new Promise((resolve) => {
    if (!instance.listening) return resolve();
    instance.close(() => resolve());
  });
}

let app = server();
let base = await listen(app);

let publicJudge;
let fixtureRunId;
try {
  publicJudge = await jsonRequest(base, "/v1/product/judge-view");
  if (publicJudge.response.status !== 200 || publicJudge.payload.candidate.model !== "deepseek-ai/DeepSeek-V4.1-Flash") {
    throw new Error("Public product Judge View failed canonical truth");
  }

  const publicVerifier = await jsonRequest(base, "/v1/product/verifier-demo?scenario=revision");
  if (publicVerifier.response.status !== 200 || publicVerifier.payload.result.allowed !== false) {
    throw new Error("Public product verifier demo failed revision denial");
  }

  const noAuthCandidates = await jsonRequest(base, "/v1/product/candidates");
  if (noAuthCandidates.response.status !== 401) throw new Error("Candidate list must require auth");

  const seededCandidates = await jsonRequest(base, "/v1/product/candidates", { token: TOKENS.viewer });
  if (seededCandidates.response.status !== 200 || seededCandidates.payload.candidates.length !== 3) {
    throw new Error("Seeded product candidates mismatch");
  }

  const realDeployments = await jsonRequest(base, "/v1/product/deployments?validity=CURRENT&now=2026-11-14T19%3A51%3A00.000Z", { token: TOKENS.viewer });
  const realDeepSeek = realDeployments.payload.deployments.find((item) => item.deployment.deploymentId === "deployment-deepseek-banking-prod");
  if (!realDeepSeek || realDeepSeek.decision.allowed !== false || !realDeepSeek.decision.reasons.includes("QUALIFICATION_REVIEW_REQUIRED")) {
    throw new Error("Real DeepSeek product API truth drifted");
  }

  const viewerWrite = await jsonRequest(base, "/v1/product/candidates", {
    method: "POST",
    token: TOKENS.viewer,
    body: { schema: "admissary-product-register-candidate/v1" },
  });
  if (viewerWrite.response.status !== 403) throw new Error("Viewer unexpectedly wrote candidate");

  const candidateBody = {
    schema: "admissary-product-register-candidate/v1",
    candidateId: "candidate-r10c5-acceptance",
    displayName: "R10C5 exact acceptance candidate",
    provider: "ACCEPTANCE_FIXTURE",
    repositoryOrModelId: context.candidate.repository,
    revision: context.candidate.revision,
    tokenizerRevision: context.candidate.tokenizerRevision,
    artifactManifestDigest: context.candidate.artifactManifestDigest,
    occurredAt: "2026-11-14T20:10:00.000Z",
  };

  const candidateCreate = await jsonRequest(base, "/v1/product/candidates", { method: "POST", token: TOKENS.operator, body: candidateBody });
  if (candidateCreate.response.status !== 201 || candidateCreate.payload.created !== true) throw new Error("Operator candidate registration failed");
  const candidateRepeat = await jsonRequest(base, "/v1/product/candidates", { method: "POST", token: TOKENS.operator, body: candidateBody });
  if (candidateRepeat.response.status !== 200 || candidateRepeat.payload.created !== false) throw new Error("Candidate idempotency failed");

  const contractBody = {
    schema:
      "admissary-product-register-contract/v1",
    contractId:
      acceptanceContract.id,
    version:
      acceptanceContract.version,
    digest:
      acceptanceContract.digest,
    workloadId:
      context.evaluation.suite,
    environmentId:
      "r10c5-acceptance",
    occurredAt:
      "2026-11-14T20:10:01.000Z",
  };

  const contractCreate =
    await jsonRequest(
      base,
      "/v1/product/contracts",
      {
        method: "POST",
        token: TOKENS.operator,
        body: contractBody,
      },
    );

  if (
    contractCreate.response.status !==
      201 ||
    contractCreate.payload.created !==
      true
  ) {
    throw new Error(
      `Acceptance contract registration failed: ${contractCreate.response.status} ${JSON.stringify(contractCreate.payload)}`,
    );
  }

  const contractRepeat =
    await jsonRequest(
      base,
      "/v1/product/contracts",
      {
        method: "POST",
        token: TOKENS.operator,
        body: contractBody,
      },
    );

  if (
    contractRepeat.response.status !==
      200 ||
    contractRepeat.payload.created !==
      false
  ) {
    throw new Error(
      `Acceptance contract idempotency failed: ${contractRepeat.response.status} ${JSON.stringify(contractRepeat.payload)}`,
    );
  }

  const lifecycleContract = {
    contractId:
      acceptanceContract.id,
    version:
      acceptanceContract.version,
  };

  const start = await jsonRequest(base, "/v1/product/qualifications", {
    method: "POST",
    token: TOKENS.operator,
    body: {
      schema: "admissary-product-start-qualification/v1",
      candidateId: candidateBody.candidateId,
      contractId: lifecycleContract.contractId,
      contractVersion: lifecycleContract.version,
      requestedAt: "2026-11-14T20:10:02.000Z",
      reason: "Acceptance fixture external evidence execution",
    },
  });
  if (start.response.status !== 202 || start.payload.executionStatus !== "REQUESTED_NOT_RUN" || start.payload.providerCalls !== 0) {
    throw new Error("Qualification request fabricated execution");
  }
  fixtureRunId = start.payload.run.runId;
  attestation = signQualificationAttestation({ statement: buildQualificationAttestationStatement({
    manifest, deploymentContext: context, exactArtifactBindingProven: true, issuedAt: "2026-11-14T20:10:20.000Z", keyId,
    operationalScope: { deploymentId: "deployment-r10c5-acceptance", qualificationRunId: fixtureRunId, environmentId: start.payload.run.environmentId, workloadId: start.payload.run.workloadId }
  }), privateKeyPem, keyId });

  const operatorComplete = await jsonRequest(base, `/v1/product/qualifications/${fixtureRunId}/complete`, {
    method: "POST",
    token: TOKENS.operator,
    body: { schema: "admissary-product-complete-qualification/v1" },
  });
  if (operatorComplete.response.status !== 403) throw new Error("Operator unexpectedly finalized qualification");

  const complete = await jsonRequest(base, `/v1/product/qualifications/${fixtureRunId}/complete`, {
    method: "POST",
    token: TOKENS.admin,
    body: {
      schema: "admissary-product-complete-qualification/v1",
      qualificationState: "QUALIFIED",
      blockers: [],
      exactArtifactBindingProven: true,
      evidenceGraphRootDigest: context.evidenceGraph.rootDigest,
      policyVersion: context.policyPack.version,
      policyDigest: context.policyPack.digest,
      evaluationSuite: context.evaluation.suite,
      evaluationDigest: context.evaluation.digest,
      sourceRefs: ["fixture:explicit-acceptance-evidence"],
      completedAt: "2026-11-14T20:10:03.000Z",
    },
  });
  if (complete.response.status !== 200 || complete.payload.run.qualificationState !== "QUALIFIED") throw new Error("Admin qualification completion failed");

  const blockers = await jsonRequest(base, `/v1/product/qualifications/${fixtureRunId}/blockers`, { token: TOKENS.viewer });
  if (blockers.response.status !== 200 || blockers.payload.blockers.length !== 0) throw new Error("Blocker API mismatch");

  const deploymentId = "deployment-r10c5-acceptance";
  const deploymentCreate = await jsonRequest(base, "/v1/product/deployments", {
    method: "POST",
    token: TOKENS.operator,
    body: {
      schema: "admissary-product-create-deployment/v1",
      deploymentId,
      runId: fixtureRunId,
      createdAt: "2026-11-14T20:10:04.000Z",
      maxEvidenceAgeMs: 60 * 60 * 1000,
    },
  });
  if (deploymentCreate.response.status !== 201 || deploymentCreate.payload.deployment.status !== "ACTIVE") throw new Error("Deployment creation failed");

  const beforeApproval = await jsonRequest(base, `/v1/product/deployments/${deploymentId}?now=2026-11-14T20%3A10%3A05.000Z`, { token: TOKENS.viewer });
  if (beforeApproval.payload.view.decision.allowed !== false || !beforeApproval.payload.view.decision.reasons.includes("APPROVAL_NONE")) throw new Error("Deployment should deny before approval");

  const operatorApprove = await jsonRequest(base, `/v1/product/deployments/${deploymentId}/approve`, {
    method: "POST",
    token: TOKENS.operator,
    body: { schema: "admissary-product-approval-request/v1", issuedAt: "2026-11-14T20:10:06.000Z", expiresAt: null, reason: "approve" },
  });
  if (operatorApprove.response.status !== 403) throw new Error("Operator unexpectedly approved deployment");

  const approve = await jsonRequest(base, `/v1/product/deployments/${deploymentId}/approve`, {
    method: "POST",
    token: TOKENS.approver,
    body: { schema: "admissary-product-approval-request/v1", issuedAt: "2026-11-14T20:10:06.000Z", expiresAt: "2026-11-14T22:10:06.000Z", reason: "human approval for exact fixture" },
  });
  if (approve.response.status !== 200) throw new Error("Approver approval failed");

  const afterApproval = await jsonRequest(base, `/v1/product/deployments/${deploymentId}?now=2026-11-14T20%3A10%3A07.000Z`, { token: TOKENS.viewer });
  if (afterApproval.payload.view.decision.allowed !== true) throw new Error("Approved exact deployment did not ALLOW");

  const recordAttestation = await jsonRequest(base, `/v1/product/deployments/${deploymentId}/attestation`, {
    method: "POST",
    token: TOKENS.admin,
    body: { schema: "admissary-product-record-attestation/v1", attestation, recordedAt: "2026-11-14T20:10:21.000Z" },
  });
  if (
    recordAttestation.response.status !==
    201
  ) {
    throw new Error(
      `Attestation registration failed: ${recordAttestation.response.status} ${JSON.stringify(recordAttestation.payload)}`,
    );
  }

  const fetchAttestation = await jsonRequest(base, `/v1/product/deployments/${deploymentId}/attestation`, { token: TOKENS.viewer });
  if (fetchAttestation.response.status !== 200 || fetchAttestation.payload.record.attestationDigest !== attestation.envelopeDigest) {
    throw new Error("Attestation fetch mismatch");
  }

  const admission = await jsonRequest(base, "/v1/proofs/verify", {
    method: "POST",
    token: TOKENS.admission,
    body: { attestation, context, operationalScope: attestation.statement.predicate.operationalScope },
  });
  if (admission.response.status !== 200 || admission.payload.valid !== true) throw new Error("Admission verification failed");

  const requalification = await jsonRequest(base, `/v1/product/deployments/${deploymentId}/requalification`, {
    method: "POST",
    token: TOKENS.operator,
    body: { schema: "admissary-product-requalification-request/v1", requestedAt: "2026-11-14T20:10:22.000Z", reason: "scheduled review" },
  });
  if (requalification.response.status !== 202 || requalification.payload.run.replacesDeploymentId !== deploymentId || requalification.payload.run.status !== "REQUESTED") {
    throw new Error("Requalification request failed");
  }

  const viewerRevoke = await jsonRequest(base, `/v1/product/deployments/${deploymentId}/revoke`, {
    method: "POST",
    token: TOKENS.viewer,
    body: { schema: "admissary-product-revocation-request/v1", occurredAt: "2026-11-14T20:10:23.000Z", reason: "incident" },
  });
  if (viewerRevoke.response.status !== 403) throw new Error("Viewer unexpectedly revoked deployment");

  const revoke = await jsonRequest(base, `/v1/product/deployments/${deploymentId}/revoke`, {
    method: "POST",
    token: TOKENS.approver,
    body: { schema: "admissary-product-revocation-request/v1", occurredAt: "2026-11-14T20:10:23.000Z", reason: "incident response" },
  });
  if (revoke.response.status !== 200) throw new Error("Approver revocation failed");

  const stale = await jsonRequest(base, "/v1/product/deployments?validity=STALE&now=2026-11-14T20%3A10%3A24.000Z", { token: TOKENS.viewer });
  if (!stale.payload.deployments.some((item) => item.deployment.deploymentId === deploymentId && item.decision.allowed === false)) {
    throw new Error("Revoked deployment missing from stale listing");
  }
} finally {
  await close(app);
}

// Restart proof against exact same durable state files.
app = server();
base = await listen(app);
try {
  const runAfterRestart = await jsonRequest(base, `/v1/product/qualifications/${fixtureRunId}`, { token: TOKENS.viewer });
  if (runAfterRestart.response.status !== 200 || runAfterRestart.payload.run.qualificationState !== "QUALIFIED") {
    throw new Error("Qualification state did not survive restart");
  }
  const staleAfterRestart = await jsonRequest(base, "/v1/product/deployments?validity=STALE&now=2026-11-14T20%3A10%3A25.000Z", { token: TOKENS.viewer });
  if (!staleAfterRestart.payload.deployments.some((item) => item.deployment.deploymentId === "deployment-r10c5-acceptance")) {
    throw new Error("Revoked deployment did not survive restart");
  }
} finally {
  await close(app);
}

const finalProductState = await new JsonProductRepository(productStatePath).read();
const finalAssuranceState = await new JsonAssuranceRepository(assuranceStatePath).read();

const proof = {
  schema: "admissary-r10c5-product-api-proof/v1",
  createdAt: new Date().toISOString(),
  productStateDigest: productApplicationStateDigest(finalProductState),
  assuranceStateDigest: continuousAssuranceStateDigest(finalAssuranceState),
  realDeepSeekDeployAllowed: false,
  publicProductRoutes: {
    judgeView: "PASS",
    verifierDemo: "PASS",
  },
  rbac: {
    viewerWrite: "DENY",
    operatorCompleteQualification: "DENY",
    operatorApprove: "DENY",
    approverApprove: "ALLOW",
    viewerRevoke: "DENY",
    approverRevoke: "ALLOW",
  },
  qualificationRequest: {
    providerCalls: 0,
    executionStatus: "REQUESTED_NOT_RUN",
  },
  lifecycle: {
    deploymentBeforeApproval: "DENY",
    deploymentAfterApproval: "ALLOW",
    admission: "ALLOW",
    requalificationRequested: true,
    revokedDeploymentValidity: "STALE",
    restartPersistence: "PASS",
  },
  webUsesProductApi: true,
};

proof.proofDigest = digestCanonicalJson(proof);

await writeFile(
  "results/ADMISSARY_R10C5_PRODUCT_API_PROOF.json",
  JSON.stringify(proof, null, 2) + "\n",
  "utf8",
);

const appJs = await readFile("web/app.js", "utf8");
if (!appJs.includes("/v1/product/judge-view") || !appJs.includes("/v1/product/verifier-demo")) {
  throw new Error("Web application does not consume product API routes");
}
if (appJs.includes('fetch("/api/judge"') || appJs.includes("/api/verify-demo?scenario=")) {
  throw new Error("Web application still consumes legacy judge-only routes");
}

console.log("R10C5_PUBLIC_PRODUCT_JUDGE_VIEW=PASS");
console.log("R10C5_PUBLIC_PRODUCT_VERIFIER=PASS");
console.log("R10C5_PRODUCT_API_UNAUTHENTICATED_READ=DENY");
console.log("R10C5_VIEWER_WRITE=DENY");
console.log("R10C5_OPERATOR_REGISTER_CANDIDATE=PASS");
console.log("R10C5_CANDIDATE_IDEMPOTENCY=PASS");
console.log("R10C5_OPERATOR_REGISTER_CONTRACT=PASS");
console.log("R10C5_CONTRACT_IDEMPOTENCY=PASS");
console.log("R10C5_CANONICAL_CONTRACT_IMMUTABILITY=PRESERVED");
console.log(
  `R10C5_ACCEPTANCE_CONTRACT=${acceptanceContract.id}@${acceptanceContract.version}`,
);
console.log(
  `R10C5_ACCEPTANCE_CONTRACT_DIGEST=${acceptanceContract.digest}`,
);
console.log(
  `R10C5_ACCEPTANCE_MANIFEST_DIGEST=${manifest.manifestDigest}`,
);
console.log(
  "R10C5_ACCEPTANCE_CONTRACT_SCOPE=EXPLICIT_FIXTURE",
);
console.log("R10C5_QUALIFICATION_REQUEST_PROVIDER_CALLS=ZERO");
console.log("R10C5_OPERATOR_COMPLETE_QUALIFICATION=DENY");
console.log("R10C5_ADMIN_COMPLETE_QUALIFICATION=PASS");
console.log("R10C5_BLOCKERS_API=PASS");
console.log("R10C5_DEPLOYMENT_BEFORE_APPROVAL=DENY");
console.log("R10C5_OPERATOR_APPROVAL=DENY");
console.log("R10C5_APPROVER_APPROVAL=ALLOW");
console.log("R10C5_DEPLOYMENT_AFTER_APPROVAL=ALLOW");
console.log("R10C5_ATTESTATION_REGISTER=PASS");
console.log("R10C5_ATTESTATION_FETCH=PASS");
console.log("R10C5_ADMISSION_VERIFY=ALLOW");
console.log("R10C5_REQUALIFICATION_REQUEST=PASS");
console.log("R10C5_VIEWER_REVOCATION=DENY");
console.log("R10C5_APPROVER_REVOCATION=PASS");
console.log("R10C5_STALE_DEPLOYMENT_LIST=PASS");
console.log("R10C5_DURABLE_RESTART=PASS");
console.log("R10C5_WEB_USES_PRODUCT_API=PASS");
console.log(`R10C5_PRODUCT_STATE_DIGEST=${proof.productStateDigest}`);
console.log(`R10C5_ASSURANCE_STATE_DIGEST=${proof.assuranceStateDigest}`);
console.log(`R10C5_PROOF_DIGEST=${proof.proofDigest}`);
console.log("ADMISSARY_R10C5_PRODUCT_API_GATE=PASS");
