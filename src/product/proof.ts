import { deriveCompletion } from "./completion.js";
import { canonicalJson, digestCanonicalJson } from "../qualification/canonical.js";
import type { AssuranceDeploymentRecord } from "../assurance/types.js";
import type { ProductApplicationState, ProductAttestationRecord, ProductDeploymentRecord, ProductCandidateRecord, ProductContractRecord, ProductQualificationRunRecord } from "./state.js";

/** One identity projection for attachment, current admission, audit and rollback. */
export function currentProofContext(a: AssuranceDeploymentRecord) {
  const i = a.identity;
  return {
    schema: "admissary-deployment-context/v1" as const,
    candidate: { repository: i.candidateRepository, revision: i.candidateRevision,
      tokenizerRevision: i.tokenizerRevision, artifactManifestDigest: i.artifactManifestDigest },
    contract: { id: i.contractId, version: i.contractVersion, digest: i.contractDigest },
    policyPack: { version: i.policyVersion, digest: i.policyDigest },
    evaluation: { suite: i.evaluationSuite, digest: i.evaluationDigest },
    evidenceGraph: { rootDigest: i.evidenceGraphRootDigest },
  };
}

export function productProofMatches(s: ProductApplicationState, d: ProductDeploymentRecord, a: AssuranceDeploymentRecord): boolean {
  const r = s.qualificationRuns.find(x => x.runId === d.qualificationRunId);
  const c = s.candidates.find(x => x.candidateId === d.candidateId);
  const k = s.contracts.find(x => x.contractId === d.contractId && x.version === d.contractVersion);
  if (!r || !c || !k || r.status !== "COMPLETED" || !r.completionEvidence) return false;
  try { if (deriveCompletion(r.completionEvidence, c, k).state !== r.qualificationState) return false; } catch { return false; }
  const i = a.identity;
  return d.deploymentId === a.deploymentId && d.assuranceDeploymentId === a.deploymentId &&
    r.runId === a.qualificationRunId && r.candidateId === c.candidateId &&
    r.contractId === k.contractId && r.contractVersion === k.version &&
    r.qualificationState === a.qualificationState && r.exactArtifactBindingProven === a.exactArtifactBindingProven &&
    c.repositoryOrModelId === i.candidateRepository && (c.revision ?? `UNPROVEN:${c.repositoryOrModelId}`) === i.candidateRevision &&
    (c.tokenizerRevision ?? "UNPROVEN") === i.tokenizerRevision && (c.artifactManifestDigest ?? "UNPROVEN") === i.artifactManifestDigest &&
    k.contractId === i.contractId && k.version === i.contractVersion && k.digest === i.contractDigest &&
    (r.policyVersion ?? "UNPROVEN") === i.policyVersion && (r.policyDigest ?? "UNPROVEN") === i.policyDigest &&
    (r.evaluationSuite ?? r.workloadId) === i.evaluationSuite && (r.evaluationDigest ?? "UNPROVEN") === i.evaluationDigest &&
    r.evidenceGraphRootDigest === i.evidenceGraphRootDigest && r.environmentId === i.environmentId && r.workloadId === i.workloadId;
}

export function attestationMatchesProof(record: ProductAttestationRecord, a: AssuranceDeploymentRecord): boolean {
  const p = record.attestation.statement.predicate;
  const m = p.manifest;
  const ctx = currentProofContext(a);
  const scope = p.operationalScope;
  return record.attestation.statement.predicateType.endsWith("/v2") && !!scope &&
    scope.deploymentId === a.deploymentId && scope.qualificationRunId === a.qualificationRunId &&
    scope.environmentId === a.identity.environmentId && scope.workloadId === a.identity.workloadId &&
    p.deploymentContextDigest === digestCanonicalJson(ctx) && p.exactArtifactBindingProven === true &&
    m.authorization.state === "APPROVED" && m.validity.state === "CURRENT" &&
    record.deploymentId === a.deploymentId &&
    canonicalJson(m.candidate) === canonicalJson(ctx.candidate) && canonicalJson(m.contract) === canonicalJson(ctx.contract) &&
    canonicalJson(m.policyPack) === canonicalJson(ctx.policyPack) && canonicalJson(m.evaluation) === canonicalJson(ctx.evaluation) &&
    canonicalJson(m.evidenceGraph) === canonicalJson(ctx.evidenceGraph) && m.qualification.state === a.qualificationState;
}

export function assuranceIdentityFor(c: ProductCandidateRecord, k: ProductContractRecord, r: ProductQualificationRunRecord) {
  return { candidateRepository: c.repositoryOrModelId, candidateRevision: c.revision ?? `UNPROVEN:${c.repositoryOrModelId}`,
    tokenizerRevision: c.tokenizerRevision ?? "UNPROVEN", artifactManifestDigest: c.artifactManifestDigest ?? "UNPROVEN",
    contractId: k.contractId, contractVersion: k.version, contractDigest: k.digest,
    policyVersion: r.policyVersion ?? "UNPROVEN", policyDigest: r.policyDigest ?? "UNPROVEN",
    evaluationSuite: r.evaluationSuite ?? r.workloadId, evaluationDigest: r.evaluationDigest ?? "UNPROVEN",
    evidenceGraphRootDigest: r.evidenceGraphRootDigest!, environmentId: r.environmentId, workloadId: r.workloadId };
}
