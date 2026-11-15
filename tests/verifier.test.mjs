import test from "node:test";
import assert from "node:assert/strict";

import {
  buildQualificationManifest,
  parseDeploymentVerificationContext,
  parseQualificationManifest,
  verifyDeploymentManifest,
  verifyDeploymentManifestUnknown,
} from "../dist/index.js";

const context = {
  schema:
    "admissary-deployment-context/v1",
  candidate: {
    repository:
      "example/qualified-model",
    revision:
      "0123456789abcdef0123456789abcdef01234567",
    tokenizerRevision:
      "89abcdef0123456789abcdef0123456789abcdef",
    artifactManifestDigest:
      "artifact-manifest-digest",
  },
  contract: {
    id:
      "banking-support-prod",
    version:
      "1.0.0",
    digest:
      "contract-digest",
  },
  policyPack: {
    version:
      "1.0.0",
    digest:
      "policy-digest",
  },
  evaluation: {
    suite:
      "banking-routing-v1",
    digest:
      "suite-digest",
  },
  evidenceGraph: {
    rootDigest:
      "evidence-root-digest",
  },
};

function validManifest() {
  return buildQualificationManifest({
    schema:
      "qualification-manifest/v1",
    candidate: {
      ...context.candidate,
    },
    contract: {
      ...context.contract,
    },
    policyPack: {
      ...context.policyPack,
    },
    evaluation: {
      ...context.evaluation,
    },
    evidenceGraph: {
      ...context.evidenceGraph,
    },
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

test("verifier allows an intact qualified approved current matching manifest", () => {
  const result =
    verifyDeploymentManifest(
      validManifest(),
      parseDeploymentVerificationContext(
        context,
      ),
    );

  assert.equal(
    result.allowed,
    true,
  );
  assert.deepEqual(
    result.reasons,
    [],
  );
});

test("verifier denies payload tampering even when context would otherwise match", () => {
  const manifest =
    validManifest();

  manifest.candidate.revision =
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  const result =
    verifyDeploymentManifest(
      manifest,
      parseDeploymentVerificationContext(
        context,
      ),
    );

  assert.equal(
    result.allowed,
    false,
  );
  assert.equal(
    result.reasons.length,
    1,
  );
  assert.equal(
    result.reasons[0].code,
    "MANIFEST_INTEGRITY_ERROR",
  );
});

test("self-consistent manifest with changed model revision is denied against current context", () => {
  const changed =
    buildQualificationManifest({
      schema:
        "qualification-manifest/v1",
      candidate: {
        ...context.candidate,
        revision:
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
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
          "QUALIFIED",
      },
      authorization: {
        state:
          "APPROVED",
      },
      validity: {
        state:
          "CURRENT",
      },
    });

  const result =
    verifyDeploymentManifest(
      changed,
      parseDeploymentVerificationContext(
        context,
      ),
    );

  assert.equal(
    result.allowed,
    false,
  );
  assert.ok(
    result.reasons.some(
      (reason) =>
        reason.code ===
        "CANDIDATE_REVISION_MISMATCH",
    ),
  );
});

test("self-consistent stale manifest is denied", () => {
  const manifest =
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
          "QUALIFIED",
      },
      authorization: {
        state:
          "APPROVED",
      },
      validity: {
        state:
          "STALE",
      },
    });

  const result =
    verifyDeploymentManifest(
      manifest,
      parseDeploymentVerificationContext(
        context,
      ),
    );

  assert.equal(
    result.allowed,
    false,
  );
  assert.ok(
    result.reasons.some(
      (reason) =>
        reason.code ===
        "VALIDITY_NOT_CURRENT",
    ),
  );
});

test("self-consistent unapproved manifest is denied", () => {
  const manifest =
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
          "QUALIFIED",
      },
      authorization: {
        state:
          "PENDING",
      },
      validity: {
        state:
          "CURRENT",
      },
    });

  const result =
    verifyDeploymentManifest(
      manifest,
      parseDeploymentVerificationContext(
        context,
      ),
    );

  assert.equal(
    result.allowed,
    false,
  );
  assert.ok(
    result.reasons.some(
      (reason) =>
        reason.code ===
        "AUTHORIZATION_NOT_APPROVED",
    ),
  );
});

test("self-consistent non-qualified manifest is denied", () => {
  const manifest =
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
          "APPROVED",
      },
      validity: {
        state:
          "CURRENT",
      },
    });

  const result =
    verifyDeploymentManifest(
      manifest,
      parseDeploymentVerificationContext(
        context,
      ),
    );

  assert.equal(
    result.allowed,
    false,
  );
  assert.ok(
    result.reasons.some(
      (reason) =>
        reason.code ===
        "QUALIFICATION_NOT_QUALIFIED",
    ),
  );
});

test("contract, policy, evaluation, artifact, tokenizer and evidence-root mismatches are all denied", () => {
  const changedContext =
    structuredClone(context);

  changedContext.candidate.tokenizerRevision =
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  changedContext.candidate.artifactManifestDigest =
    "other-artifact";
  changedContext.contract.digest =
    "other-contract";
  changedContext.policyPack.digest =
    "other-policy";
  changedContext.evaluation.digest =
    "other-suite";
  changedContext.evidenceGraph.rootDigest =
    "other-root";

  const result =
    verifyDeploymentManifest(
      validManifest(),
      parseDeploymentVerificationContext(
        changedContext,
      ),
    );

  const codes =
    new Set(
      result.reasons.map(
        (reason) => reason.code,
      ),
    );

  for (const code of [
    "TOKENIZER_REVISION_MISMATCH",
    "ARTIFACT_MANIFEST_DIGEST_MISMATCH",
    "CONTRACT_DIGEST_MISMATCH",
    "POLICY_DIGEST_MISMATCH",
    "EVALUATION_DIGEST_MISMATCH",
    "EVIDENCE_GRAPH_ROOT_MISMATCH",
  ]) {
    assert.ok(
      codes.has(code),
      `expected ${code}`,
    );
  }

  assert.equal(
    result.allowed,
    false,
  );
});

test("strict manifest parser rejects unexpected fields", () => {
  const raw =
    validManifest();

  raw.attackerField = true;

  assert.throws(
    () =>
      parseQualificationManifest(
        raw,
      ),
    /keys mismatch/,
  );
});

test("strict context parser rejects unexpected fields", () => {
  const raw =
    structuredClone(context);

  raw.extra = true;

  assert.throws(
    () =>
      parseDeploymentVerificationContext(
        raw,
      ),
    /keys mismatch/,
  );
});

test("unknown-input verifier fails closed on malformed manifest", () => {
  const result =
    verifyDeploymentManifestUnknown(
      {
        schema:
          "qualification-manifest/v1",
      },
      context,
    );

  assert.equal(
    result.allowed,
    false,
  );
  assert.equal(
    result.reasons[0].code,
    "MANIFEST_SCHEMA_ERROR",
  );
});

test("verifier performs no network fetch", () => {
  const originalFetch =
    globalThis.fetch;

  globalThis.fetch = () => {
    throw new Error(
      "network must never be used by verifier",
    );
  };

  try {
    const result =
      verifyDeploymentManifest(
        validManifest(),
        parseDeploymentVerificationContext(
          context,
        ),
      );

    assert.equal(
      result.allowed,
      true,
    );
  } finally {
    globalThis.fetch =
      originalFetch;
  }
});
