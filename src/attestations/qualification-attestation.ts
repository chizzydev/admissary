import {
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";

import {
  canonicalJson,
  digestCanonicalJson,
} from "../qualification/canonical.js";
import type {
  QualificationManifest,
} from "../qualification/manifest.js";
import {
  verifyQualificationManifest,
} from "../qualification/manifest.js";
import type {
  DeploymentVerificationContext,
  VerificationReason,
} from "../verifier/verifier.js";
import {
  parseDeploymentVerificationContext, parseQualificationManifest,
  verifyDeploymentManifest,
} from "../verifier/verifier.js";

export const QUALIFICATION_ATTESTATION_TYPE =
  "https://in-toto.io/Statement/v1" as const;

export const QUALIFICATION_PREDICATE_TYPE =
  "https://admissary.dev/attestation/qualification/v1" as const;

export const SIGNED_ATTESTATION_SCHEMA =
  "admissary-signed-attestation/v1" as const;

export interface AttestationEligibility {
  qualificationState:
    QualificationManifest["qualification"]["state"];
  authorizationState:
    QualificationManifest["authorization"]["state"];
  validityState:
    QualificationManifest["validity"]["state"];
  exactArtifactBindingProven: boolean;
}

export interface OperationalScope {
  deploymentId: string;
  qualificationRunId: string;
  environmentId: string;
  workloadId: string;
}
export interface QualificationAttestationStatement {
  _type:
    typeof QUALIFICATION_ATTESTATION_TYPE;
  subject: [
    {
      name: string;
      digest: {
        sha256: string;
      };
    },
  ];
  predicateType:
    typeof QUALIFICATION_PREDICATE_TYPE | "https://admissary.dev/attestation/qualification/v2";
  predicate: {
    operationalScope?: OperationalScope;
    manifest:
      QualificationManifest;
    manifestDigest: string;
    deploymentContextDigest: string;
    exactArtifactBindingProven: true;
    issuedAt: string;
    issuer: {
      keyId: string;
    };
  };
}

export interface SignedQualificationAttestation {
  schema:
    typeof SIGNED_ATTESTATION_SCHEMA;
  algorithm: "Ed25519";
  keyId: string;
  statement:
    QualificationAttestationStatement;
  statementDigest: string;
  signature: string;
  envelopeDigest: string;
}

export interface AttestationVerificationResult {
  valid: boolean;
  keyId: string | null;
  statementDigest: string | null;
  reasons: string[];
}

export interface AdmissionFromAttestationResult {
  allowed: boolean;
  attestation:
    AttestationVerificationResult;
  deploymentVerification: {
    allowed: boolean;
    manifestDigest: string | null;
    contextDigest: string | null;
    reasons: VerificationReason[];
  };
}

export class AttestationError extends Error {
  readonly code: string;

  constructor(
    code: string,
    message: string,
  ) {
    super(message);
    this.name = "AttestationError";
    this.code = code;
  }
}

function utf8(
  value: string,
): Uint8Array {
  return new TextEncoder()
    .encode(value);
}

function bytesToBase64(
  value: Uint8Array,
): string {
  let binary = "";

  for (
    const byte of value
  ) {
    binary +=
      String.fromCharCode(byte);
  }

  return btoa(binary);
}

function base64ToBytes(
  value: string,
): Uint8Array {
  const binary =
    atob(value);

  const bytes =
    new Uint8Array(
      binary.length,
    );

  for (
    let index = 0;
    index < binary.length;
    index += 1
  ) {
    bytes[index] =
      binary.charCodeAt(
        index,
      );
  }

  return bytes;
}

export function assertAttestationEligibility(
  eligibility:
    AttestationEligibility,
): void {
  if (
    eligibility.qualificationState !==
    "QUALIFIED"
  ) {
    throw new AttestationError(
      "ATTESTATION_QUALIFICATION_REQUIRED",
      `Qualification must be QUALIFIED, got ${eligibility.qualificationState}`,
    );
  }

  if (
    eligibility.authorizationState !==
    "APPROVED"
  ) {
    throw new AttestationError(
      "ATTESTATION_APPROVAL_REQUIRED",
      `Authorization must be APPROVED, got ${eligibility.authorizationState}`,
    );
  }

  if (
    eligibility.validityState !==
    "CURRENT"
  ) {
    throw new AttestationError(
      "ATTESTATION_CURRENT_REQUIRED",
      `Validity must be CURRENT, got ${eligibility.validityState}`,
    );
  }

  if (
    !eligibility.exactArtifactBindingProven
  ) {
    throw new AttestationError(
      "ATTESTATION_EXACT_BINDING_REQUIRED",
      "Exact artifact binding must be proven before issuing a deployable attestation",
    );
  }
}

export function buildQualificationAttestationStatement(
  input: {
    manifest:
      QualificationManifest;
    deploymentContext:
      DeploymentVerificationContext;
    exactArtifactBindingProven: boolean;
    issuedAt: string;
    keyId: string;
    operationalScope?: OperationalScope;
  },
): QualificationAttestationStatement {
  assertAttestationEligibility({
    qualificationState:
      input.manifest
        .qualification.state,
    authorizationState:
      input.manifest
        .authorization.state,
    validityState:
      input.manifest
        .validity.state,
    exactArtifactBindingProven:
      input.exactArtifactBindingProven,
  });

  if (
    !verifyQualificationManifest(
      input.manifest,
    )
  ) {
    throw new AttestationError(
      "ATTESTATION_MANIFEST_INTEGRITY_ERROR",
      "Qualification manifest integrity check failed",
    );
  }

  const context =
    parseDeploymentVerificationContext(
      input.deploymentContext,
    );

  const verification =
    verifyDeploymentManifest(
      input.manifest,
      context,
    );

  if (
    !verification.allowed
  ) {
    throw new AttestationError(
      "ATTESTATION_CONTEXT_MISMATCH",
      `Manifest is not admissible for the supplied deployment context: ${verification.reasons.map((item) => item.code).join(",")}`,
    );
  }

  if (
    !input.keyId.trim()
  ) {
    throw new AttestationError(
      "ATTESTATION_KEY_ID_REQUIRED",
      "Attestation key ID must be non-empty",
    );
  }

  if (
    !input.issuedAt.trim()
  ) {
    throw new AttestationError(
      "ATTESTATION_ISSUED_AT_REQUIRED",
      "issuedAt must be non-empty",
    );
  }

  return {
    _type:
      QUALIFICATION_ATTESTATION_TYPE,
    subject: [
      {
        name:
          `${input.manifest.candidate.repository}@${input.manifest.candidate.revision}`,
        digest: {
          sha256:
            digestCanonicalJson(
              input.manifest
                .candidate,
            ),
        },
      },
    ],
    predicateType:
      input.operationalScope ? "https://admissary.dev/attestation/qualification/v2" : QUALIFICATION_PREDICATE_TYPE,
    predicate: {
      ...(input.operationalScope ? { operationalScope: structuredClone(input.operationalScope) } : {}),
      manifest:
        structuredClone(
          input.manifest,
        ),
      manifestDigest:
        input.manifest
          .manifestDigest,
      deploymentContextDigest:
        verification
          .contextDigest,
      exactArtifactBindingProven:
        true,
      issuedAt:
        input.issuedAt,
      issuer: {
        keyId:
          input.keyId,
      },
    },
  };
}

function exactKeys(value: unknown, keys: string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== keys.sort().join(",")) throw new Error("ATTESTATION_STRUCTURE_INVALID");
}
function validateStatement(s: QualificationAttestationStatement): void {
  exactKeys(s, ["_type", "subject", "predicateType", "predicate"]);
  if (s._type !== QUALIFICATION_ATTESTATION_TYPE ||
      ![QUALIFICATION_PREDICATE_TYPE, "https://admissary.dev/attestation/qualification/v2"].includes(s.predicateType) ||
      !Array.isArray(s.subject) || s.subject.length !== 1) throw new Error("ATTESTATION_STRUCTURE_INVALID");
  const v2 = s.predicateType.endsWith("/v2");
  exactKeys(s.predicate, ["manifest", "manifestDigest", "deploymentContextDigest", "exactArtifactBindingProven", "issuedAt", "issuer", ...(v2 ? ["operationalScope"] : [])]);
  exactKeys(s.predicate.issuer, ["keyId"]);
  exactKeys(s.subject[0], ["name", "digest"]); exactKeys(s.subject[0].digest, ["sha256"]);
  parseQualificationManifest(s.predicate.manifest);
  if (typeof s.predicate.issuedAt !== "string" || !Number.isFinite(Date.parse(s.predicate.issuedAt)) || new Date(s.predicate.issuedAt).toISOString() !== s.predicate.issuedAt ||
      typeof s.predicate.deploymentContextDigest !== "string" || !/^[a-f0-9]{64}$/.test(s.predicate.deploymentContextDigest)) throw new Error("ATTESTATION_STRUCTURE_INVALID");
  if (v2) {
    const scope = s.predicate.operationalScope;
    exactKeys(scope, ["deploymentId", "qualificationRunId", "environmentId", "workloadId"]);
    if (!Object.values(scope!).every(v => typeof v === "string" && v.trim())) throw new Error("ATTESTATION_SCOPE_INVALID");
    const m = s.predicate.manifest;
    if (![m.candidate.revision, m.candidate.tokenizerRevision].every(x => /^[a-f0-9]{40}$/.test(x))) throw new Error("ATTESTATION_IMMUTABLE_REVISION_REQUIRED");
    for (const digest of [m.candidate.artifactManifestDigest, m.contract.digest, m.policyPack.digest, m.evaluation.digest, m.evidenceGraph.rootDigest]) {
      if (!/^[a-f0-9]{64}$/.test(digest) || /^0+$/.test(digest)) throw new Error("ATTESTATION_CONTENT_DIGEST_REQUIRED");
    }
  }
}

export function signQualificationAttestation(
  input: {
    statement:
      QualificationAttestationStatement;
    privateKeyPem: string;
    keyId: string;
  },
): SignedQualificationAttestation {
  if (
    input.statement
      .predicate.issuer.keyId !==
    input.keyId
  ) {
    throw new AttestationError(
      "ATTESTATION_KEY_ID_MISMATCH",
      "Statement issuer key ID does not match signing key ID",
    );
  }

  validateStatement(input.statement);
  if (createPrivateKey(input.privateKeyPem).asymmetricKeyType !== "ed25519") throw new AttestationError("ATTESTATION_KEY_TYPE_INVALID", "Ed25519 signing key required");
  const statementDigest =
    digestCanonicalJson(
      input.statement,
    );

  let signature:
    Uint8Array;

  try {
    signature =
      cryptoSign(
        null,
        utf8(
          canonicalJson(
            input.statement,
          ),
        ),
        createPrivateKey(
          input.privateKeyPem,
        ),
      );
  } catch (error) {
    throw new AttestationError(
      "ATTESTATION_SIGNING_ERROR",
      error instanceof Error
        ? error.message
        : String(error),
    );
  }

  const envelopeWithoutDigest = {
    schema:
      SIGNED_ATTESTATION_SCHEMA,
    algorithm:
      "Ed25519" as const,
    keyId:
      input.keyId,
    statement:
      structuredClone(
        input.statement,
      ),
    statementDigest,
    signature:
      bytesToBase64(
        signature,
      ),
  };

  return {
    ...envelopeWithoutDigest,
    envelopeDigest:
      digestCanonicalJson(
        envelopeWithoutDigest,
      ),
  };
}

export function verifySignedQualificationAttestation(
  attestation:
    SignedQualificationAttestation,
  trustStore:
    Readonly<
      Record<
        string,
        string
      >
    >,
): AttestationVerificationResult {
  try {
    exactKeys(attestation, ["schema", "algorithm", "keyId", "statement", "statementDigest", "signature", "envelopeDigest"]);
    if (![attestation.schema, attestation.algorithm, attestation.keyId, attestation.statementDigest, attestation.signature, attestation.envelopeDigest].every(x => typeof x === "string" && x.trim())) throw new Error("ATTESTATION_STRUCTURE_INVALID");
    validateStatement(attestation.statement);
  } catch {
    return { valid: false, keyId: null, statementDigest: null, reasons: ["ATTESTATION_STRUCTURE_INVALID"] };
  }
  const reasons:
    string[] = [];

  if (
    attestation.schema !==
    SIGNED_ATTESTATION_SCHEMA
  ) {
    reasons.push(
      "ATTESTATION_SCHEMA_UNSUPPORTED",
    );
  }

  if (
    attestation.algorithm !==
    "Ed25519"
  ) {
    reasons.push(
      "ATTESTATION_ALGORITHM_UNSUPPORTED",
    );
  }

  if (
    attestation.statement
      .predicate.issuer.keyId !==
      attestation.keyId
  ) {
    reasons.push(
      "ATTESTATION_ISSUER_KEY_MISMATCH",
    );
  }

  const statementDigest =
    digestCanonicalJson(
      attestation.statement,
    );

  if (
    statementDigest !==
    attestation.statementDigest
  ) {
    reasons.push(
      "ATTESTATION_STATEMENT_DIGEST_MISMATCH",
    );
  }

  const {
    envelopeDigest,
    ...envelopeWithoutDigest
  } = attestation;

  if (
    digestCanonicalJson(
      envelopeWithoutDigest,
    ) !== envelopeDigest
  ) {
    reasons.push(
      "ATTESTATION_ENVELOPE_DIGEST_MISMATCH",
    );
  }

  const manifest =
    attestation.statement
      .predicate.manifest;

  if (
    manifest.manifestDigest !==
    attestation.statement
      .predicate.manifestDigest ||
    !verifyQualificationManifest(
      manifest,
    )
  ) {
    reasons.push(
      "ATTESTATION_MANIFEST_INTEGRITY_ERROR",
    );
  }

  if (
    attestation.statement
      .predicate
      .exactArtifactBindingProven !==
    true
  ) {
    reasons.push(
      "ATTESTATION_EXACT_BINDING_MISSING",
    );
  }

  try {
    assertAttestationEligibility({
      qualificationState:
        manifest
          .qualification.state,
      authorizationState:
        manifest
          .authorization.state,
      validityState:
        manifest.validity.state,
      exactArtifactBindingProven:
        attestation.statement
          .predicate
          .exactArtifactBindingProven,
    });
  } catch (error) {
    reasons.push(
      error instanceof
        AttestationError
        ? error.code
        : "ATTESTATION_ELIGIBILITY_ERROR",
    );
  }

  const expectedSubject = {
    name:
      `${manifest.candidate.repository}@${manifest.candidate.revision}`,
    digest: {
      sha256:
        digestCanonicalJson(
          manifest.candidate,
        ),
    },
  };

  const subject =
    attestation.statement
      .subject[0];

  if (
    !subject ||
    canonicalJson(
      subject,
    ) !==
      canonicalJson(
        expectedSubject,
      )
  ) {
    reasons.push(
      "ATTESTATION_SUBJECT_MISMATCH",
    );
  }

  const publicKeyPem =
    trustStore[
      attestation.keyId
    ];

  if (!publicKeyPem) {
    reasons.push(
      "ATTESTATION_UNTRUSTED_KEY",
    );
  } else {
    try {
      if (createPublicKey(publicKeyPem).asymmetricKeyType !== "ed25519") throw new Error("Ed25519 key required");
      const signatureValid =
        cryptoVerify(
          null,
          utf8(
            canonicalJson(
              attestation.statement,
            ),
          ),
          createPublicKey(
            publicKeyPem,
          ),
          base64ToBytes(
            attestation.signature,
          ),
        );

      if (
        !signatureValid
      ) {
        reasons.push(
          "ATTESTATION_SIGNATURE_INVALID",
        );
      }
    } catch {
      reasons.push(
        "ATTESTATION_SIGNATURE_INVALID",
      );
    }
  }

  return {
    valid:
      reasons.length === 0,
    keyId:
      attestation.keyId ??
      null,
    statementDigest:
      attestation
        .statementDigest ??
      null,
    reasons,
  };
}

/** @deprecated Historical proof consistency only. Use ProductApplicationService.admitCurrentDeployment for current authority. */
export function verifyHistoricalAttestationProof(
  input: {
    operationalScope?: OperationalScope;
    attestation:
      SignedQualificationAttestation;
    currentContext:
      DeploymentVerificationContext;
    trustStore:
      Readonly<
        Record<
          string,
          string
        >
      >;
  },
): AdmissionFromAttestationResult {
  const attestation =
    verifySignedQualificationAttestation(
      input.attestation,
      input.trustStore,
    );

  if (
    !attestation.valid
  ) {
    return {
      allowed: false,
      attestation,
      deploymentVerification: {
        allowed: false,
        manifestDigest:
          input.attestation
            ?.statement
            ?.predicate
            ?.manifest
            ?.manifestDigest ??
          null,
        contextDigest: null,
        reasons: [],
      },
    };
  }

  const signedScope = input.attestation.statement.predicate.operationalScope;
  if (!input.attestation.statement.predicateType.endsWith("/v2") || !input.operationalScope || !signedScope ||
      canonicalJson(input.operationalScope) !== canonicalJson(signedScope)) {
    return { allowed: false, attestation, deploymentVerification: {
      allowed: false, manifestDigest: input.attestation.statement.predicate.manifestDigest,
      contextDigest: null, reasons: [{ code: "OPERATIONAL_SCOPE_MISMATCH", detail: "Current authority requires v2 proof and an independently supplied matching deployment/run/environment/workload scope" }],
    } };
  }
  const context =
    parseDeploymentVerificationContext(
      input.currentContext,
    );

  const manifest =
    input.attestation.statement
      .predicate.manifest;

  const deploymentVerification =
    verifyDeploymentManifest(
      manifest,
      context,
    );

  if (
    deploymentVerification
      .contextDigest !==
    input.attestation.statement
      .predicate
      .deploymentContextDigest
  ) {
    return {
      allowed: false,
      attestation,
      deploymentVerification: {
        ...deploymentVerification,
        allowed: false,
        reasons: [
          ...deploymentVerification
            .reasons,
          {
            code:
              "EVIDENCE_GRAPH_ROOT_MISMATCH",
            detail:
              "Current deployment context digest differs from the context signed into the attestation",
          },
        ],
      },
    };
  }

  return {
    allowed:
      deploymentVerification
        .allowed,
    attestation,
    deploymentVerification,
  };
}

/** Historical cryptographic/context consistency; never observes current authorization. */
/** @deprecated Historical proof only. Use verifyHistoricalAttestationProof. */
export const verifyAdmissionFromAttestation = verifyHistoricalAttestationProof;
