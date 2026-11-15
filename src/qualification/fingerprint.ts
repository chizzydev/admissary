import { digestCanonicalJson } from "./canonical.js";

export type QualificationNodeType =
  | "SOURCE"
  | "EVIDENCE"
  | "CONTROL"
  | "EVALUATION"
  | "DECISION";

export interface QualificationNodeFingerprintInput {
  nodeType: QualificationNodeType;
  evaluatorVersion: string;
  configuration: unknown;
  inputDigests: string[];
  dependencyResultDigests: string[];
}

export function fingerprintNode(
  input: QualificationNodeFingerprintInput,
): string {
  return digestCanonicalJson({
    nodeType: input.nodeType,
    evaluatorVersion: input.evaluatorVersion,
    configuration: input.configuration,
    inputDigests: [...input.inputDigests].sort(),
    dependencyResultDigests: [...input.dependencyResultDigests].sort(),
  });
}
