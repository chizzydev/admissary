export type EvidenceKind =
  | "MODEL_METADATA"
  | "MODEL_CARD"
  | "LICENSE"
  | "FILE_MANIFEST"
  | "CONFIG"
  | "PUBLISHER"
  | "LINEAGE"
  | "REMOTE_CODE";

export interface EvidenceRecord<T = unknown> {
  id: string;
  kind: EvidenceKind;
  sourceUri: string;
  sourceRevision: string;
  capturedAt: string;
  contentDigest: string;
  payload: T;
}

export type ArtifactFileRole =
  | "WEIGHT"
  | "TOKENIZER"
  | "CONFIG"
  | "MODEL_CODE"
  | "LICENSE"
  | "MODEL_CARD"
  | "OTHER";

export interface ArtifactFileIdentity {
  path: string;
  role: ArtifactFileRole;
  size: number | null;
  etag: string | null;
  storageIdentity: string | null;
  repoCommit: string | null;
}

export type RemoteCodeAssessmentState =
  | "REQUIRED"
  | "INDICATED"
  | "NOT_INDICATED"
  | "UNKNOWN";

export interface RemoteCodeAssessment {
  state: RemoteCodeAssessmentState;
  reasons: string[];
  evidencePaths: string[];
}

export interface LicenseEvidencePayload {
  declaredIdentifier: string | null;
  declaredName: string | null;
  declaredLink: string | null;
  filePath: string | null;
  text: string | null;
}

export interface HuggingFaceModelEvidenceBundle {
  schema: "admissary-hf-evidence/v1";
  repository: string;
  requestedRevision: string;
  resolvedRevision: string;
  capturedAt: string;
  source: "huggingface";
  modelMetadata: EvidenceRecord;
  fileManifest: EvidenceRecord<ArtifactFileIdentity[]>;
  modelCard: EvidenceRecord<string> | null;
  license: EvidenceRecord<LicenseEvidencePayload> | null;
  config: EvidenceRecord<Record<string, unknown>> | null;
  remoteCode: EvidenceRecord<RemoteCodeAssessment>;
  bundleDigest: string;
}
