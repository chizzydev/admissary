import { runLocalRegressions } from "./local-regression-runner.mjs";
await runLocalRegressions("r10d-canonical-cases-gate", "C-01|M-01|L-02", 4);
import { readProof } from "./artifact-integrity.mjs";
await readProof("results/ADMISSARY_R10C3_CONTINUOUS_ASSURANCE_PROOF.json","proofDigest","admissary-r10c3-continuous-assurance-proof/v1");
await readProof("results/ADMISSARY_R10C4_DECISION_WORKSPACE_PROOF.json","proofDigest","admissary-r10c4-decision-workspace-proof/v1");
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
  buildCanonicalCasePortfolio,
  buildQualificationAttestationStatement,
  buildQualificationManifest,
  digestCanonicalJson,
  signQualificationAttestation,
} from "../dist/index.js";
import {
  createAdmissaryWebServer,
} from "./admissary-web-lib.mjs";

await mkdir(
  "results/r10d",
  {
    recursive: true,
  },
);

const productStatePath =
  "results/r10d/product-state.json";
const assuranceStatePath =
  "results/r10d/assurance-state.json";

await rm(
  productStatePath,
  {
    force: true,
  },
);
await rm(
  assuranceStatePath,
  {
    force: true,
  },
);

await cp(
  "results/ADMISSARY_R10C5_PRODUCT_STATE.json",
  productStatePath,
);

await cp(
  "results/ADMISSARY_R10C5_ASSURANCE_STATE.json",
  assuranceStatePath,
);

const judge =
  JSON.parse(
    await readFile(
      "web/demo-snapshot.json",
      "utf8",
    ),
  );

const r10c3 =
  JSON.parse(
    await readFile(
      "results/ADMISSARY_R10C3_CONTINUOUS_ASSURANCE_PROOF.json",
      "utf8",
    ),
  );

const r10c4 =
  JSON.parse(
    await readFile(
      "results/ADMISSARY_R10C4_DECISION_WORKSPACE_PROOF.json",
      "utf8",
    ),
  );

const seedManifest =
  JSON.parse(
    await readFile(
      "deploy/seed/verifier-manifest.json",
      "utf8",
    ),
  );

const seedContext =
  JSON.parse(
    await readFile(
      "deploy/seed/deployment-context.json",
      "utf8",
    ),
  );

const auditContract = {
  id:
    "r10d-audit-contract",
  version:
    "1.0.0",
  digest:
    digestCanonicalJson({
      schema:
        "admissary-r10d-audit-contract/v1",
      id:
        "r10d-audit-contract",
      version:
        "1.0.0",
      workload:
        seedContext.evaluation.suite,
      environment:
        "r10d-audit-production",
      purpose:
        "explicit-case-d-audit-rollback-fixture",
    }),
};

const TOKENS = {
  viewer:
    "r10d-viewer",
  operator:
    "r10d-operator",
  approver:
    "r10d-approver",
  admin:
    "r10d-admin",
  admission:
    "r10d-admission",
};

function auth(
  token,
) {
  return {
    authorization:
      `Bearer ${token}`,
  };
}

async function jsonRequest(
  base,
  path,
  {
    method = "GET",
    token = null,
    body = undefined,
  } = {},
) {
  const headers =
    token
      ? auth(token)
      : {};

  if (
    body !== undefined
  ) {
    headers[
      "content-type"
    ] =
      "application/json";
  }

  const response =
    await fetch(
      `${base}${path}`,
      {
        method,
        headers,
        body:
          body === undefined
            ? undefined
            : JSON.stringify(
                body,
              ),
      },
    );

  let payload = null;

  try {
    payload =
      await response.json();
  } catch {
    // Preserve HTTP status for diagnostics.
  }

  return {
    response,
    payload,
  };
}

async function listen(
  server,
) {
  await new Promise(
    (
      resolve,
      reject,
    ) => {
      server.once(
        "error",
        reject,
      );

      server.listen(
        0,
        "127.0.0.1",
        resolve,
      );
    },
  );

  const address =
    server.address();

  if (
    !address ||
    typeof address ===
      "string"
  ) {
    throw new Error(
      "R10D server address unavailable",
    );
  }

  return `http://127.0.0.1:${address.port}`;
}

async function close(
  server,
) {
  if (
    typeof server
      .closeIdleConnections ===
    "function"
  ) {
    server
      .closeIdleConnections();
  }

  if (
    typeof server
      .closeAllConnections ===
    "function"
  ) {
    server
      .closeAllConnections();
  }

  await new Promise(
    (resolve) => {
      if (
        !server.listening
      ) {
        resolve();
        return;
      }

      server.close(
        () => resolve(),
      );
    },
  );
}

const {
  manifestDigest:
    _seedManifestDigest,
  ...seedManifestPayload
} = seedManifest;

function fixtureIdentity(
  suffix,
  revisionDigit,
) {
  const revision =
    revisionDigit.repeat(40);

  const tokenizerRevision =
    (
      revisionDigit === "1"
        ? "a"
        : "b"
    ).repeat(40);

  return {
    candidateId:
      `candidate-r10d-${suffix}`,
    displayName:
      `R10D ${suffix.toUpperCase()} exact acceptance candidate`,
    provider:
      "ACCEPTANCE_FIXTURE",
    repositoryOrModelId:
      `admissary-fixture/${suffix}`,
    revision,
    tokenizerRevision,
    artifactManifestDigest:
      digestCanonicalJson({
        schema:
          "admissary-r10d-artifact/v1",
        suffix,
        revision,
        tokenizerRevision,
      }),
  };
}

function qualificationFixture(
  candidate,
  evidenceGraphRootDigest,
) {
  const context =
    structuredClone(
      seedContext,
    );

  context.candidate = {
    repository:
      candidate
        .repositoryOrModelId,
    revision:
      candidate.revision,
    tokenizerRevision:
      candidate
        .tokenizerRevision,
    artifactManifestDigest:
      candidate
        .artifactManifestDigest,
  };

  context.contract = {
    ...auditContract,
  };

  context.evidenceGraph = {
    rootDigest:
      evidenceGraphRootDigest,
  };

  context.evidenceGraph.rootDigest = fixtureEvidence(candidate, {contractId: auditContract.id, version: auditContract.version}, context).graph.rootDigest;
  const manifest =
    buildQualificationManifest({
      ...seedManifestPayload,
      candidate: {
        ...context.candidate,
      },
      contract: {
        ...auditContract,
      },
      evidenceGraph: {
        rootDigest:
          context.evidenceGraph.rootDigest,
      },
    });

  const {
    publicKey,
    privateKey,
  } =
    generateKeyPairSync(
      "ed25519",
    );

  const keyId =
    `r10d-${candidate.candidateId}-key`;

  const publicKeyPem =
    publicKey
      .export({
        type: "spki",
        format: "pem",
      })
      .toString();

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
        "2026-11-14T20:40:00.000Z",
      keyId,
    });

  return {
    signForScope: operationalScope => signQualificationAttestation({ statement: buildQualificationAttestationStatement({ manifest, deploymentContext: context, exactArtifactBindingProven: true, issuedAt: "2026-11-14T20:40:00.000Z", keyId, operationalScope }), privateKeyPem, keyId }),
    context,
    manifest,
    keyId,
    publicKeyPem,
    attestation:
      signQualificationAttestation({
        statement,
        privateKeyPem,
        keyId,
      }),
  };
}

const baselineCandidate =
  fixtureIdentity(
    "baseline",
    "1",
  );

const currentCandidate =
  fixtureIdentity(
    "current",
    "2",
  );

const baselineProof =
  qualificationFixture(
    baselineCandidate,
    digestCanonicalJson({
      case:
        "R10D_BASELINE",
      evidence:
        "explicit-acceptance-fixture",
    }),
  );

const currentProof =
  qualificationFixture(
    currentCandidate,
    digestCanonicalJson({
      case:
        "R10D_CURRENT",
      evidence:
        "explicit-acceptance-fixture",
    }),
  );

const trustStore = {
  [baselineProof.keyId]:
    baselineProof.publicKeyPem,
  [currentProof.keyId]:
    currentProof.publicKeyPem,
};

await writeFile("results/r10d/attestation-trust-store.json", JSON.stringify(trustStore, null, 2) + "\n", "utf8");

const server =
  createAdmissaryWebServer({
    mode:
      "r10d-test",
    completionEvidenceResolver: async (r,c,k) => fixtureEvidence(c,k,seedContext),
    snapshotPath:
      "web/demo-snapshot.json",
    verifierManifestPath:
      "deploy/seed/verifier-manifest.json",
    verifierContextPath:
      "deploy/seed/deployment-context.json",
    productStatePath,
    productAssuranceStatePath:
      assuranceStatePath,
    productRegistryProofPath:
      "results/ADMISSARY_R10C_REGISTRY_PROOF.json",
    productAssuranceProofPath:
      "results/ADMISSARY_R10C3_CONTINUOUS_ASSURANCE_PROOF.json",
    scenarioSnapshotPath:
      "web/scenario-snapshot.json",
    authTokens: {
      [TOKENS.viewer]:
        "VIEWER",
      [TOKENS.operator]:
        "OPERATOR",
      [TOKENS.approver]:
        "APPROVER",
      [TOKENS.admin]:
        "ADMIN",
      [TOKENS.admission]:
        "ADMISSION",
    },
    attestationTrustStore:
      trustStore,
  });

const base =
  await listen(
    server,
  );

async function createQualifiedDeployment(
  input,
) {
  const candidateCreate =
    await jsonRequest(
      base,
      "/v1/product/candidates",
      {
        method: "POST",
        token:
          TOKENS.operator,
        body: {
          schema:
            "admissary-product-register-candidate/v1",
          ...input.candidate,
          occurredAt:
            input.registeredAt,
        },
      },
    );

  if (
    ![200, 201].includes(
      candidateCreate
        .response.status,
    )
  ) {
    throw new Error(
      `R10D candidate registration failed: ${candidateCreate.response.status} ${JSON.stringify(candidateCreate.payload)}`,
    );
  }

  const start =
    await jsonRequest(
      base,
      "/v1/product/qualifications",
      {
        method: "POST",
        token:
          TOKENS.operator,
        body: {
          schema:
            "admissary-product-start-qualification/v1",
          candidateId:
            input.candidate
              .candidateId,
          contractId:
            auditContract.id,
          contractVersion:
            auditContract.version,
          requestedAt:
            input.requestedAt,
          reason:
            input.reason,
        },
      },
    );

  if (
    start.response.status !==
      202 ||
    start.payload
      .executionStatus !==
      "REQUESTED_NOT_RUN" ||
    start.payload
      .providerCalls !== 0
  ) {
    throw new Error(
      "R10D qualification request fabricated provider execution",
    );
  }

  const runId =
    start.payload.run.runId;

  const complete =
    await jsonRequest(
      base,
      `/v1/product/qualifications/${encodeURIComponent(runId)}/complete`,
      {
        method: "POST",
        token:
          TOKENS.admin,
        body: {
          schema:
            "admissary-product-complete-qualification/v1",
          qualificationState:
            "QUALIFIED",
          blockers: [],
          exactArtifactBindingProven:
            true,
          evidenceGraphRootDigest:
            input.proof.context
              .evidenceGraph
              .rootDigest,
          policyVersion:
            input.proof.context
              .policyPack
              .version,
          policyDigest:
            input.proof.context
              .policyPack
              .digest,
          evaluationSuite:
            input.proof.context
              .evaluation.suite,
          evaluationDigest:
            input.proof.context
              .evaluation.digest,
          sourceRefs: ["fixture:explicit-acceptance-evidence"],
          completedAt:
            input.completedAt,
        },
      },
    );

  if (
    complete.response.status !==
      200 ||
    complete.payload.run
      .qualificationState !==
      "QUALIFIED"
  ) {
    throw new Error(
      `R10D qualification completion failed: ${complete.response.status} ${JSON.stringify(complete.payload)}`,
    );
  }

  const deployment =
    await jsonRequest(
      base,
      "/v1/product/deployments",
      {
        method: "POST",
        token:
          TOKENS.operator,
        body: {
          schema:
            "admissary-product-create-deployment/v1",
          deploymentId:
            input.deploymentId,
          runId,
          createdAt:
            input.deployedAt,
          maxEvidenceAgeMs:
            24 * 60 * 60 * 1000,
        },
      },
    );

  if (
    deployment.response.status !==
      201
  ) {
    throw new Error(
      `R10D deployment creation failed: ${deployment.response.status} ${JSON.stringify(deployment.payload)}`,
    );
  }

  const approval =
    await jsonRequest(
      base,
      `/v1/product/deployments/${encodeURIComponent(input.deploymentId)}/approve`,
      {
        method: "POST",
        token:
          TOKENS.approver,
        body: {
          schema:
            "admissary-product-approval-request/v1",
          issuedAt:
            input.approvedAt,
          expiresAt: null,
          reason:
            input.approvalReason,
        },
      },
    );

  if (
    approval.response.status !==
      200
  ) {
    throw new Error(
      `R10D approval failed: ${approval.response.status} ${JSON.stringify(approval.payload)}`,
    );
  }

  input.proof.attestation = input.proof.signForScope({ deploymentId: input.deploymentId, qualificationRunId: runId, environmentId: start.payload.run.environmentId, workloadId: start.payload.run.workloadId });
  const attestation =
    await jsonRequest(
      base,
      `/v1/product/deployments/${encodeURIComponent(input.deploymentId)}/attestation`,
      {
        method: "POST",
        token:
          TOKENS.admin,
        body: {
          schema:
            "admissary-product-record-attestation/v1",
          attestation:
            input.proof
              .attestation,
          recordedAt:
            input.attestedAt,
        },
      },
    );

  if (
    attestation.response.status !==
      201
  ) {
    throw new Error(
      `R10D attestation attachment failed: ${attestation.response.status} ${JSON.stringify(attestation.payload)}`,
    );
  }

  const read =
    await jsonRequest(
      base,
      `/v1/product/deployments/${encodeURIComponent(input.deploymentId)}?now=${encodeURIComponent(input.readAt)}`,
      {
        token:
          TOKENS.viewer,
      },
    );

  if (
    read.response.status !==
      200 ||
    read.payload.view
      .decision.allowed !==
      true
  ) {
    throw new Error(
      `R10D approved deployment did not ALLOW: ${JSON.stringify(read.payload)}`,
    );
  }

  const currentAdmission =
    await jsonRequest(
      base,
      `/v1/product/deployments/${encodeURIComponent(input.deploymentId)}/admission`,
      {
        method: "POST",
        token:
          TOKENS.admission,
        body: {
          schema:
            "admissary-current-deployment-admission-request/v1",
          context:
            input.proof.context,
        },
      },
    );

  if (
    currentAdmission.response.status !==
      200 ||
    currentAdmission.payload
      .decision !==
      "ALLOW" ||
    currentAdmission.payload
      .currentAuthority
      .allowed !==
      true
  ) {
    throw new Error(
      `R10D current-state admission did not ALLOW: ${currentAdmission.response.status} ${JSON.stringify(currentAdmission.payload)}`,
    );
  }

  return {
    runId,
    attestationDigest:
      input.proof
        .attestation
        .envelopeDigest,
  };
}

try {
  const contract =
    await jsonRequest(
      base,
      "/v1/product/contracts",
      {
        method: "POST",
        token:
          TOKENS.operator,
        body: {
          schema:
            "admissary-product-register-contract/v1",
          contractId:
            auditContract.id,
          version:
            auditContract.version,
          digest:
            auditContract.digest,
          workloadId:
            seedContext
              .evaluation.suite,
          environmentId:
            "r10d-audit-production",
          occurredAt:
            "2026-11-14T20:29:00.000Z",
        },
      },
    );

  if (
    contract.response.status !==
      201
  ) {
    throw new Error(
      `R10D audit contract registration failed: ${contract.response.status} ${JSON.stringify(contract.payload)}`,
    );
  }

  await createQualifiedDeployment({
    candidate:
      baselineCandidate,
    proof:
      baselineProof,
    deploymentId:
      "deployment-r10d-baseline",
    registeredAt:
      "2026-11-14T20:30:00.000Z",
    requestedAt:
      "2026-11-14T20:31:00.000Z",
    completedAt:
      "2026-11-14T20:32:00.000Z",
    deployedAt:
      "2026-11-14T20:33:00.000Z",
    approvedAt:
      "2026-11-14T20:34:00.000Z",
    attestedAt:
      "2026-11-14T20:35:00.000Z",
    readAt:
      "2026-11-14T20:36:00.000Z",
    reason:
      "Case D baseline qualification fixture",
    approvalReason:
      "Approve last-known-good baseline fixture",
    evidenceRef:
      "R10D:baseline",
  });

  await createQualifiedDeployment({
    candidate:
      currentCandidate,
    proof:
      currentProof,
    deploymentId:
      "deployment-r10d-current",
    registeredAt:
      "2026-11-14T20:40:00.000Z",
    requestedAt:
      "2026-11-14T20:41:00.000Z",
    completedAt:
      "2026-11-14T20:42:00.000Z",
    deployedAt:
      "2026-11-14T20:43:00.000Z",
    approvedAt:
      "2026-11-14T20:44:00.000Z",
    attestedAt:
      "2026-11-14T20:45:00.000Z",
    readAt:
      "2026-11-14T20:46:00.000Z",
    reason:
      "Case D current release qualification fixture",
    approvalReason:
      "Approve current release fixture",
    evidenceRef:
      "R10D:current",
  });

  const revoke =
    await jsonRequest(
      base,
      "/v1/product/deployments/deployment-r10d-current/revoke",
      {
        method: "POST",
        token:
          TOKENS.approver,
        body: {
          schema:
            "admissary-product-revocation-request/v1",
          occurredAt:
            "2026-11-14T20:50:00.000Z",
          reason:
            "Incident response: current release revoked; investigate and roll back",
        },
      },
    );

  if (
    revoke.response.status !==
      200
  ) {
    throw new Error(
      `R10D incident revocation failed: ${revoke.response.status} ${JSON.stringify(revoke.payload)}`,
    );
  }

  const historicalCryptographic =
    await jsonRequest(
      base,
      "/v1/proofs/verify",
      {
        method: "POST",
        token:
          TOKENS.admission,
        body: {
          operationalScope: currentProof.attestation.statement.predicate.operationalScope,
          attestation:
            currentProof.attestation,
          context:
            currentProof.context,
        },
      },
    );

  if (
    historicalCryptographic
      .response.status !==
      200 ||
    historicalCryptographic
      .payload.valid !==
      true
  ) {
    throw new Error(
      "R10D historical attestation no longer verifies cryptographically",
    );
  }

  const currentAuthorityAfterIncident =
    await jsonRequest(
      base,
      "/v1/product/deployments/deployment-r10d-current/admission",
      {
        method: "POST",
        token:
          TOKENS.admission,
        body: {
          schema:
            "admissary-current-deployment-admission-request/v1",
          context:
            currentProof.context,
        },
      },
    );

  if (
    currentAuthorityAfterIncident
      .response.status !==
      409 ||
    currentAuthorityAfterIncident
      .payload.decision !==
      "DENY" ||
    currentAuthorityAfterIncident
      .payload.cryptographic
      ?.allowed !==
      true ||
    currentAuthorityAfterIncident
      .payload.currentAuthority
      ?.allowed !==
      false
  ) {
    throw new Error(
      `R10D current authority did not override historical signature after revocation: ${currentAuthorityAfterIncident.response.status} ${JSON.stringify(currentAuthorityAfterIncident.payload)}`,
    );
  }

  const auditResponse =
    await jsonRequest(
      base,
      `/v1/product/deployments/deployment-r10d-current/audit?now=${encodeURIComponent("2026-11-14T20:51:00.000Z")}`,
      {
        token:
          TOKENS.viewer,
      },
    );

  if (
    auditResponse.response.status !==
      200
  ) {
    throw new Error(
      `R10D audit API failed: ${auditResponse.response.status} ${JSON.stringify(auditResponse.payload)}`,
    );
  }

  const audit =
    auditResponse.payload.audit;

  if (
    audit.decision.allowed !==
      false ||
    audit.decision
      .lifecycleState !==
      "REVOKED" ||
    audit.approval?.state !==
      "REVOKED" ||
    !audit.attestation ||
    audit.exactIdentity
      .revision !==
      currentCandidate.revision
  ) {
    throw new Error(
      `R10D audit truth mismatch: ${JSON.stringify(audit)}`,
    );
  }

  if (
    !audit.timeline.some(
      (item) =>
        item.type ===
        "APPROVAL_GRANTED",
    ) ||
    !audit.timeline.some(
      (item) =>
        item.type ===
        "ATTESTATION_RECORDED",
    ) ||
    !audit.timeline.some(
      (item) =>
        item.type ===
        "APPROVAL_REVOKED",
    )
  ) {
    throw new Error(
      "R10D audit timeline is missing qualification/approval/attestation/incident history",
    );
  }

  const rollbackResponse =
    await jsonRequest(
      base,
      `/v1/product/deployments/deployment-r10d-current/rollback-targets?now=${encodeURIComponent("2026-11-14T20:51:00.000Z")}`,
      {
        token:
          TOKENS.viewer,
      },
    );

  if (
    rollbackResponse.response.status !==
      200
  ) {
    throw new Error(
      `R10D rollback API failed: ${rollbackResponse.response.status} ${JSON.stringify(rollbackResponse.payload)}`,
    );
  }

  const rollbackTargets =
    rollbackResponse
      .payload.targets;

  if (
    rollbackTargets.length <
      1 ||
    rollbackTargets[0]
      .deploymentId !==
      "deployment-r10d-baseline"
  ) {
    throw new Error(
      `R10D safe rollback target missing: ${JSON.stringify(rollbackTargets)}`,
    );
  }

  const macroF1 =
    judge.metrics.find(
      (metric) =>
        metric.id ===
        "macro_f1",
    )?.observed;

  const criticalRecall =
    judge.metrics.find(
      (metric) =>
        metric.id ===
        "critical_intent_recall",
    )?.observed;

  const schemaValidity =
    judge.metrics.find(
      (metric) =>
        metric.id ===
        "schema_validity",
    )?.observed;

  const injectionInvariance =
    judge.metrics.find(
      (metric) =>
        metric.id ===
        "injection_invariance",
    )?.observed;

  if (
    [
      macroF1,
      criticalRecall,
      schemaValidity,
      injectionInvariance,
    ].some(
      (value) =>
        typeof value !==
        "number",
    )
  ) {
    throw new Error(
      "R10D Case A canonical metrics are missing",
    );
  }

  const excludedCandidateIds =
    r10c4.selection
      .excluded
      .map(
        (item) =>
          item.candidateId,
      );

  const portfolio =
    buildCanonicalCasePortfolio({
      generatedAt:
        new Date()
          .toISOString(),
      caseA: {
        model:
          judge.candidate.model,
        macroF1,
        criticalIntentRecall:
          criticalRecall,
        schemaValidity,
        injectionInvariance,
        empiricalFitness:
          judge.candidate
            .empiricalFitness,
        overallQualification:
          judge.candidate
            .overallQualification,
        deployAllowed:
          judge.candidate
            .deployAllowed,
        evidenceRefs: [
          "R5:real-dolphin-144-case-run",
          "R6:deterministic-qualification",
          "R7:real-deployment-denial",
        ],
      },
      caseB: {
        initialAllowed:
          r10c3.caseB
            .initialAllowed,
        driftAllowed:
          r10c3.caseB
            .driftAllowed,
        historicalApprovalPreserved:
          r10c3.caseB
            .preservedHistoricalApprovalState ===
          "APPROVED",
        invalidatedNodes:
          r10c3.caseB
            .invalidatedNodes,
        reassessmentRequested:
          Boolean(
            r10c3.caseB
              .reassessmentRequestId,
          ),
        requalificationInheritedApproval:
          r10c3.caseB
            .afterReassessmentBeforeNewApprovalAllowed,
        realWatcherRepository:
          r10c3.liveHuggingFace
            .repository,
        realWatcherOutcome:
          r10c3.liveHuggingFace
            .historicalToCurrentOutcome,
        evidenceRefs: [
          "R10C3:continuous-assurance",
          "R10C3:real-hugging-face-watcher",
          "R10C2:signed-attestation-and-admission",
        ],
      },
      caseC: {
        realCandidateStates: r10c4.realCandidateStates.map(c=>`${c.candidateId}: ${c.qualificationState}; exact binding ${c.exactArtifactBindingProven?'PROVEN':'UNPROVEN'}`),
        realSelectionStatus: r10c4.realSelection.status,
        selectedCandidateId:
          r10c4.selection
            .selectedCandidateId,
        selectedClaimScope:
          r10c4.selection
            .claimScope,
        excludedCandidateIds,
        realQualifiedCandidateExists:
          false,
        evidenceRefs: [
          "R2:real-remote-code-disqualification",
          "R5:real-deepseek-unfit",
          "R10C4:qualification-first-selection",
        ],
      },
      caseD: {
        audit,
        incidentDecisionAllowed:
          audit.decision.allowed,
        historicalAttestationCryptographicallyValid:
          historicalCryptographic.payload.valid === true,
        currentAuthorityAllowed:
          currentAuthorityAfterIncident.payload.currentAuthority.allowed === true,
        rollbackTargetId:
          rollbackTargets[0]
            ?.deploymentId ??
          null,
        evidenceRefs: [
          "R10D:deployment-audit-api",
          "R10D:safe-rollback-filter",
          "R10C5:durable-product-history",
        ],
      },
    });

  await writeFile(
    "web/scenario-snapshot.json",
    JSON.stringify(
      portfolio,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  await writeFile(
    "results/ADMISSARY_R10D_CASE_D_AUDIT_PROOF.json",
    JSON.stringify(
      audit,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  await writeFile(
    "results/ADMISSARY_R10D_SCENARIO_PROOF.json",
    JSON.stringify(
      portfolio,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  const publicScenarios =
    await jsonRequest(
      base,
      "/v1/product/scenarios",
    );

  if (
    publicScenarios.response
      .status !==
      200 ||
    publicScenarios.payload
      .portfolio
      .portfolioDigest !==
      portfolio.portfolioDigest
  ) {
    throw new Error(
      "R10D public scenario API does not match the canonical portfolio",
    );
  }

  const appJs =
    await readFile(
      "web/app.js",
      "utf8",
    );

  const indexHtml =
    await readFile(
      "web/index.html",
      "utf8",
    );

  if (
    !appJs.includes(
      "/v1/product/scenarios",
    ) ||
    !appJs.includes(
      "renderOperationalCases",
    ) ||
    !indexHtml.includes(
      "operational-cases",
    ) ||
    !indexHtml.includes(
      "demo-causal-chain",
    )
  ) {
    throw new Error(
      "R10D cases are not visible in the product web surface",
    );
  }

  const shared =
    JSON.stringify(
      portfolio.sharedPrimitives,
    );

  if (
    !portfolio.cases.every(
      (item) =>
        JSON.stringify(
          item.primitives,
        ) === shared,
    )
  ) {
    throw new Error(
      "R10D cases do not share the same product primitives",
    );
  }

  const caseA =
    portfolio.cases.find(
      (item) =>
        item.id === "CASE_A",
    );

  const caseB =
    portfolio.cases.find(
      (item) =>
        item.id === "CASE_B",
    );

  const caseC =
    portfolio.cases.find(
      (item) =>
        item.id === "CASE_C",
    );

  const caseD =
    portfolio.cases.find(
      (item) =>
        item.id === "CASE_D",
    );

  if (
    caseA?.claimScope !==
      "REAL" ||
    caseA.facts
      .empiricalFitness !==
      "UNFIT"
  ) {
    throw new Error(
      "R10D Case A real evidence truth drifted",
    );
  }

  if (
    caseB?.outcome !==
      "ALLOW_TO_DENY_ON_DRIFT"
  ) {
    throw new Error(
      "R10D Case B drift story is incomplete",
    );
  }

  if (
    caseC?.facts
      .selectedClaimScope !==
      "FIXTURE_ONLY" ||
    caseC?.facts
      .fakeWinner !==
      false
  ) {
    throw new Error(
      "R10D Case C fabricated a real winner",
    );
  }

  if (
    caseD?.facts
      .rollbackTargetId !==
      "deployment-r10d-baseline"
  ) {
    throw new Error(
      "R10D Case D rollback target mismatch",
    );
  }

  console.log(
    "R10D_CASE_A_REAL_UNFIT=PASS",
  );
  console.log(
    `R10D_CASE_A_MODEL=${caseA.facts.model}`,
  );
  console.log(
    `R10D_CASE_A_MACRO_F1=${caseA.facts.macroF1}`,
  );
  console.log(
    `R10D_CASE_A_CRITICAL_RECALL=${caseA.facts.criticalIntentRecall}`,
  );
  console.log(
    `R10D_CASE_A_SCHEMA_VALIDITY=${caseA.facts.schemaValidity}`,
  );
  console.log(
    "R10D_CASE_B_DRIFT_TO_DENY=PASS",
  );
  console.log(
    `R10D_CASE_B_INVALIDATED_NODES=${r10c3.caseB.invalidatedNodes.join(",")}`,
  );
  console.log(
    "R10D_CASE_C_MULTI_CANDIDATE_SELECTION=PASS",
  );
  console.log(
    `R10D_CASE_C_SELECTED=${r10c4.selection.selectedCandidateId}`,
  );
  console.log(
    `R10D_CASE_C_SELECTED_CLAIM_SCOPE=${r10c4.selection.claimScope}`,
  );
  console.log(
    "R10D_NO_SCRIPTED_FAKE_WINNER=PASS",
  );
  console.log(
    "R10D_CASE_D_AUDIT_ROLLBACK=PASS",
  );
  console.log(
    "R10D_CASE_D_INCIDENT_DEPLOY=DENY",
  );
  console.log(
    "R10D_CASE_D_HISTORICAL_ATTESTATION_CRYPTO=VALID",
  );
  console.log(
    "R10D_CASE_D_CURRENT_AUTHORITY=DENY",
  );
  console.log(
    `R10D_CASE_D_ROLLBACK_TARGET=${rollbackTargets[0].deploymentId}`,
  );
  console.log(
    `R10D_CASE_D_AUDIT_DIGEST=${audit.auditDigest}`,
  );
  console.log(
    "R10D_PRIMITIVE_CLAIM=COMPOSITION_VOCABULARY_ONLY",
  );
  console.log(
    `R10D_COMPOSITION_VOCABULARY=${portfolio.sharedPrimitives.join(",")}`,
  );
  console.log(
    "R10D_DEMO_CAUSAL_CHAIN=PASS",
  );
  console.log(
    `R10D_DEMO_CAUSAL_STEPS=${portfolio.demoCausalChain.length}`,
  );
  console.log(
    "R10D_WEB_CASE_PORTFOLIO=PASS",
  );
  console.log(
    `R10D_PORTFOLIO_DIGEST=${portfolio.portfolioDigest}`,
  );
  console.log(
    "ADMISSARY_R10D_CANONICAL_CASES_GATE=PASS",
  );
} finally {
  await close(
    server,
  );
}
