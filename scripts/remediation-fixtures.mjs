// Explicit acceptance-only evidence. This module is never loaded by a default
// server. Trusted test setup registers bundles before any HTTP completion.
import { digestCanonicalJson, deriveQualificationWithCoverage } from '../dist/index.js';
export function fixtureEvidence(candidate, contract, scope = {}) {
  const results = ['DETERMINISTIC', 'SEMANTIC', 'EMPIRICAL'].map(kind => ({
    obligationId: `FIXTURE_${kind}`, kind, criticality: 'MANDATORY', state: 'PASS',
  }));
  const nodes = results.map(result => ({ fixture: true, evaluator: 'acceptance-only/v1', result }));
  const payload = {
    schema: 'admissary-completion-evidence/v1', provenance: 'FIXTURE',
    candidate: { repositoryOrModelId: candidate.repositoryOrModelId ?? "fixture/model", revision: candidate.revision ?? null,
      tokenizerRevision: candidate.tokenizerRevision ?? null, artifactManifestDigest: candidate.artifactManifestDigest ?? null },
    contract: { id: contract.contractId, version: contract.version, digest: contract.digest ?? digestCanonicalJson({fixture:"contract"}) },
    policy: { version: scope.policyPack?.version ?? 'fixture-policy/v1', digest: scope.policyPack?.digest ?? digestCanonicalJson({ fixture: 'policy' }) },
    evaluation: { suite: scope.evaluation?.suite ?? 'fixture-suite', digest: scope.evaluation?.digest ?? digestCanonicalJson({ fixture: 'suite' }) },
    plan: { contractId: contract.contractId, contractVersion: contract.version,
      evaluationSuite: scope.evaluation?.suite ?? 'fixture-suite',
      obligations: results.map(r => ({ id: r.obligationId, kind: r.kind, criticality: r.criticality,
        evaluator: 'acceptance-only/v1', dependencies: [], requirement: { fixture: true } })) },
    results, graph: { rootDigest: digestCanonicalJson(nodes), nodes },
    operational: { p95LatencyMs: 10, costPerMillionTokensUsd: 2, modelSizeB: 1 },
    exactArtifactBindingProven: true, sourceRefs: ['fixture:explicit-acceptance-evidence'],
  };
  return { ...payload, evidenceDigest: digestCanonicalJson(payload) };
}
export function completionInput(e) {
  return { qualificationState: deriveQualificationWithCoverage(e.plan, e.results).state, blockers: deriveQualificationWithCoverage(e.plan, e.results).decisiveObligations, exactArtifactBindingProven: e.exactArtifactBindingProven,
    evidenceGraphRootDigest: e.graph.rootDigest, policyVersion: e.policy.version, policyDigest: e.policy.digest,
    evaluationSuite: e.evaluation.suite, evaluationDigest: e.evaluation.digest, sourceRefs: e.sourceRefs };
}
