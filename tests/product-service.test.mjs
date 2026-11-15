import { testTrust, signProductDeployment } from "./proof-fixtures.mjs";
import { fixtureEvidence, completionInput } from "../scripts/remediation-fixtures.mjs";
import { digestCanonicalJson } from "../dist/index.js";
import test from "node:test";
import assert from "node:assert/strict";

import {
  ContinuousAssuranceService,
  MemoryAssuranceRepository,
  MemoryProductRepository,
  ProductApplicationService,
} from "../dist/index.js";

function service() {
  return new ProductApplicationService(
    new MemoryProductRepository(),
    new ContinuousAssuranceService(
      new MemoryAssuranceRepository(),
    ),
    async (r, c, k) => fixtureEvidence(c, k),
    testTrust,
  );
}

async function qualifiedFixture() {
  const api = service();
  await api.registerCandidate({
    candidateId: "candidate-1",
    displayName: "Candidate 1",
    provider: "TEST",
    repositoryOrModelId: "example/model",
    revision: "a".repeat(40),
    tokenizerRevision: "b".repeat(40),
    artifactManifestDigest: digestCanonicalJson({fixture:"artifact-1"}),
    actorId: "operator",
    occurredAt: "2026-11-14T20:00:00.000Z",
  });
  await api.registerContract({
    contractId: "contract-1",
    version: "1.0.0",
    digest: digestCanonicalJson({fixture:"contract-digest"}),
    workloadId: "workload-1",
    environmentId: "production",
    actorId: "operator",
    occurredAt: "2026-11-14T20:00:01.000Z",
  });
  const run = await api.startQualification({
    candidateId: "candidate-1",
    contractId: "contract-1",
    contractVersion: "1.0.0",
    actorId: "operator",
    requestedAt: "2026-11-14T20:00:02.000Z",
    reason: "production evaluation",
  });
  const st = await api.state();
  const evidence = fixtureEvidence(st.candidates[0], st.contracts[0]);
  await api.completeQualification({
    runId: run.runId,
    ...completionInput(evidence),
    actorId: "system",
    completedAt: "2026-11-14T20:00:03.000Z",
  });
  const deployment = await api.createDeployment({
    deploymentId: "deployment-1",
    runId: run.runId,
    actorId: "operator",
    createdAt: "2026-11-14T20:00:04.000Z",
    maxEvidenceAgeMs: 60 * 60 * 1000,
  });
  return { api, run, deployment };
}

test("candidate and contract registration are idempotent but conflicting identity fails", async () => {
  const api = service();
  const input = {
    candidateId: "candidate-1",
    displayName: "Candidate 1",
    provider: "TEST",
    repositoryOrModelId: "example/model",
    revision: null,
    tokenizerRevision: null,
    artifactManifestDigest: null,
    actorId: "operator",
    occurredAt: "2026-11-14T20:00:00.000Z",
  };
  assert.equal((await api.registerCandidate(input)).created, true);
  assert.equal((await api.registerCandidate(input)).created, false);
  await assert.rejects(
    api.registerCandidate({ ...input, displayName: "Changed" }),
    /different identity/,
  );
});

test("start qualification is a durable request and does not fabricate provider execution", async () => {
  const api = service();
  await api.registerCandidate({
    candidateId: "candidate-1",
    displayName: "Candidate 1",
    provider: "TEST",
    repositoryOrModelId: "example/model",
    revision: null,
    tokenizerRevision: null,
    artifactManifestDigest: null,
    actorId: "operator",
    occurredAt: "2026-11-14T20:00:00.000Z",
  });
  await api.registerContract({
    contractId: "contract-1",
    version: "1.0.0",
    digest: digestCanonicalJson({fixture:"contract-digest"}),
    workloadId: "workload",
    environmentId: "staging",
    actorId: "operator",
    occurredAt: "2026-11-14T20:00:01.000Z",
  });
  const run = await api.startQualification({
    candidateId: "candidate-1",
    contractId: "contract-1",
    contractVersion: "1.0.0",
    actorId: "operator",
    requestedAt: "2026-11-14T20:00:02.000Z",
    reason: "evaluate",
  });
  assert.equal(run.status, "REQUESTED");
  assert.equal(run.qualificationState, null);
  assert.deepEqual(run.sourceRefs, []);
  assert.equal(run.completedAt, null);
});

test("approval is impossible until qualification is completed, qualified and exact-bound", async () => {
  const { api } = await qualifiedFixture();
  const before = await api.deployment(
    "deployment-1",
    "2026-11-14T20:01:00.000Z",
  );
  assert.equal(before.decision.allowed, false);
  assert.ok(before.decision.reasons.includes("APPROVAL_NONE"));
  await api.approveDeployment({
    deploymentId: "deployment-1",
    actorId: "approver",
    issuedAt: "2026-11-14T20:01:01.000Z",
    expiresAt: "2026-11-14T22:01:01.000Z",
    reason: "approved exact deployment",
  });
  const after = await api.deployment(
    "deployment-1",
    "2026-11-14T20:01:02.000Z",
  );
  assert.equal(after.decision.allowed, true);
});

test("requalification request creates a new request without inheriting completion or approval", async () => {
  const { api } = await qualifiedFixture();
  await api.approveDeployment({
    deploymentId: "deployment-1",
    actorId: "approver",
    issuedAt: "2026-11-14T20:01:01.000Z",
    expiresAt: null,
    reason: "approve",
  });
  const run = await api.requestRequalification({
    deploymentId: "deployment-1",
    actorId: "operator",
    requestedAt: "2026-11-14T20:02:00.000Z",
    reason: "scheduled reassessment",
  });
  assert.equal(run.status, "REQUESTED");
  assert.equal(run.replacesDeploymentId, "deployment-1");
  assert.equal(run.qualificationState, null);
});

test("revocation remains visible in current/stale deployment listing", async () => {
  const { api } = await qualifiedFixture();
  await api.approveDeployment({
    deploymentId: "deployment-1",
    actorId: "approver",
    issuedAt: "2026-11-14T20:01:01.000Z",
    expiresAt: null,
    reason: "approve",
  });
  await api.revokeDeployment({
    deploymentId: "deployment-1",
    actorId: "approver",
    occurredAt: "2026-11-14T20:02:00.000Z",
    reason: "incident",
  });
  const stale = await api.deployments(
    "2026-11-14T20:02:01.000Z",
    "STALE",
  );
  assert.equal(stale.length, 1);
  assert.equal(stale[0].decision.allowed, false);
  assert.equal(stale[0].validity, "STALE");
});


test("idempotent candidate registration does not mutate application revision", async () => {
  const api = service();
  const input = {
    candidateId: "candidate-idempotent",
    displayName: "Idempotent",
    provider: "TEST",
    repositoryOrModelId: "example/idempotent",
    revision: null,
    tokenizerRevision: null,
    artifactManifestDigest: null,
    actorId: "operator",
    occurredAt: "2026-11-14T20:00:00.000Z",
  };
  await api.registerCandidate(input);
  const before = await api.state();
  await api.registerCandidate(input);
  const after = await api.state();
  assert.equal(after.revision, before.revision);
  assert.equal(after.events.length, before.events.length);
});

test("exact-binding completion rejects incomplete exact identity", async () => {
  const api = service();
  await api.registerCandidate({
    candidateId: "candidate-unbound",
    displayName: "Unbound",
    provider: "TEST",
    repositoryOrModelId: "example/unbound",
    revision: null,
    tokenizerRevision: null,
    artifactManifestDigest: null,
    actorId: "operator",
    occurredAt: "2026-11-14T20:00:00.000Z",
  });
  await api.registerContract({
    contractId: "contract",
    version: "1",
    digest: "digest",
    workloadId: "workload",
    environmentId: "prod",
    actorId: "operator",
    occurredAt: "2026-11-14T20:00:01.000Z",
  });
  const run = await api.startQualification({
    candidateId: "candidate-unbound",
    contractId: "contract",
    contractVersion: "1",
    actorId: "operator",
    requestedAt: "2026-11-14T20:00:02.000Z",
    reason: "test",
  });
  await assert.rejects(
    api.completeQualification({
      runId: run.runId,
      qualificationState: "QUALIFIED",
      blockers: [],
      exactArtifactBindingProven: true,
      evidenceGraphRootDigest: "graph",
      policyVersion: "policy-v1",
      policyDigest: "policy-digest",
      evaluationSuite: "suite",
      evaluationDigest: "suite-digest",
      sourceRefs: ["test"],
      actorId: "system",
      completedAt: "2026-11-14T20:00:03.000Z",
    }),
    /COMPLETION_EXACT_IDENTITY_INVALID/,
  );
});


test("attestation cannot be attached to a deployment with a different exact identity", async () => {
  const { api } = await qualifiedFixture();
  await api.approveDeployment({
    deploymentId: "deployment-1",
    actorId: "approver",
    issuedAt: "2026-11-14T20:01:01.000Z",
    expiresAt: null,
    reason: "approve",
  });

  const attestation = {
    schema: "admissary-signed-attestation/v1",
    algorithm: "Ed25519",
    keyId: "test",
    statement: {
      _type: "https://in-toto.io/Statement/v1",
      subject: [],
      predicateType: "https://admissary.dev/attestation/qualification/v1",
      predicate: {
        manifest: {
          candidate: {
            repository: "example/model",
            revision: "c".repeat(40),
            tokenizerRevision: "b".repeat(40),
            artifactManifestDigest: digestCanonicalJson({fixture:"artifact-1"}),
          },
          contract: {
            id: "contract-1",
            version: "1.0.0",
            digest: digestCanonicalJson({fixture:"contract-digest"}),
          },
          policyPack: {
            version: "policy-v1",
            digest: "policy-digest",
          },
          evaluation: {
            suite: "suite",
            digest: "suite-digest",
          },
          evidenceGraph: {
            rootDigest: "graph-root",
          },
          qualification: { state: "QUALIFIED" },
          authorization: { state: "APPROVED" },
          validity: { state: "CURRENT" },
          manifestDigest: "unused-in-service-binding-test",
        },
      },
    },
    statementDigest: "statement",
    signature: "signature",
    envelopeDigest: "d".repeat(64),
  };

  await assert.rejects(
    api.recordAttestation({
      deploymentId: "deployment-1",
      attestation,
      actorId: "admin",
      recordedAt: "2026-11-14T20:01:02.000Z",
    }),
    /signature\/schema is invalid or untrusted/,
  );
});


test("contract version is idempotent for identical content and rejects changed workload or environment", async () => {
  const api = service();

  const input = {
    contractId: "immutable-contract",
    version: "1.0.0",
    digest: "immutable-contract-digest",
    workloadId: "workload-a",
    environmentId: "prod-a",
    actorId: "operator",
    occurredAt: "2026-11-14T20:00:00.000Z",
  };

  const first =
    await api.registerContract(
      input,
    );

  assert.equal(
    first.created,
    true,
  );

  const before =
    await api.state();

  const repeated =
    await api.registerContract(
      input,
    );

  assert.equal(
    repeated.created,
    false,
  );

  const after =
    await api.state();

  assert.equal(
    after.revision,
    before.revision,
  );

  await assert.rejects(
    api.registerContract({
      ...input,
      workloadId:
        "workload-b",
    }),
    /different content/,
  );

  await assert.rejects(
    api.registerContract({
      ...input,
      environmentId:
        "prod-b",
    }),
    /different content/,
  );
});


test("attestation attaches when candidate, contract, policy, evaluation, evidence root and approval all match exactly", async () => {
  const { api } =
    await qualifiedFixture();

  await api.approveDeployment({
    deploymentId:
      "deployment-1",
    actorId:
      "approver",
    issuedAt:
      "2026-11-14T20:01:01.000Z",
    expiresAt:
      "2026-11-14T22:01:01.000Z",
    reason:
      "approve exact scope",
  });

  const attestation = signProductDeployment(await api.state(), "deployment-1");
  const record =
    await api.recordAttestation({
      deploymentId:
        "deployment-1",
      attestation,
      actorId:
        "admin",
      recordedAt:
        "2026-11-14T20:01:02.000Z",
    });

  assert.equal(
    record.deploymentId,
    "deployment-1",
  );

  assert.equal(
    record.attestationDigest,
    attestation.envelopeDigest,
  );

  const fetched =
    await api.getAttestation(
      "deployment-1",
    );

  assert.equal(
    fetched?.attestationDigest,
    record.attestationDigest,
  );
});
