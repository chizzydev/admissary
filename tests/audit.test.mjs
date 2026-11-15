import { fixtureEvidence, completionInput } from "../scripts/remediation-fixtures.mjs";
import { signProductDeployment } from "./proof-fixtures.mjs";
import { digestCanonicalJson } from "../dist/index.js";
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDeploymentAudit,
  rollbackTargetFromState,
} from "../dist/index.js";

const current = {
  deploymentId: "current",
  candidateId: "candidate-v2",
  contractId: "contract",
  contractVersion: "1.0.0",
  qualificationRunId: "run-v2",
  assuranceDeploymentId: "current",
  status: "ACTIVE",
  createdBy: "operator",
  createdAt: "2026-11-14T20:10:00.000Z",
  updatedAt: "2026-11-14T20:20:00.000Z",
  provisioningError: null,
  attestationId: "att-v2",
};

const rollback = {
  deploymentId: "rollback",
  candidateId: "candidate-v1",
  contractId: "contract",
  contractVersion: "1.0.0",
  qualificationRunId: "run-v1",
  assuranceDeploymentId: "rollback",
  status: "ACTIVE",
  createdBy: "operator",
  createdAt: "2026-11-14T19:00:00.000Z",
  updatedAt: "2026-11-14T19:10:00.000Z",
  provisioningError: null,
  attestationId: "att-v1",
};

const product = {
  schema: "admissary-product-application/v1",
  revision: 1,
  candidates: [
    {
      candidateId: "candidate-v1",
      displayName: "Candidate v1",
      provider: "FIXTURE",
      repositoryOrModelId: "example/model-v1",
      revision: "1".repeat(40),
      tokenizerRevision: "a".repeat(40),
      artifactManifestDigest: "artifact-v1",
      registeredBy: "operator",
      registeredAt: "2026-11-14T18:00:00.000Z",
    },
    {
      candidateId: "candidate-v2",
      displayName: "Candidate v2",
      provider: "FIXTURE",
      repositoryOrModelId: "example/model-v2",
      revision: "2".repeat(40),
      tokenizerRevision: "b".repeat(40),
      artifactManifestDigest: "artifact-v2",
      registeredBy: "operator",
      registeredAt: "2026-11-14T18:30:00.000Z",
    },
  ],
  contracts: [
    {
      contractId: "contract",
      version: "1.0.0",
      digest: digestCanonicalJson({fixture:"contract-digest"}),
      workloadId: "banking",
      environmentId: "production",
      registeredBy: "operator",
      registeredAt: "2026-11-14T18:00:00.000Z",
      updatedAt: "2026-11-14T18:00:00.000Z",
    },
  ],
  qualificationRuns: [
    {
      runId: "run-v1",
      candidateId: "candidate-v1",
      contractId: "contract",
      contractVersion: "1.0.0",
      environmentId: "production",
      workloadId: "banking",
      status: "COMPLETED",
      qualificationState: "QUALIFIED",
      blockers: [],
      exactArtifactBindingProven: true,
      evidenceGraphRootDigest: "graph-v1",
      policyVersion: "policy-v1",
      policyDigest: "policy",
      evaluationSuite: "banking",
      evaluationDigest: "eval",
      sourceRefs: ["fixture"],
      requestedBy: "operator",
      requestedAt: "2026-11-14T18:01:00.000Z",
      completedBy: "admin",
      completedAt: "2026-11-14T18:02:00.000Z",
      replacesDeploymentId: null,
      reason: "fixture",
      requestDigest: "request-v1",
    },
    {
      runId: "run-v2",
      candidateId: "candidate-v2",
      contractId: "contract",
      contractVersion: "1.0.0",
      environmentId: "production",
      workloadId: "banking",
      status: "COMPLETED",
      qualificationState: "QUALIFIED",
      blockers: [],
      exactArtifactBindingProven: true,
      evidenceGraphRootDigest: "graph-v2",
      policyVersion: "policy-v1",
      policyDigest: "policy",
      evaluationSuite: "banking",
      evaluationDigest: "eval",
      sourceRefs: ["fixture"],
      requestedBy: "operator",
      requestedAt: "2026-11-14T18:31:00.000Z",
      completedBy: "admin",
      completedAt: "2026-11-14T18:32:00.000Z",
      replacesDeploymentId: null,
      reason: "fixture",
      requestDigest: "request-v2",
    },
  ],
  deployments: [rollback, current],
  attestations: [
    {
      attestationId: "att-v1",
      deploymentId: "rollback",
      attestation: {},
      attestationDigest: "digest-v1",
      recordedBy: "admin",
      recordedAt: "2026-11-14T19:05:00.000Z",
    },
    {
      attestationId: "att-v2",
      deploymentId: "current",
      attestation: {},
      attestationDigest: "digest-v2",
      recordedBy: "admin",
      recordedAt: "2026-11-14T20:15:00.000Z",
    },
  ],
  events: [
    {
      eventId: "qualification",
      occurredAt: "2026-11-14T18:32:00.000Z",
      actorId: "admin",
      type: "QUALIFICATION_COMPLETED",
      subjectId: "run-v2",
      detail: "state=QUALIFIED",
    },
    {
      eventId: "attestation",
      occurredAt: "2026-11-14T20:15:00.000Z",
      actorId: "admin",
      type: "ATTESTATION_RECORDED",
      subjectId: "current",
      detail: "attestation=att-v2",
    },
  ],
};

const assurance = {
  schema: "admissary-continuous-assurance/v1",
  revision: 1,
  deployments: [
    {
      deploymentId: "rollback",
      qualificationRunId: "run-v1",
      qualificationState: "QUALIFIED",
      exactArtifactBindingProven: true,
      identity: {},
      lifecycleState: "CURRENT",
      activeApprovalId: "approval-v1",
      monitoringStatus: "HEALTHY",
      monitoringPolicy: {
        maxEvidenceAgeMs: 999999999,
        failClosedWhenOverdue: false,
      },
      lastSuccessfulCheckAt: null,
      lastCheckAt: null,
      latestInvalidatedNodes: [],
      createdAt: "2026-11-14T19:00:00.000Z",
      updatedAt: "2026-11-14T19:05:00.000Z",
    },
    {
      deploymentId: "current",
      qualificationRunId: "run-v2",
      qualificationState: "QUALIFIED",
      exactArtifactBindingProven: true,
      identity: {},
      lifecycleState: "REVOKED",
      activeApprovalId: "approval-v2",
      monitoringStatus: "HEALTHY",
      monitoringPolicy: {
        maxEvidenceAgeMs: 999999999,
        failClosedWhenOverdue: false,
      },
      lastSuccessfulCheckAt: null,
      lastCheckAt: null,
      latestInvalidatedNodes: [],
      createdAt: "2026-11-14T20:10:00.000Z",
      updatedAt: "2026-11-14T20:20:00.000Z",
    },
  ],
  approvals: [
    {
      approvalId: "approval-v1",
      scope: {},
      state: "APPROVED",
      actorId: "approver",
      issuedAt: "2026-11-14T19:04:00.000Z",
      expiresAt: null,
      stateChangedAt: "2026-11-14T19:04:00.000Z",
      reason: "approve",
    },
    {
      approvalId: "approval-v2",
      scope: {},
      state: "REVOKED",
      actorId: "approver",
      issuedAt: "2026-11-14T20:14:00.000Z",
      expiresAt: null,
      stateChangedAt: "2026-11-14T20:20:00.000Z",
      reason: "incident",
    },
  ],
  watchChecks: [],
  reassessments: [],
  events: [
    {
      eventId: "approved",
      deploymentId: "current",
      occurredAt: "2026-11-14T20:14:00.000Z",
      type: "APPROVAL_GRANTED",
      detail: "approval-v2",
    },
    {
      eventId: "revoked",
      deploymentId: "current",
      occurredAt: "2026-11-14T20:20:00.000Z",
      type: "APPROVAL_REVOKED",
      detail: "incident",
    },
  ],
};

// Complete identity-bearing fixtures replace the old empty attestation/identity stubs.
for (const d of product.deployments) {
  const r = product.qualificationRuns.find(x=>x.runId===d.qualificationRunId);
  const c = product.candidates.find(x=>x.candidateId===d.candidateId);
  c.artifactManifestDigest = digestCanonicalJson({ fixture: c.candidateId });
  const k = product.contracts[0];
  const e = fixtureEvidence(c,k); Object.assign(r,completionInput(e),{completionEvidence:e});
  const a = assurance.deployments.find(x=>x.deploymentId===d.deploymentId);
  a.identity = {candidateRepository:c.repositoryOrModelId,candidateRevision:c.revision,tokenizerRevision:c.tokenizerRevision,artifactManifestDigest:c.artifactManifestDigest,contractId:k.contractId,contractVersion:k.version,contractDigest:k.digest,policyVersion:r.policyVersion,policyDigest:r.policyDigest,evaluationSuite:r.evaluationSuite,evaluationDigest:r.evaluationDigest,evidenceGraphRootDigest:r.evidenceGraphRootDigest,environmentId:r.environmentId,workloadId:r.workloadId};
  product.attestations.find(x=>x.attestationId===d.attestationId).attestation=signProductDeployment(product,d.deploymentId);
}

const rollbackDecision = {
  allowed: true,
  reasons: [],
  lifecycleState: "CURRENT",
  monitoringStatus: "HEALTHY",
  approvalState: "APPROVED",
  approvalId: "approval-v1",
  approvalExpiresAt: null,
  identityDigest: "rollback-identity",
};

const currentDecision = {
  allowed: false,
  reasons: ["LIFECYCLE_REVOKED", "APPROVAL_REVOKED"],
  lifecycleState: "REVOKED",
  monitoringStatus: "HEALTHY",
  approvalState: "REVOKED",
  approvalId: "approval-v2",
  approvalExpiresAt: null,
  identityDigest: "current-identity",
};

test("rollback target requires qualified exact-bound current approved attested same-scope deployment", () => {
  const target =
    rollbackTargetFromState({
      product,
      assurance,
      currentDeploymentId: "current",
      targetDeploymentId: "rollback",
      targetDecision: rollbackDecision,
    });

  assert.ok(target);
  assert.equal(
    target.deploymentId,
    "rollback",
  );
  assert.equal(
    target.reason,
    "QUALIFIED_EXACT_BOUND_APPROVED_CURRENT_ATTESTED_SAME_SCOPE",
  );
});

test("revoked target is never returned as safe rollback", () => {
  const target =
    rollbackTargetFromState({
      product,
      assurance,
      currentDeploymentId: "rollback",
      targetDeploymentId: "current",
      targetDecision: currentDecision,
    });

  assert.equal(target, null);
});

test("deployment audit answers exact identity, history and rollback in one proof object", () => {
  const rollbackTarget =
    rollbackTargetFromState({
      product,
      assurance,
      currentDeploymentId: "current",
      targetDeploymentId: "rollback",
      targetDecision: rollbackDecision,
    });

  assert.ok(rollbackTarget);

  const audit =
    buildDeploymentAudit({
      product,
      assurance,
      deploymentId: "current",
      decision: currentDecision,
      rollbackTargets: [
        rollbackTarget,
      ],
    });

  assert.equal(
    audit.decision.allowed,
    false,
  );
  assert.equal(
    audit.exactIdentity.repositoryOrModelId,
    "example/model-v2",
  );
  assert.equal(
    audit.approval?.state,
    "REVOKED",
  );
  assert.equal(
    audit.attestation?.attestationDigest,
    "digest-v2",
  );
  assert.equal(
    audit.rollbackTargets[0]?.deploymentId,
    "rollback",
  );
  assert.ok(
    audit.timeline.some(
      (item) =>
        item.type ===
        "APPROVAL_REVOKED",
    ),
  );
  assert.match(
    audit.auditDigest,
    /^[a-f0-9]{64}$/,
  );
});
