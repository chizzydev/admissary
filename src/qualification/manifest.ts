import {
  canonicalJson,
  digestCanonicalJson,
} from "./canonical.js";
import type {
  AuthorizationState,
  QualificationState,
  ValidityState,
} from "./types.js";

export interface QualificationManifestPayload {
  schema: "qualification-manifest/v1";

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

  qualification: {
    state: QualificationState;
  };

  authorization: {
    state: AuthorizationState;
  };

  validity: {
    state: ValidityState;
  };
}

export interface QualificationManifest extends QualificationManifestPayload {
  manifestDigest: string;
}

export function buildQualificationManifest(
  payload: QualificationManifestPayload,
): QualificationManifest {
  return {
    ...payload,
    manifestDigest: digestCanonicalJson(payload),
  };
}

export function verifyQualificationManifest(
  manifest: QualificationManifest,
): boolean {
  const { manifestDigest, ...payload } = manifest;
  return digestCanonicalJson(payload) === manifestDigest;
}

export function serializeQualificationManifest(
  manifest: QualificationManifest,
): string {
  return canonicalJson(manifest);
}
