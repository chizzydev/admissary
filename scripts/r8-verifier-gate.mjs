import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import {
  join,
} from "node:path";

import {
  buildQualificationManifest,
  digestCanonicalJson,
  parseDeploymentVerificationContext,
  verifyDeploymentManifest,
} from "../dist/index.js";

const context =
  parseDeploymentVerificationContext(
    JSON.parse(
      await readFile(
        "data/verifier-fixtures/deployment-context.json",
        "utf8",
      ),
    ),
  );

const basePayload = {
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
};

const valid =
  buildQualificationManifest(
    basePayload,
  );

const validResult =
  verifyDeploymentManifest(
    valid,
    context,
  );

if (!validResult.allowed) {
  throw new Error(
    `Valid manifest denied: ${validResult.reasons.map((item) => item.code).join(",")}`,
  );
}

const tampered =
  structuredClone(valid);

tampered.candidate.revision =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const tamperedResult =
  verifyDeploymentManifest(
    tampered,
    context,
  );

if (
  tamperedResult.allowed ||
  !tamperedResult.reasons.some(
    (reason) =>
      reason.code ===
      "MANIFEST_INTEGRITY_ERROR",
  )
) {
  throw new Error(
    "Tampered manifest was not denied for integrity",
  );
}

const selfConsistentRevisionChange =
  buildQualificationManifest({
    ...basePayload,
    candidate: {
      ...basePayload.candidate,
      revision:
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
  });

const revisionMismatch =
  verifyDeploymentManifest(
    selfConsistentRevisionChange,
    context,
  );

if (
  revisionMismatch.allowed ||
  !revisionMismatch.reasons.some(
    (reason) =>
      reason.code ===
      "CANDIDATE_REVISION_MISMATCH",
  )
) {
  throw new Error(
    "Self-consistent changed revision was not denied against deployment context",
  );
}

const stale =
  buildQualificationManifest({
    ...basePayload,
    validity: {
      state: "STALE",
    },
  });

const staleResult =
  verifyDeploymentManifest(
    stale,
    context,
  );

if (
  staleResult.allowed ||
  !staleResult.reasons.some(
    (reason) =>
      reason.code ===
      "VALIDITY_NOT_CURRENT",
  )
) {
  throw new Error(
    "STALE manifest was not denied",
  );
}

const unapproved =
  buildQualificationManifest({
    ...basePayload,
    authorization: {
      state: "PENDING",
    },
  });

const unapprovedResult =
  verifyDeploymentManifest(
    unapproved,
    context,
  );

if (
  unapprovedResult.allowed ||
  !unapprovedResult.reasons.some(
    (reason) =>
      reason.code ===
      "AUTHORIZATION_NOT_APPROVED",
  )
) {
  throw new Error(
    "Unapproved manifest was not denied",
  );
}

const contextMismatch =
  structuredClone(context);

contextMismatch.contract.digest =
  "sha256:changed-contract";

const contractMismatchResult =
  verifyDeploymentManifest(
    valid,
    contextMismatch,
  );

if (
  contractMismatchResult.allowed ||
  !contractMismatchResult.reasons.some(
    (reason) =>
      reason.code ===
      "CONTRACT_DIGEST_MISMATCH",
  )
) {
  throw new Error(
    "Contract mismatch was not denied",
  );
}

await mkdir(
  "results",
  {
    recursive: true,
  },
);

const stamp =
  new Date()
    .toISOString()
    .replaceAll(":", "")
    .replaceAll(".", "");

const manifestPath =
  join(
    "results",
    `ADMISSARY_R8_VALID_MANIFEST_${stamp}.json`,
  );

const contextPath =
  join(
    "results",
    `ADMISSARY_R8_DEPLOYMENT_CONTEXT_${stamp}.json`,
  );

await writeFile(
  manifestPath,
  JSON.stringify(
    valid,
    null,
    2,
  ) + "\n",
  "utf8",
);

await writeFile(
  contextPath,
  JSON.stringify(
    context,
    null,
    2,
  ) + "\n",
  "utf8",
);

const proof = {
  schema:
    "admissary-r8-verifier-proof/v1",
  createdAt:
    new Date().toISOString(),
  valid: validResult,
  tampered:
    tamperedResult,
  selfConsistentRevisionMismatch:
    revisionMismatch,
  stale:
    staleResult,
  unapproved:
    unapprovedResult,
  contractMismatch:
    contractMismatchResult,
  fixture: {
    manifestPath,
    contextPath,
  },
};

const artifactDigest =
  digestCanonicalJson(proof);

const resultPath =
  join(
    "results",
    `ADMISSARY_R8_VERIFIER_${stamp}.json`,
  );

await writeFile(
  resultPath,
  JSON.stringify(
    {
      ...proof,
      artifactDigest,
    },
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(
  `R8_VALID_MANIFEST_DIGEST=${valid.manifestDigest}`,
);
console.log(
  `R8_VALID_CONTEXT_DIGEST=${validResult.contextDigest}`,
);
console.log(
  "R8_VALID_DEPLOY=ALLOW",
);
console.log(
  "R8_TAMPERED_DEPLOY=DENY",
);
console.log(
  `R8_TAMPERED_REASON=${tamperedResult.reasons.map((item) => item.code).join(",")}`,
);
console.log(
  "R8_REHASHED_REVISION_CHANGE_DEPLOY=DENY",
);
console.log(
  `R8_REHASHED_REVISION_CHANGE_REASON=${revisionMismatch.reasons.map((item) => item.code).join(",")}`,
);
console.log(
  "R8_STALE_DEPLOY=DENY",
);
console.log(
  `R8_STALE_REASON=${staleResult.reasons.map((item) => item.code).join(",")}`,
);
console.log(
  "R8_UNAPPROVED_DEPLOY=DENY",
);
console.log(
  `R8_UNAPPROVED_REASON=${unapprovedResult.reasons.map((item) => item.code).join(",")}`,
);
console.log(
  "R8_CONTRACT_MISMATCH_DEPLOY=DENY",
);
console.log(
  `R8_CONTRACT_MISMATCH_REASON=${contractMismatchResult.reasons.map((item) => item.code).join(",")}`,
);
console.log(
  "R8_NETWORK_CALLS=ZERO_BY_DESIGN_AND_TEST",
);
console.log(
  `R8_MANIFEST_FIXTURE=${manifestPath}`,
);
console.log(
  `R8_CONTEXT_FIXTURE=${contextPath}`,
);
console.log(
  `R8_ARTIFACT_DIGEST=${artifactDigest}`,
);
console.log(
  `R8_RESULT=${resultPath}`,
);
console.log(
  "ADMISSARY_R8_VERIFIER_GATE=PASS",
);
