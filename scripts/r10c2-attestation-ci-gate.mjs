import { runLocalRegressions } from "./local-regression-runner.mjs";
await runLocalRegressions("r10c2-attestation-ci-gate", "H-03|M-01|L-04", 4);
const OPERATIONAL_SCOPE = {deploymentId:"fixture-deployment",qualificationRunId:"fixture-run",environmentId:"fixture-environment",workloadId:"fixture-workload"};
import {
  generateKeyPairSync,
} from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import {
  spawnSync,
} from "node:child_process";

import {
  assertAttestationEligibility,
  buildQualificationAttestationStatement,
  signQualificationAttestation,
  verifyHistoricalAttestationProof,
  verifySignedQualificationAttestation,
} from "../dist/index.js";
import {
  createAdmissaryWebServer,
} from "./admissary-web-lib.mjs";

const manifest =
  JSON.parse(
    await readFile(
      "deploy/seed/verifier-manifest.json",
      "utf8",
    ),
  );

const context =
  JSON.parse(
    await readFile(
      "deploy/seed/deployment-context.json",
      "utf8",
    ),
  );

const persistence =
  JSON.parse(
    await readFile(
      "results/ADMISSARY_R7_STATE.json",
      "utf8",
    ),
  );

const realRun =
  persistence.qualificationRuns.find(
    (item) =>
      item.runId ===
      "r6-deepseek-live",
  );

if (!realRun) {
  throw new Error(
    "Canonical real DeepSeek R7 run is missing",
  );
}

let realAttestationDenied =
  false;

try {
  assertAttestationEligibility({
    qualificationState:
      realRun.qualificationState,
    authorizationState:
      "NOT_REQUESTED",
    validityState:
      "CURRENT",
    exactArtifactBindingProven:
      realRun
        .exactArtifactBindingProven,
  });
} catch (error) {
  realAttestationDenied =
    error?.code ===
      "ATTESTATION_QUALIFICATION_REQUIRED" ||
    error?.code ===
      "ATTESTATION_EXACT_BINDING_REQUIRED";
}

if (
  !realAttestationDenied
) {
  throw new Error(
    "Real DeepSeek record unexpectedly became attestation-eligible",
  );
}

const {
  publicKey,
  privateKey,
} =
  generateKeyPairSync(
    "ed25519",
  );

const keyId =
  "admissary-r10c2-acceptance-key";

const publicKeyPem =
  publicKey.export({
    type: "spki",
    format: "pem",
  }).toString();

const privateKeyPem =
  privateKey.export({
    type: "pkcs8",
    format: "pem",
  }).toString();

const statement =
  buildQualificationAttestationStatement({
      operationalScope: OPERATIONAL_SCOPE,
    manifest,
    deploymentContext:
      context,
    exactArtifactBindingProven:
      true,
    issuedAt:
      "2026-11-14T20:00:00.000Z",
    keyId,
  });

const attestation =
  signQualificationAttestation({
    statement,
    privateKeyPem,
    keyId,
  });

const trustStore = {
  [keyId]:
    publicKeyPem,
};

const verified =
  verifySignedQualificationAttestation(
    attestation,
    trustStore,
  );

if (!verified.valid) {
  throw new Error(
    `Signed attestation did not verify: ${verified.reasons.join(",")}`,
  );
}

const admission =
  verifyHistoricalAttestationProof({
      operationalScope: OPERATIONAL_SCOPE,
    attestation,
    currentContext:
      context,
    trustStore,
  });

if (
  !admission.allowed
) {
  throw new Error(
    "Valid signed attestation did not produce ALLOW",
  );
}

const tampered =
  structuredClone(
    attestation,
  );

tampered.statement
  .predicate.manifest
  .candidate.revision =
  "tampered-revision";

const tamperedVerification =
  verifySignedQualificationAttestation(
    tampered,
    trustStore,
  );

if (
  tamperedVerification.valid
) {
  throw new Error(
    "Tampered signed attestation unexpectedly verified",
  );
}

const {
  publicKey:
    wrongPublicKey,
} =
  generateKeyPairSync(
    "ed25519",
  );

const wrongKey =
  verifySignedQualificationAttestation(
    attestation,
    {
      [keyId]:
        wrongPublicKey
          .export({
            type: "spki",
            format: "pem",
          })
          .toString(),
    },
  );

if (wrongKey.valid) {
  throw new Error(
    "Wrong trusted key unexpectedly verified attestation",
  );
}

const changedContext =
  structuredClone(
    context,
  );

changedContext.candidate.revision =
  "changed-after-approval";

const changedAdmission =
  verifyHistoricalAttestationProof({
      operationalScope: OPERATIONAL_SCOPE,
    attestation,
    currentContext:
      changedContext,
    trustStore,
  });

if (
  changedAdmission.allowed
) {
  throw new Error(
    "Changed deployment context unexpectedly allowed signed attestation",
  );
}

await mkdir(
  "results/r10c2",
  {
    recursive: true,
  },
);

await writeFile(
  "results/r10c2/qualification-attestation.json",
  JSON.stringify(
    attestation,
    null,
    2,
  ) + "\n",
  "utf8",
);

await writeFile(
  "results/r10c2/attestation-public-key.pem",
  publicKeyPem,
  "utf8",
);

const validReport =
  "results/r10c2/ci-valid.json";

const validCi =
  spawnSync(
    process.execPath,
    [
      "scripts/verify-historical-proof.mjs",
      "--manifest",
      "deploy/seed/verifier-manifest.json",
      "--context",
      "deploy/seed/deployment-context.json",
      "--report",
      validReport,
    ],
    {
      encoding: "utf8",
    },
  );

if (
  validCi.status !== 0 ||
  !validCi.stdout.includes(
    "ADMISSARY_HISTORICAL_PROOF_DECISION=VALID",
  )
) {
  throw new Error(
    `Valid CI gate failed: ${validCi.stdout}\n${validCi.stderr}`,
  );
}

const changedContextPath =
  "results/r10c2/changed-context.json";

await writeFile(
  changedContextPath,
  JSON.stringify(
    changedContext,
    null,
    2,
  ) + "\n",
  "utf8",
);

const deniedReport =
  "results/r10c2/ci-denied.json";

const deniedCi =
  spawnSync(
    process.execPath,
    [
      "scripts/verify-historical-proof.mjs",
      "--manifest",
      "deploy/seed/verifier-manifest.json",
      "--context",
      changedContextPath,
      "--report",
      deniedReport,
    ],
    {
      encoding: "utf8",
    },
  );

if (
  deniedCi.status !== 1 ||
  !deniedCi.stdout.includes(
    "ADMISSARY_HISTORICAL_PROOF_DECISION=INVALID",
  ) ||
  !deniedCi.stdout.includes(
    "CANDIDATE_REVISION_MISMATCH",
  )
) {
  throw new Error(
    `Denied CI gate mismatch: ${deniedCi.stdout}\n${deniedCi.stderr}`,
  );
}

const ADMISSION_TOKEN =
  "r10c2-admission-token";

const VIEWER_TOKEN =
  "r10c2-viewer-token";

const server =
  createAdmissaryWebServer({
    mode:
      "r10c2-test",
    snapshotPath:
      "deploy/seed/demo-snapshot.json",
    verifierManifestPath:
      "deploy/seed/verifier-manifest.json",
    verifierContextPath:
      "deploy/seed/deployment-context.json",
    authTokens: {
      [ADMISSION_TOKEN]:
        "ADMISSION",
      [VIEWER_TOKEN]:
        "VIEWER",
    },
    attestationTrustStore:
      trustStore,
  });

await new Promise(
  (resolve, reject) => {
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

try {
  const address =
    server.address();

  if (
    !address ||
    typeof address ===
      "string"
  ) {
    throw new Error(
      "Admission API server address unavailable",
    );
  }

  const base =
    `http://127.0.0.1:${address.port}`;

  const noAuth =
    await fetch(
      `${base}/v1/proofs/verify`,
      {
        method: "POST",
        headers: {
          "content-type":
            "application/json",
        },
        body:
          JSON.stringify({
            operationalScope: OPERATIONAL_SCOPE,
          attestation,
            context,
          }),
      },
    );

  if (
    noAuth.status !==
    401
  ) {
    throw new Error(
      `Admission API no-auth status ${noAuth.status}`,
    );
  }

  const viewer =
    await fetch(
      `${base}/v1/proofs/verify`,
      {
        method: "POST",
        headers: {
          authorization:
            `Bearer ${VIEWER_TOKEN}`,
          "content-type":
            "application/json",
        },
        body:
          JSON.stringify({
            operationalScope: OPERATIONAL_SCOPE,
          attestation,
            context,
          }),
      },
    );

  if (
    viewer.status !==
    403
  ) {
    throw new Error(
      `Admission API viewer status ${viewer.status}`,
    );
  }

  const allowedResponse =
    await fetch(
      `${base}/v1/proofs/verify`,
      {
        method: "POST",
        headers: {
          authorization:
            `Bearer ${ADMISSION_TOKEN}`,
          "content-type":
            "application/json",
        },
        body:
          JSON.stringify({
            operationalScope: OPERATIONAL_SCOPE,
          attestation,
            context,
          }),
      },
    );

  const allowedBody =
    await allowedResponse.json();

  if (
    allowedResponse.status !==
      200 ||
    allowedBody.valid !==
      true
  ) {
    throw new Error(
      `Admission API valid decision failed: ${allowedResponse.status} ${JSON.stringify(allowedBody)}`,
    );
  }

  const deniedResponse =
    await fetch(
      `${base}/v1/proofs/verify`,
      {
        method: "POST",
        headers: {
          authorization:
            `Bearer ${ADMISSION_TOKEN}`,
          "content-type":
            "application/json",
        },
        body:
          JSON.stringify({
            operationalScope: OPERATIONAL_SCOPE,
          attestation,
            context:
              changedContext,
          }),
      },
    );

  const deniedBody =
    await deniedResponse.json();

  if (
    deniedResponse.status !==
      409 ||
    deniedBody.valid !==
      false
  ) {
    throw new Error(
      `Admission API changed-context decision failed: ${deniedResponse.status} ${JSON.stringify(deniedBody)}`,
    );
  }
} finally {
  if (
    typeof server
      .closeIdleConnections ===
    "function"
  ) {
    server.closeIdleConnections();
  }

  if (
    typeof server
      .closeAllConnections ===
    "function"
  ) {
    server.closeAllConnections();
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

console.log(
  "R10C2_REAL_DEEPSEEK_ATTESTATION=DENY",
);
console.log(
  `R10C2_ATTESTATION_KEY_ID=${keyId}`,
);
console.log(
  `R10C2_ATTESTATION_STATEMENT_DIGEST=${attestation.statementDigest}`,
);
console.log(
  `R10C2_ATTESTATION_ENVELOPE_DIGEST=${attestation.envelopeDigest}`,
);
console.log(
  "R10C2_SIGNED_ATTESTATION_VERIFY=PASS",
);
console.log(
  "R10C2_ATTESTATION_TAMPER=DENY",
);
console.log(
  "R10C2_ATTESTATION_WRONG_KEY=DENY",
);
console.log(
  "R10C2_ATTESTATION_CHANGED_CONTEXT=DENY",
);
console.log(
  "R10C2_HISTORICAL_PROOF_VALID=VALID",
);
console.log(
  "R10C2_HISTORICAL_PROOF_CHANGED_REVISION=INVALID",
);
console.log(
  "R10C2_HISTORICAL_PROOF_API_NO_AUTH=DENY",
);
console.log(
  "R10C2_HISTORICAL_PROOF_API_VIEWER=DENY",
);
console.log(
  "R10C2_HISTORICAL_PROOF_API_VALID=ALLOW",
);
console.log(
  "R10C2_HISTORICAL_PROOF_API_CHANGED_REVISION=DENY",
);
console.log(
  "R10C2_PROVIDER_CALLS=ZERO",
);
console.log(
  "R10C2_LLM_CALLS=ZERO",
);
console.log(
  "ADMISSARY_R10C2_ATTESTATION_CI_ADMISSION_GATE=PASS",
);

// Current CI must be exercised directly, separately from historical proof checks.
const currentCi = spawnSync(process.execPath, ['--test','--test-reporter=tap','--test-name-pattern=NEW-01','tests/freeze-closure.test.mjs'], {encoding:'utf8',timeout:120000});
await writeFile('results/r10c2/CURRENT_CI_AUTHORITY.tap',currentCi.stdout+currentCi.stderr);
if(currentCi.status!==0 || !/^ok \d+ - NEW-01/m.test(currentCi.stdout) || /^not ok /m.test(currentCi.stdout))throw new Error('Current CI authority regression failed: '+currentCi.stdout+currentCi.stderr);
console.log('R10C2_CURRENT_AUTHORITY_CI=PASS');
