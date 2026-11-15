import test from "node:test";
import assert from "node:assert/strict";

import {
  MemoryRegistryRepository,
  ModelRegistryService,
} from "../dist/index.js";

async function seededRegistry() {
  const repository =
    new MemoryRegistryRepository();

  const service =
    new ModelRegistryService(
      repository,
    );

  await service.registerOrganization(
    {
      id: "org",
      name: "Org",
    },
    "2026-11-14T19:00:00.000Z",
  );

  await service.registerEnvironment(
    {
      id: "prod",
      organizationId: "org",
      name: "Production",
      tier: "PRODUCTION",
    },
    "2026-11-14T19:00:01.000Z",
  );

  await service.registerWorkload(
    {
      id: "w1",
      packId: "pack-a",
      packVersion: "1.0.0",
      packDigest: "a".repeat(64),
      name: "Workload A",
    },
    "2026-11-14T19:00:02.000Z",
  );

  await service.registerWorkload(
    {
      id: "w2",
      packId: "pack-b",
      packVersion: "1.0.0",
      packDigest: "b".repeat(64),
      name: "Workload B",
    },
    "2026-11-14T19:00:03.000Z",
  );

  for (
    const [id, name] of
    [
      ["m1", "Model One"],
      ["m2", "Model Two"],
      ["m3", "Model Three"],
    ]
  ) {
    await service.registerCandidate(
      {
        id,
        organizationId: "org",
        displayName: name,
        source: "DOLPHIN",
        repositoryOrModelId: name,
        accountableOwner: "AI Platform",
        createdAt: "2026-11-14T19:00:04.000Z",
      },
      "2026-11-14T19:00:04.000Z",
    );

    await service.registerArtifactRevision(
      {
        id: `a-${id}`,
        candidateId: id,
        immutableRevision: null,
        tokenizerRevision: null,
        artifactDigest: null,
        runtimeBindingScope:
          "PROVIDER_MODEL_IDENTITY",
        exactArtifactBindingProven:
          false,
        createdAt:
          "2026-11-14T19:00:05.000Z",
      },
      "2026-11-14T19:00:05.000Z",
    );
  }

  return {
    repository,
    service,
  };
}

test("registry supports multiple models and workloads without inventing evidence", async () => {
  const {
    repository,
    service,
  } = await seededRegistry();

  await service.registerDeployment(
    {
      id: "d1",
      organizationId: "org",
      environmentId: "prod",
      workloadId: "w1",
      contractId: "c",
      contractVersion: "1",
      candidateId: "m1",
      artifactRevisionId: "a-m1",
      qualificationState:
        "REVIEW_REQUIRED",
      authorizationState:
        "NOT_REQUESTED",
      validityState: "CURRENT",
      activeBlockers: [
        "REAL_BLOCKER",
      ],
      latestQualificationRunId:
        "real-run",
      latestAttestationDigest:
        null,
      nextReassessmentAt:
        null,
      updatedAt:
        "2026-11-14T19:00:06.000Z",
    },
    "2026-11-14T19:00:06.000Z",
  );

  for (
    const [deploymentId, modelId] of
    [
      ["d2", "m2"],
      ["d3", "m3"],
    ]
  ) {
    await service.registerDeployment(
      {
        id: deploymentId,
        organizationId: "org",
        environmentId: "prod",
        workloadId: "w1",
        contractId: "c",
        contractVersion: "1",
        candidateId: modelId,
        artifactRevisionId:
          `a-${modelId}`,
        qualificationState:
          "INCOMPLETE",
        authorizationState:
          "NOT_REQUESTED",
        validityState:
          "CURRENT",
        activeBlockers: [
          "NOT_EVALUATED",
        ],
        latestQualificationRunId:
          null,
        latestAttestationDigest:
          null,
        nextReassessmentAt:
          null,
        updatedAt:
          "2026-11-14T19:00:07.000Z",
      },
      "2026-11-14T19:00:07.000Z",
    );
  }

  await service.registerDeployment(
    {
      id: "d4",
      organizationId: "org",
      environmentId: "prod",
      workloadId: "w2",
      contractId: "c2",
      contractVersion: "1",
      candidateId: "m1",
      artifactRevisionId: "a-m1",
      qualificationState:
        "INCOMPLETE",
      authorizationState:
        "NOT_REQUESTED",
      validityState:
        "CURRENT",
      activeBlockers: [
        "NOT_EVALUATED",
      ],
      latestQualificationRunId:
        null,
      latestAttestationDigest:
        null,
      nextReassessmentAt:
        null,
      updatedAt:
        "2026-11-14T19:00:08.000Z",
    },
    "2026-11-14T19:00:08.000Z",
  );

  const state =
    await repository.read();

  assert.equal(
    state.candidates.length,
    3,
  );

  assert.equal(
    state.workloads.length,
    2,
  );

  assert.equal(
    state.deployments.length,
    4,
  );

  const summaries =
    await service.summaries();

  assert.equal(
    summaries.find(
      (item) =>
        item.deploymentId ===
        "d2",
    )?.qualificationState,
    "INCOMPLETE",
  );
});

test("registry rejects false exact-artifact claim under provider identity scope", async () => {
  const repository =
    new MemoryRegistryRepository();

  const service =
    new ModelRegistryService(
      repository,
    );

  await service.registerOrganization(
    {
      id: "org",
      name: "Org",
    },
    "2026-11-14T19:00:00.000Z",
  );

  await service.registerCandidate(
    {
      id: "m1",
      organizationId: "org",
      displayName: "Model",
      source: "DOLPHIN",
      repositoryOrModelId: "model",
      accountableOwner: "owner",
      createdAt: "2026-11-14T19:00:01.000Z",
    },
    "2026-11-14T19:00:01.000Z",
  );

  await assert.rejects(
    () =>
      service.registerArtifactRevision(
        {
          id: "a1",
          candidateId: "m1",
          immutableRevision: null,
          tokenizerRevision: null,
          artifactDigest: null,
          runtimeBindingScope:
            "PROVIDER_MODEL_IDENTITY",
          exactArtifactBindingProven:
            true,
          createdAt:
            "2026-11-14T19:00:02.000Z",
        },
        "2026-11-14T19:00:02.000Z",
      ),
    /Exact artifact binding cannot be proven/,
  );
});
