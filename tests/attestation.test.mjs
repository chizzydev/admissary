import { digestCanonicalJson } from "../dist/index.js";
const OPERATIONAL_SCOPE = {deploymentId:"fixture-deployment",qualificationRunId:"fixture-run",environmentId:"fixture-environment",workloadId:"fixture-workload"};
import test from "node:test";
import assert from "node:assert/strict";
import {
  generateKeyPairSync,
} from "node:crypto";

import {
  buildQualificationAttestationStatement,
  buildQualificationManifest,
  signQualificationAttestation,
  verifyHistoricalAttestationProof,
  verifySignedQualificationAttestation,
} from "../dist/index.js";

const context = {
  schema:
    "admissary-deployment-context/v1",
  candidate: {
    repository:
      "example/model",
    revision:
      "0123456789abcdef0123456789abcdef01234567",
    tokenizerRevision:
      "89abcdef0123456789abcdef0123456789abcdef",
    artifactManifestDigest:
      digestCanonicalJson({fixture:"artifact-digest"}),
  },
  contract: {
    id: "contract",
    version: "1.0.0",
    digest:
      digestCanonicalJson({fixture:"contract-digest"}),
  },
  policyPack: {
    version: "1.0.0",
    digest:
      digestCanonicalJson({fixture:"policy-digest"}),
  },
  evaluation: {
    suite: "suite",
    digest:
      digestCanonicalJson({fixture:"suite-digest"}),
  },
  evidenceGraph: {
    rootDigest:
      digestCanonicalJson({fixture:"root-digest"}),
  },
};

function manifest() {
  return buildQualificationManifest({
    schema:
      "qualification-manifest/v1",
    candidate:
      context.candidate,
    contract:
      context.contract,
    policyPack:
      context.policyPack,
    evaluation:
      context.evaluation,
    evidenceGraph:
      context.evidenceGraph,
    qualification: {
      state: "QUALIFIED",
    },
    authorization: {
      state: "APPROVED",
    },
    validity: {
      state: "CURRENT",
    },
  });
}

function signedFixture() {
  const {
    publicKey,
    privateKey,
  } =
    generateKeyPairSync(
      "ed25519",
    );

  const keyId =
    "test-key";

  const statement =
    buildQualificationAttestationStatement({
      operationalScope: OPERATIONAL_SCOPE,
      manifest:
        manifest(),
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
      privateKeyPem:
        privateKey
          .export({
            type:
              "pkcs8",
            format:
              "pem",
          })
          .toString(),
      keyId,
    });

  return {
    attestation,
    trustStore: {
      [keyId]:
        publicKey
          .export({
            type:
              "spki",
            format:
              "pem",
          })
          .toString(),
    },
  };
}

test("Ed25519 signed qualification attestation verifies offline", () => {
  const {
    attestation,
    trustStore,
  } =
    signedFixture();

  const result =
    verifySignedQualificationAttestation(
      attestation,
      trustStore,
    );

  assert.equal(
    result.valid,
    true,
  );
  assert.deepEqual(
    result.reasons,
    [],
  );
});

test("attestation issuer rejects non-qualified manifest", () => {
  const invalid =
    buildQualificationManifest({
      schema:
        "qualification-manifest/v1",
      candidate:
        context.candidate,
      contract:
        context.contract,
      policyPack:
        context.policyPack,
      evaluation:
        context.evaluation,
      evidenceGraph:
        context.evidenceGraph,
      qualification: {
        state:
          "REVIEW_REQUIRED",
      },
      authorization: {
        state:
          "NOT_REQUESTED",
      },
      validity: {
        state:
          "CURRENT",
      },
    });

  assert.throws(
    () =>
      buildQualificationAttestationStatement({
      operationalScope: OPERATIONAL_SCOPE,
        manifest:
          invalid,
        deploymentContext:
          context,
        exactArtifactBindingProven:
          false,
        issuedAt:
          "2026-11-14T20:00:00.000Z",
        keyId:
          "test",
      }),
    /Qualification must be QUALIFIED/,
  );
});

test("attestation tamper and wrong trusted key fail closed", () => {
  const {
    attestation,
    trustStore,
  } =
    signedFixture();

  const tampered =
    structuredClone(
      attestation,
    );

  tampered.statement
    .subject[0].name =
    "attacker/model";

  assert.equal(
    verifySignedQualificationAttestation(
      tampered,
      trustStore,
    ).valid,
    false,
  );

  const {
    publicKey:
      wrongPublicKey,
  } =
    generateKeyPairSync(
      "ed25519",
    );

  assert.equal(
    verifySignedQualificationAttestation(
      attestation,
      {
        "test-key":
          wrongPublicKey
            .export({
              type:
                "spki",
              format:
                "pem",
            })
            .toString(),
      },
    ).valid,
    false,
  );
});

test("signed approval cannot authorize a changed deployment context", () => {
  const {
    attestation,
    trustStore,
  } =
    signedFixture();

  assert.equal(
    verifyHistoricalAttestationProof({
      operationalScope: OPERATIONAL_SCOPE,
      attestation,
      currentContext:
        context,
      trustStore,
    }).allowed,
    true,
  );

  const changed =
    structuredClone(
      context,
    );

  changed.candidate.revision =
    "different-revision";

  assert.equal(
    verifyHistoricalAttestationProof({
      operationalScope: OPERATIONAL_SCOPE,
      attestation,
      currentContext:
        changed,
      trustStore,
    }).allowed,
    false,
  );
});
