import { digestCanonicalJson } from "../qualification/canonical.js";
import { deriveQualificationWithCoverage } from "../workflow/orchestrator.js";
import type { QualificationPlan } from "../qualification/compiler.js";
import type { ObligationResult } from "../qualification/types.js";
import type { ProductCandidateRecord, ProductContractRecord, ProductQualificationRunRecord } from "./state.js";

export interface CompletionEvidence {
  schema: "admissary-completion-evidence/v1";
  provenance: "REAL" | "FIXTURE";
  candidate: Pick<ProductCandidateRecord, "repositoryOrModelId" | "revision" | "tokenizerRevision" | "artifactManifestDigest">;
  contract: { id: string; version: string; digest: string };
  policy: { version: string; digest: string };
  evaluation: { suite: string; digest: string };
  plan: QualificationPlan;
  results: ObligationResult[];
  graph: { rootDigest: string; nodes: unknown[] };
  exactArtifactBindingProven: boolean;
  sourceRefs: string[];
  operational?: { p95LatencyMs: number | null; costPerMillionTokensUsd: number | null; modelSizeB: number | null };
  evidenceDigest: string;
}

// A resolver is trusted application configuration, never request data. It must
// resolve content-addressed stored artifacts, not fetch caller-provided URLs.
export type CompletionEvidenceResolver = (run: ProductQualificationRunRecord,
  candidate: ProductCandidateRecord, contract: ProductContractRecord) => Promise<CompletionEvidence>;

export function deriveCompletion(e: CompletionEvidence, c: ProductCandidateRecord, k: ProductContractRecord) {
  const { evidenceDigest, ...payload } = e;
  if (e.schema !== "admissary-completion-evidence/v1" || evidenceDigest !== digestCanonicalJson(payload)) throw new Error("COMPLETION_EVIDENCE_INTEGRITY");
  if (!Array.isArray(e.sourceRefs) || !e.sourceRefs.length || e.sourceRefs.some(x => typeof x !== "string" || !x.trim())) throw new Error("COMPLETION_SOURCE_REQUIRED");
  const candidate = { repositoryOrModelId: c.repositoryOrModelId, revision: c.revision,
    tokenizerRevision: c.tokenizerRevision, artifactManifestDigest: c.artifactManifestDigest };
  if (digestCanonicalJson(e.candidate) !== digestCanonicalJson(candidate) ||
      e.contract.id !== k.contractId || e.contract.version !== k.version || e.contract.digest !== k.digest ||
      e.plan.contractId !== k.contractId || e.plan.contractVersion !== k.version ||
      e.plan.evaluationSuite !== e.evaluation.suite) throw new Error("COMPLETION_IDENTITY_MISMATCH");
  if (!["REAL", "FIXTURE"].includes(e.provenance)) throw new Error("COMPLETION_PROVENANCE_INVALID");
  if (e.provenance === "FIXTURE" && !e.sourceRefs.every(x => x.startsWith("fixture:"))) throw new Error("COMPLETION_FIXTURE_LABEL_REQUIRED");
  if (!e.plan.obligations.length || !e.plan.obligations.some(x => x.criticality === "MANDATORY")) throw new Error("COMPLETION_MANDATORY_CONTROLS_REQUIRED");
  const d = deriveQualificationWithCoverage(e.plan, e.results);
  if (d.coverage.missingObligations.length) throw new Error("COMPLETION_MISSING_CONTROLS");
  if (!Array.isArray(e.graph.nodes) || !e.graph.nodes.length || e.graph.rootDigest !== digestCanonicalJson(e.graph.nodes)) throw new Error("COMPLETION_GRAPH_INTEGRITY");
  for (const hash of [e.policy.digest, e.evaluation.digest, e.graph.rootDigest]) {
    if (!/^[a-f0-9]{64}$/.test(hash) || /^0+$/.test(hash)) throw new Error("COMPLETION_DIGEST_INVALID");
  }
  if (typeof e.exactArtifactBindingProven !== "boolean") throw new Error("COMPLETION_BINDING_INVALID");
  if (e.exactArtifactBindingProven && (!/^[a-f0-9]{40}$/.test(c.revision ?? "") ||
      !/^[a-f0-9]{40}$/.test(c.tokenizerRevision ?? "") || !/^[a-f0-9]{64}$/.test(c.artifactManifestDigest ?? ""))) throw new Error("COMPLETION_EXACT_IDENTITY_INVALID");
  if (e.operational) {
    if (Object.keys(e.operational).sort().join(",") !== "costPerMillionTokensUsd,modelSizeB,p95LatencyMs" ||
        Object.values(e.operational).some(x => x !== null && (typeof x !== "number" || !Number.isFinite(x) || x < 0))) throw new Error("COMPLETION_OPERATIONAL_EVIDENCE_INVALID");
  }
  return d;
}
