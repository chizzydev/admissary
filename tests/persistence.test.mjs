import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import {
  join,
} from "node:path";
import {
  tmpdir,
} from "node:os";

import {
  JsonFilePersistenceRepository,
  MemoryPersistenceRepository,
  QualificationHistoryService,
} from "../dist/index.js";

const system = {
  id: "system",
  roles: ["SYSTEM"],
};

const approver = {
  id: "alice-approver",
  roles: ["APPROVER"],
};

const viewer = {
  id: "victor-viewer",
  roles: ["VIEWER"],
};

function qualifiedRecord(
  runId = "run-qualified",
) {
  return {
    runId,
    contractId:
      "banking-support-prod",
    contractVersion:
      "1.0.0",
    contractDigest:
      "contract-digest",
    candidateIdentity:
      "fixture/model@sha256:abc",
    qualificationState:
      "QUALIFIED",
    graphRootDigest:
      "graph-digest",
    exactArtifactBindingProven:
      true,
    finalizedAt:
      "2026-11-14T18:00:00.000Z",
    sourceArtifactDigest:
      "fixture:authorization-acceptance",
  };
}

function reviewRequiredRecord(
  runId = "run-real-r6",
) {
  return {
    runId,
    contractId:
      "banking-support-prod",
    contractVersion:
      "1.0.0",
    contractDigest:
      "contract-digest",
    candidateIdentity:
      "dolphin:deepseek-ai/DeepSeek-V4.1-Flash",
    qualificationState:
      "REVIEW_REQUIRED",
    graphRootDigest:
      "a49d15cd2e86ff0d235a86bada97949d64ee23d8b0d61b984e3c2fb62975c1f3",
    exactArtifactBindingProven:
      false,
    finalizedAt:
      "2026-11-14T17:29:05.231Z",
    sourceArtifactDigest:
      "d5e85dfbd04214b7b22d0c8eb2eef3b01857aba535c80b7b5322231075821a54",
  };
}

test("qualification finalization is atomic with CURRENT validity and audit history", async () => {
  const repository =
    new MemoryPersistenceRepository();
  const service =
    new QualificationHistoryService(
      repository,
    );

  await service.finalizeQualificationRun({
    record: qualifiedRecord(),
    actor: system,
  });

  const state =
    await repository.read();

  assert.equal(
    state.revision,
    1,
  );
  assert.equal(
    state.qualificationRuns.length,
    1,
  );
  assert.equal(
    state.validityEvents.length,
    1,
  );
  assert.equal(
    state.validityEvents[0].state,
    "CURRENT",
  );
  assert.equal(
    state.auditEvents.length,
    1,
  );
  assert.equal(
    state.auditEvents[0].type,
    "QUALIFICATION_FINALIZED",
  );
});

test("duplicate qualification run finalization is rejected without partial history", async () => {
  const repository =
    new MemoryPersistenceRepository();
  const service =
    new QualificationHistoryService(
      repository,
    );

  const record =
    qualifiedRecord();

  await service.finalizeQualificationRun({
    record,
    actor: system,
  });

  const before =
    await repository.read();

  await assert.rejects(
    () =>
      service.finalizeQualificationRun({
        record,
        actor: system,
      }),
    /already finalized/,
  );

  const after =
    await repository.read();

  assert.deepEqual(
    after,
    before,
  );
});

test("viewer cannot approve and denial leaves persistence unchanged", async () => {
  const repository =
    new MemoryPersistenceRepository();
  const service =
    new QualificationHistoryService(
      repository,
    );

  await service.finalizeQualificationRun({
    record: qualifiedRecord(),
    actor: system,
  });

  const before =
    await repository.read();

  await assert.rejects(
    () =>
      service.approve({
        runId: "run-qualified",
        actor: viewer,
        occurredAt:
          "2026-11-14T18:01:00.000Z",
        reason:
          "viewer should not approve",
      }),
    /lacks APPROVER or ADMIN/,
  );

  assert.deepEqual(
    await repository.read(),
    before,
  );
});

test("REVIEW_REQUIRED real-shaped R6 record cannot be approved", async () => {
  const repository =
    new MemoryPersistenceRepository();
  const service =
    new QualificationHistoryService(
      repository,
    );

  await service.finalizeQualificationRun({
    record:
      reviewRequiredRecord(),
    actor: system,
  });

  await assert.rejects(
    () =>
      service.approve({
        runId: "run-real-r6",
        actor: approver,
        occurredAt:
          "2026-11-14T18:01:00.000Z",
        reason:
          "must remain denied",
      }),
    /not QUALIFIED/,
  );

  const decision =
    await service.deploymentDecision(
      "run-real-r6",
    );

  assert.equal(
    decision.allowed,
    false,
  );
  assert.ok(
    decision.reasons.includes(
      "QUALIFICATION_REVIEW_REQUIRED",
    ),
  );
  assert.ok(
    decision.reasons.includes(
      "EXACT_ARTIFACT_BINDING_UNPROVEN",
    ),
  );
});

test("qualified exact-bound CURRENT run can be approved by approver", async () => {
  const repository =
    new MemoryPersistenceRepository();
  const service =
    new QualificationHistoryService(
      repository,
    );

  await service.finalizeQualificationRun({
    record: qualifiedRecord(),
    actor: system,
  });

  const event =
    await service.approve({
      runId: "run-qualified",
      actor: approver,
      occurredAt:
        "2026-11-14T18:01:00.000Z",
      reason:
        "authorization acceptance fixture",
    });

  assert.equal(
    event.state,
    "APPROVED",
  );

  const decision =
    await service.deploymentDecision(
      "run-qualified",
    );

  assert.equal(
    decision.allowed,
    true,
  );
  assert.deepEqual(
    decision.reasons,
    [],
  );
});

test("stale transition denies deployment without deleting approval history", async () => {
  const repository =
    new MemoryPersistenceRepository();
  const service =
    new QualificationHistoryService(
      repository,
    );

  await service.finalizeQualificationRun({
    record: qualifiedRecord(),
    actor: system,
  });

  await service.approve({
    runId: "run-qualified",
    actor: approver,
    occurredAt:
      "2026-11-14T18:01:00.000Z",
    reason:
      "fixture approval",
  });

  await service.markStale({
    runId: "run-qualified",
    actor: system,
    occurredAt:
      "2026-11-14T18:02:00.000Z",
    reason:
      "artifact revision changed",
  });

  const decision =
    await service.deploymentDecision(
      "run-qualified",
    );

  assert.equal(
    decision.allowed,
    false,
  );
  assert.equal(
    decision.authorizationState,
    "APPROVED",
  );
  assert.equal(
    decision.validityState,
    "STALE",
  );
  assert.ok(
    decision.reasons.includes(
      "VALIDITY_STALE",
    ),
  );

  const state =
    await repository.read();

  assert.equal(
    state.authorizationEvents.length,
    1,
  );
  assert.equal(
    state.authorizationEvents[0].state,
    "APPROVED",
  );
});

test("revocation remains append-only and deployment stays denied", async () => {
  const repository =
    new MemoryPersistenceRepository();
  const service =
    new QualificationHistoryService(
      repository,
    );

  await service.finalizeQualificationRun({
    record: qualifiedRecord(),
    actor: system,
  });

  await service.approve({
    runId: "run-qualified",
    actor: approver,
    occurredAt:
      "2026-11-14T18:01:00.000Z",
    reason:
      "fixture approval",
  });

  await service.revoke({
    runId: "run-qualified",
    actor: approver,
    occurredAt:
      "2026-11-14T18:02:00.000Z",
    reason:
      "security review revoked approval",
  });

  const state =
    await repository.read();

  assert.deepEqual(
    state.authorizationEvents.map(
      (event) => event.state,
    ),
    ["APPROVED", "REVOKED"],
  );

  const decision =
    await service.deploymentDecision(
      "run-qualified",
    );

  assert.equal(
    decision.allowed,
    false,
  );
  assert.equal(
    decision.authorizationState,
    "REVOKED",
  );
});

test("file repository persists and reloads append-only history", async () => {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "admissary-r7-",
      ),
    );

  try {
    const path =
      join(
        directory,
        "state.json",
      );

    const repository =
      new JsonFilePersistenceRepository(
        path,
      );

    const service =
      new QualificationHistoryService(
        repository,
      );

    await service.finalizeQualificationRun({
      record: qualifiedRecord(),
      actor: system,
    });

    await service.approve({
      runId: "run-qualified",
      actor: approver,
      occurredAt:
        "2026-11-14T18:01:00.000Z",
      reason:
        "persisted approval",
    });

    const reloaded =
      new JsonFilePersistenceRepository(
        path,
      );

    const reloadedService =
      new QualificationHistoryService(
        reloaded,
      );

    const decision =
      await reloadedService.deploymentDecision(
        "run-qualified",
      );

    assert.equal(
      decision.allowed,
      true,
    );

    const raw =
      JSON.parse(
        await readFile(
          path,
          "utf8",
        ),
      );

    assert.equal(
      raw.revision,
      2,
    );
    assert.equal(
      raw.qualificationRuns.length,
      1,
    );
    assert.equal(
      raw.authorizationEvents.length,
      1,
    );
  } finally {
    await rm(
      directory,
      {
        recursive: true,
        force: true,
      },
    );
  }
});

test("concurrent transactions serialize without lost qualification runs", async () => {
  const repository =
    new MemoryPersistenceRepository();
  const service =
    new QualificationHistoryService(
      repository,
    );

  await Promise.all(
    Array.from(
      { length: 10 },
      (_, index) =>
        service.finalizeQualificationRun({
          record:
            qualifiedRecord(
              `run-${index}`,
            ),
          actor: system,
        }),
    ),
  );

  const state =
    await repository.read();

  assert.equal(
    state.revision,
    10,
  );
  assert.equal(
    state.qualificationRuns.length,
    10,
  );
  assert.equal(
    new Set(
      state.qualificationRuns.map(
        (run) => run.runId,
      ),
    ).size,
    10,
  );
});

test("proof timeline retains qualification, authorization, validity, and audit events", async () => {
  const repository =
    new MemoryPersistenceRepository();
  const service =
    new QualificationHistoryService(
      repository,
    );

  await service.finalizeQualificationRun({
    record: qualifiedRecord(),
    actor: system,
  });

  await service.approve({
    runId: "run-qualified",
    actor: approver,
    occurredAt:
      "2026-11-14T18:01:00.000Z",
    reason:
      "fixture approval",
  });

  await service.markStale({
    runId: "run-qualified",
    actor: system,
    occurredAt:
      "2026-11-14T18:02:00.000Z",
    reason:
      "artifact changed",
  });

  const timeline =
    await service.timeline(
      "run-qualified",
    );

  assert.ok(
    timeline.some(
      (entry) =>
        entry.type ===
        "QUALIFICATION",
    ),
  );
  assert.ok(
    timeline.some(
      (entry) =>
        entry.type ===
        "AUTHORIZATION" &&
        entry.state ===
        "APPROVED",
    ),
  );
  assert.ok(
    timeline.some(
      (entry) =>
        entry.type ===
        "VALIDITY" &&
        entry.state ===
        "STALE",
    ),
  );
  assert.ok(
    timeline.some(
      (entry) =>
        entry.type ===
        "AUDIT",
    ),
  );
});
