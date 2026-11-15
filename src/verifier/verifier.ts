import {
  digestCanonicalJson,
} from "../qualification/canonical.js";
import type {
  QualificationManifest,
} from "../qualification/manifest.js";
import {
  verifyQualificationManifest,
} from "../qualification/manifest.js";
import type {
  AuthorizationState,
  QualificationState,
  ValidityState,
} from "../qualification/types.js";

export const DEPLOYMENT_CONTEXT_SCHEMA =
  "admissary-deployment-context/v1" as const;

export interface DeploymentVerificationContext {
  schema: typeof DEPLOYMENT_CONTEXT_SCHEMA;

  candidate: {
    repository: string;
    revision: string;
    tokenizerRevision: string;
    artifactManifestDigest: string;
  };

  contract: {
    id: string;
    version: string;
    digest: string;
  };

  policyPack: {
    version: string;
    digest: string;
  };

  evaluation: {
    suite: string;
    digest: string;
  };

  evidenceGraph: {
    rootDigest: string;
  };
}

export type VerificationReasonCode =
  | "OPERATIONAL_SCOPE_MISMATCH"
  | "MANIFEST_SCHEMA_ERROR"
  | "MANIFEST_INTEGRITY_ERROR"
  | "QUALIFICATION_NOT_QUALIFIED"
  | "AUTHORIZATION_NOT_APPROVED"
  | "VALIDITY_NOT_CURRENT"
  | "CANDIDATE_REPOSITORY_MISMATCH"
  | "CANDIDATE_REVISION_MISMATCH"
  | "TOKENIZER_REVISION_MISMATCH"
  | "ARTIFACT_MANIFEST_DIGEST_MISMATCH"
  | "CONTRACT_ID_MISMATCH"
  | "CONTRACT_VERSION_MISMATCH"
  | "CONTRACT_DIGEST_MISMATCH"
  | "POLICY_VERSION_MISMATCH"
  | "POLICY_DIGEST_MISMATCH"
  | "EVALUATION_SUITE_MISMATCH"
  | "EVALUATION_DIGEST_MISMATCH"
  | "EVIDENCE_GRAPH_ROOT_MISMATCH";

export interface VerificationReason {
  code: VerificationReasonCode;
  detail: string;
}

export interface VerificationResult {
  schema: "admissary-verification-result/v1";
  allowed: boolean;
  manifestDigest: string | null;
  contextDigest: string;
  reasons: VerificationReason[];
}

export class ManifestSchemaError extends Error {
  readonly code =
    "MANIFEST_SCHEMA_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "ManifestSchemaError";
  }
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function exactKeys(
  record: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual =
    Object.keys(record).sort();
  const wanted =
    [...expected].sort();

  if (
    JSON.stringify(actual) !==
    JSON.stringify(wanted)
  ) {
    throw new ManifestSchemaError(
      `${label} keys mismatch: expected ${wanted.join(",")}, got ${actual.join(",")}`,
    );
  }
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = record[key];

  if (
    typeof value !== "string" ||
    value.trim() === ""
  ) {
    throw new ManifestSchemaError(
      `${label}.${key} must be a non-empty string`,
    );
  }

  return value;
}

function assertQualificationState(
  value: unknown,
): QualificationState {
  const allowed: QualificationState[] = [
    "QUALIFIED",
    "UNFIT",
    "DISQUALIFIED",
    "REVIEW_REQUIRED",
    "INCOMPLETE",
    "ERROR",
  ];

  if (
    typeof value !== "string" ||
    !allowed.includes(
      value as QualificationState,
    )
  ) {
    throw new ManifestSchemaError(
      `Invalid qualification state: ${String(value)}`,
    );
  }

  return value as QualificationState;
}

function assertAuthorizationState(
  value: unknown,
): AuthorizationState {
  const allowed: AuthorizationState[] = [
    "NOT_REQUESTED",
    "PENDING",
    "APPROVED",
    "REVOKED",
  ];

  if (
    typeof value !== "string" ||
    !allowed.includes(
      value as AuthorizationState,
    )
  ) {
    throw new ManifestSchemaError(
      `Invalid authorization state: ${String(value)}`,
    );
  }

  return value as AuthorizationState;
}

function assertValidityState(
  value: unknown,
): ValidityState {
  const allowed: ValidityState[] = [
    "CURRENT",
    "STALE",
  ];

  if (
    typeof value !== "string" ||
    !allowed.includes(
      value as ValidityState,
    )
  ) {
    throw new ManifestSchemaError(
      `Invalid validity state: ${String(value)}`,
    );
  }

  return value as ValidityState;
}

function nestedRecord(
  parent: Record<string, unknown>,
  key: string,
  label: string,
): Record<string, unknown> {
  const value = parent[key];

  if (!isRecord(value)) {
    throw new ManifestSchemaError(
      `${label}.${key} must be an object`,
    );
  }

  return value;
}

export function parseQualificationManifest(
  raw: unknown,
): QualificationManifest {
  if (!isRecord(raw)) {
    throw new ManifestSchemaError(
      "Qualification manifest must be an object",
    );
  }

  exactKeys(
    raw,
    [
      "schema",
      "candidate",
      "contract",
      "policyPack",
      "evaluation",
      "evidenceGraph",
      "qualification",
      "authorization",
      "validity",
      "manifestDigest",
    ],
    "manifest",
  );

  if (
    raw.schema !==
    "qualification-manifest/v1"
  ) {
    throw new ManifestSchemaError(
      `Unsupported manifest schema: ${String(raw.schema)}`,
    );
  }

  const candidate =
    nestedRecord(
      raw,
      "candidate",
      "manifest",
    );

  exactKeys(
    candidate,
    [
      "repository",
      "revision",
      "tokenizerRevision",
      "artifactManifestDigest",
    ],
    "manifest.candidate",
  );

  const contract =
    nestedRecord(
      raw,
      "contract",
      "manifest",
    );

  exactKeys(
    contract,
    [
      "id",
      "version",
      "digest",
    ],
    "manifest.contract",
  );

  const policyPack =
    nestedRecord(
      raw,
      "policyPack",
      "manifest",
    );

  exactKeys(
    policyPack,
    [
      "version",
      "digest",
    ],
    "manifest.policyPack",
  );

  const evaluation =
    nestedRecord(
      raw,
      "evaluation",
      "manifest",
    );

  exactKeys(
    evaluation,
    [
      "suite",
      "digest",
    ],
    "manifest.evaluation",
  );

  const evidenceGraph =
    nestedRecord(
      raw,
      "evidenceGraph",
      "manifest",
    );

  exactKeys(
    evidenceGraph,
    ["rootDigest"],
    "manifest.evidenceGraph",
  );

  const qualification =
    nestedRecord(
      raw,
      "qualification",
      "manifest",
    );

  exactKeys(
    qualification,
    ["state"],
    "manifest.qualification",
  );

  const authorization =
    nestedRecord(
      raw,
      "authorization",
      "manifest",
    );

  exactKeys(
    authorization,
    ["state"],
    "manifest.authorization",
  );

  const validity =
    nestedRecord(
      raw,
      "validity",
      "manifest",
    );

  exactKeys(
    validity,
    ["state"],
    "manifest.validity",
  );

  return {
    schema:
      "qualification-manifest/v1",
    candidate: {
      repository:
        requiredString(
          candidate,
          "repository",
          "manifest.candidate",
        ),
      revision:
        requiredString(
          candidate,
          "revision",
          "manifest.candidate",
        ),
      tokenizerRevision:
        requiredString(
          candidate,
          "tokenizerRevision",
          "manifest.candidate",
        ),
      artifactManifestDigest:
        requiredString(
          candidate,
          "artifactManifestDigest",
          "manifest.candidate",
        ),
    },
    contract: {
      id:
        requiredString(
          contract,
          "id",
          "manifest.contract",
        ),
      version:
        requiredString(
          contract,
          "version",
          "manifest.contract",
        ),
      digest:
        requiredString(
          contract,
          "digest",
          "manifest.contract",
        ),
    },
    policyPack: {
      version:
        requiredString(
          policyPack,
          "version",
          "manifest.policyPack",
        ),
      digest:
        requiredString(
          policyPack,
          "digest",
          "manifest.policyPack",
        ),
    },
    evaluation: {
      suite:
        requiredString(
          evaluation,
          "suite",
          "manifest.evaluation",
        ),
      digest:
        requiredString(
          evaluation,
          "digest",
          "manifest.evaluation",
        ),
    },
    evidenceGraph: {
      rootDigest:
        requiredString(
          evidenceGraph,
          "rootDigest",
          "manifest.evidenceGraph",
        ),
    },
    qualification: {
      state:
        assertQualificationState(
          qualification.state,
        ),
    },
    authorization: {
      state:
        assertAuthorizationState(
          authorization.state,
        ),
    },
    validity: {
      state:
        assertValidityState(
          validity.state,
        ),
    },
    manifestDigest:
      requiredString(
        raw,
        "manifestDigest",
        "manifest",
      ),
  };
}

export function parseDeploymentVerificationContext(
  raw: unknown,
): DeploymentVerificationContext {
  if (!isRecord(raw)) {
    throw new ManifestSchemaError(
      "Deployment verification context must be an object",
    );
  }

  exactKeys(
    raw,
    [
      "schema",
      "candidate",
      "contract",
      "policyPack",
      "evaluation",
      "evidenceGraph",
    ],
    "context",
  );

  if (
    raw.schema !==
    DEPLOYMENT_CONTEXT_SCHEMA
  ) {
    throw new ManifestSchemaError(
      `Unsupported deployment context schema: ${String(raw.schema)}`,
    );
  }

  const candidate =
    nestedRecord(
      raw,
      "candidate",
      "context",
    );

  exactKeys(
    candidate,
    [
      "repository",
      "revision",
      "tokenizerRevision",
      "artifactManifestDigest",
    ],
    "context.candidate",
  );

  const contract =
    nestedRecord(
      raw,
      "contract",
      "context",
    );

  exactKeys(
    contract,
    [
      "id",
      "version",
      "digest",
    ],
    "context.contract",
  );

  const policyPack =
    nestedRecord(
      raw,
      "policyPack",
      "context",
    );

  exactKeys(
    policyPack,
    [
      "version",
      "digest",
    ],
    "context.policyPack",
  );

  const evaluation =
    nestedRecord(
      raw,
      "evaluation",
      "context",
    );

  exactKeys(
    evaluation,
    [
      "suite",
      "digest",
    ],
    "context.evaluation",
  );

  const evidenceGraph =
    nestedRecord(
      raw,
      "evidenceGraph",
      "context",
    );

  exactKeys(
    evidenceGraph,
    ["rootDigest"],
    "context.evidenceGraph",
  );

  return {
    schema:
      DEPLOYMENT_CONTEXT_SCHEMA,
    candidate: {
      repository:
        requiredString(
          candidate,
          "repository",
          "context.candidate",
        ),
      revision:
        requiredString(
          candidate,
          "revision",
          "context.candidate",
        ),
      tokenizerRevision:
        requiredString(
          candidate,
          "tokenizerRevision",
          "context.candidate",
        ),
      artifactManifestDigest:
        requiredString(
          candidate,
          "artifactManifestDigest",
          "context.candidate",
        ),
    },
    contract: {
      id:
        requiredString(
          contract,
          "id",
          "context.contract",
        ),
      version:
        requiredString(
          contract,
          "version",
          "context.contract",
        ),
      digest:
        requiredString(
          contract,
          "digest",
          "context.contract",
        ),
    },
    policyPack: {
      version:
        requiredString(
          policyPack,
          "version",
          "context.policyPack",
        ),
      digest:
        requiredString(
          policyPack,
          "digest",
          "context.policyPack",
        ),
    },
    evaluation: {
      suite:
        requiredString(
          evaluation,
          "suite",
          "context.evaluation",
        ),
      digest:
        requiredString(
          evaluation,
          "digest",
          "context.evaluation",
        ),
    },
    evidenceGraph: {
      rootDigest:
        requiredString(
          evidenceGraph,
          "rootDigest",
          "context.evidenceGraph",
        ),
    },
  };
}

function pushMismatch(
  reasons: VerificationReason[],
  condition: boolean,
  code: VerificationReasonCode,
  detail: string,
): void {
  if (condition) {
    reasons.push({
      code,
      detail,
    });
  }
}

export function verifyDeploymentManifest(
  manifest: QualificationManifest,
  context: DeploymentVerificationContext,
): VerificationResult {
  const contextDigest =
    digestCanonicalJson(context);

  if (
    !verifyQualificationManifest(
      manifest,
    )
  ) {
    return {
      schema:
        "admissary-verification-result/v1",
      allowed: false,
      manifestDigest:
        manifest.manifestDigest,
      contextDigest,
      reasons: [
        {
          code:
            "MANIFEST_INTEGRITY_ERROR",
          detail:
            "Manifest digest does not match canonical payload",
        },
      ],
    };
  }

  const reasons: VerificationReason[] = [];

  pushMismatch(
    reasons,
    manifest.qualification.state !==
      "QUALIFIED",
    "QUALIFICATION_NOT_QUALIFIED",
    `qualification=${manifest.qualification.state}`,
  );

  pushMismatch(
    reasons,
    manifest.authorization.state !==
      "APPROVED",
    "AUTHORIZATION_NOT_APPROVED",
    `authorization=${manifest.authorization.state}`,
  );

  pushMismatch(
    reasons,
    manifest.validity.state !==
      "CURRENT",
    "VALIDITY_NOT_CURRENT",
    `validity=${manifest.validity.state}`,
  );

  pushMismatch(
    reasons,
    manifest.candidate.repository !==
      context.candidate.repository,
    "CANDIDATE_REPOSITORY_MISMATCH",
    `manifest=${manifest.candidate.repository}; current=${context.candidate.repository}`,
  );

  pushMismatch(
    reasons,
    manifest.candidate.revision !==
      context.candidate.revision,
    "CANDIDATE_REVISION_MISMATCH",
    `manifest=${manifest.candidate.revision}; current=${context.candidate.revision}`,
  );

  pushMismatch(
    reasons,
    manifest.candidate.tokenizerRevision !==
      context.candidate.tokenizerRevision,
    "TOKENIZER_REVISION_MISMATCH",
    `manifest=${manifest.candidate.tokenizerRevision}; current=${context.candidate.tokenizerRevision}`,
  );

  pushMismatch(
    reasons,
    manifest.candidate.artifactManifestDigest !==
      context.candidate.artifactManifestDigest,
    "ARTIFACT_MANIFEST_DIGEST_MISMATCH",
    `manifest=${manifest.candidate.artifactManifestDigest}; current=${context.candidate.artifactManifestDigest}`,
  );

  pushMismatch(
    reasons,
    manifest.contract.id !==
      context.contract.id,
    "CONTRACT_ID_MISMATCH",
    `manifest=${manifest.contract.id}; current=${context.contract.id}`,
  );

  pushMismatch(
    reasons,
    manifest.contract.version !==
      context.contract.version,
    "CONTRACT_VERSION_MISMATCH",
    `manifest=${manifest.contract.version}; current=${context.contract.version}`,
  );

  pushMismatch(
    reasons,
    manifest.contract.digest !==
      context.contract.digest,
    "CONTRACT_DIGEST_MISMATCH",
    `manifest=${manifest.contract.digest}; current=${context.contract.digest}`,
  );

  pushMismatch(
    reasons,
    manifest.policyPack.version !==
      context.policyPack.version,
    "POLICY_VERSION_MISMATCH",
    `manifest=${manifest.policyPack.version}; current=${context.policyPack.version}`,
  );

  pushMismatch(
    reasons,
    manifest.policyPack.digest !==
      context.policyPack.digest,
    "POLICY_DIGEST_MISMATCH",
    `manifest=${manifest.policyPack.digest}; current=${context.policyPack.digest}`,
  );

  pushMismatch(
    reasons,
    manifest.evaluation.suite !==
      context.evaluation.suite,
    "EVALUATION_SUITE_MISMATCH",
    `manifest=${manifest.evaluation.suite}; current=${context.evaluation.suite}`,
  );

  pushMismatch(
    reasons,
    manifest.evaluation.digest !==
      context.evaluation.digest,
    "EVALUATION_DIGEST_MISMATCH",
    `manifest=${manifest.evaluation.digest}; current=${context.evaluation.digest}`,
  );

  pushMismatch(
    reasons,
    manifest.evidenceGraph.rootDigest !==
      context.evidenceGraph.rootDigest,
    "EVIDENCE_GRAPH_ROOT_MISMATCH",
    `manifest=${manifest.evidenceGraph.rootDigest}; current=${context.evidenceGraph.rootDigest}`,
  );

  return {
    schema:
      "admissary-verification-result/v1",
    allowed:
      reasons.length === 0,
    manifestDigest:
      manifest.manifestDigest,
    contextDigest,
    reasons,
  };
}

export function verifyDeploymentManifestUnknown(
  rawManifest: unknown,
  rawContext: unknown,
): VerificationResult {
  let context:
    DeploymentVerificationContext;

  try {
    context =
      parseDeploymentVerificationContext(
        rawContext,
      );
  } catch (error) {
    return {
      schema:
        "admissary-verification-result/v1",
      allowed: false,
      manifestDigest: null,
      contextDigest:
        digestCanonicalJson({
          invalidContext: true,
        }),
      reasons: [
        {
          code:
            "MANIFEST_SCHEMA_ERROR",
          detail:
            error instanceof Error
              ? error.message
              : String(error),
        },
      ],
    };
  }

  try {
    const manifest =
      parseQualificationManifest(
        rawManifest,
      );

    return verifyDeploymentManifest(
      manifest,
      context,
    );
  } catch (error) {
    return {
      schema:
        "admissary-verification-result/v1",
      allowed: false,
      manifestDigest: null,
      contextDigest:
        digestCanonicalJson(context),
      reasons: [
        {
          code:
            "MANIFEST_SCHEMA_ERROR",
          detail:
            error instanceof Error
              ? error.message
              : String(error),
        },
      ],
    };
  }
}

/** Historical/offline manifest consistency only; no revocation or current authority. */
export const verifyHistoricalManifestProofUnknown = verifyDeploymentManifestUnknown;
