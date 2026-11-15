import test from "node:test";
import assert from "node:assert/strict";

import {
  ContinuousAssuranceService,
  MemoryAssuranceRepository,
  compareHuggingFaceWatchSnapshots,
  digestCanonicalJson,
} from "../dist/index.js";

const baseIdentity = {
  candidateRepository:
    "example/model",
  candidateRevision:
    "a".repeat(40),
  tokenizerRevision:
    "b".repeat(40),
  artifactManifestDigest:
    "artifact-digest",
  contractId:
    "contract",
  contractVersion:
    "1.0.0",
  contractDigest:
    "contract-digest",
  policyVersion:
    "1.0.0",
  policyDigest:
    "policy-digest",
  evaluationSuite:
    "suite",
  evaluationDigest:
    "evaluation-digest",
  evidenceGraphRootDigest:
    "graph-root",
  environmentId:
    "production",
  workloadId:
    "banking",
};

function watchSnapshot(
  revision =
    "a".repeat(40),
) {
  const payload = {
    schema:
      "admissary-hf-watch-snapshot/v1",
    repository:
      "example/model",
    requestedRevision:
      "main",
    resolvedRevision:
      revision,
    modelMetadataDigest:
      "metadata",
    fileManifestDigest:
      "files",
    modelCardDigest:
      "card",
    licenseDigest:
      "license",
    configDigest:
      "config",
    remoteCodeDigest:
      "remote",
    evidenceBundleDigest:
      "bundle",
    capturedAt:
      "2026-11-14T20:00:00.000Z",
  };

  return {
    ...payload,
    snapshotDigest:
      digestCanonicalJson(
        payload,
      ),
  };
}

async function fixture() {
  const repository =
    new MemoryAssuranceRepository();

  const service =
    new ContinuousAssuranceService(
      repository,
    );

  await service.registerDeployment({
    deployment: {
      deploymentId:
        "deployment-1",
      qualificationRunId:
        "qualification-1",
      qualificationState:
        "QUALIFIED",
      exactArtifactBindingProven:
        true,
      identity:
        structuredClone(
          baseIdentity,
        ),
      lifecycleState:
        "CURRENT",
      activeApprovalId:
        null,
      monitoringStatus:
        "HEALTHY",
      monitoringPolicy: {
        maxEvidenceAgeMs:
          60 * 60 * 1000,
        failClosedWhenOverdue:
          true,
      },
      lastSuccessfulCheckAt:
        "2026-11-14T20:00:00.000Z",
      lastCheckAt:
        "2026-11-14T20:00:00.000Z",
      latestInvalidatedNodes:
        [],
      createdAt:
        "2026-11-14T20:00:00.000Z",
      updatedAt:
        "2026-11-14T20:00:00.000Z",
    },
    occurredAt:
      "2026-11-14T20:00:00.000Z",
  });

  const approval =
    await service.approve({
      deploymentId:
        "deployment-1",
      actorId:
        "approver",
      issuedAt:
        "2026-11-14T20:01:00.000Z",
      expiresAt:
        "2026-11-14T22:01:00.000Z",
      reason:
        "Approved exact deployment",
    });

  return {
    repository,
    service,
    approval,
  };
}

test("scoped approval allows exact current deployment", async () => {
  const {
    service,
  } =
    await fixture();

  const decision =
    await service.decision(
      "deployment-1",
      "2026-11-14T20:10:00.000Z",
    );

  assert.equal(
    decision.allowed,
    true,
  );
});

test("watch error degrades monitoring without fabricating identity drift", async () => {
  const {
    service,
  } =
    await fixture();

  await service.recordWatchError({
    deploymentId:
      "deployment-1",
    checkedAt:
      "2026-11-14T20:10:00.000Z",
    previousSnapshotDigest:
      "previous",
    errorCode:
      "HF_TIMEOUT",
    errorDetail:
      "timeout",
  });

  const decision =
    await service.decision(
      "deployment-1",
      "2026-11-14T20:20:00.000Z",
    );

  assert.equal(
    decision.allowed,
    true,
  );

  assert.equal(
    decision.monitoringStatus,
    "DEGRADED",
  );

  const state =
    await service.state();

  assert.equal(
    state.deployments[0]
      .identity
      .candidateRevision,
    "a".repeat(40),
  );

  assert.equal(
    state.reassessments.length,
    0,
  );
});

test("material revision change preserves historical approval but denies old scope", async () => {
  const {
    service,
    approval,
  } =
    await fixture();

  const comparison =
    compareHuggingFaceWatchSnapshots(
      watchSnapshot(
        "a".repeat(40),
      ),
      watchSnapshot(
        "c".repeat(40),
      ),
    );

  const nextIdentity =
    structuredClone(
      baseIdentity,
    );

  nextIdentity.candidateRevision =
    "c".repeat(40);

  const {
    reassessment,
  } =
    await service.recordMaterialChange({
      deploymentId:
        "deployment-1",
      checkedAt:
        "2026-11-14T20:15:00.000Z",
      comparison,
      nextIdentity,
      reason:
        "Hugging Face revision changed",
    });

  const decision =
    await service.decision(
      "deployment-1",
      "2026-11-14T20:16:00.000Z",
    );

  assert.equal(
    decision.allowed,
    false,
  );

  assert.ok(
    decision.reasons.includes(
      "LIFECYCLE_REASSESSMENT_REQUIRED",
    ),
  );

  assert.ok(
    decision.reasons.includes(
      "APPROVAL_SCOPE_MISMATCH",
    ),
  );

  const state =
    await service.state();

  assert.equal(
    state.approvals.find(
      (item) =>
        item.approvalId ===
        approval.approvalId,
    )?.state,
    "APPROVED",
  );

  assert.equal(
    reassessment.status,
    "REQUESTED",
  );
});

test("reassessment never inherits historical approval", async () => {
  const {
    service,
  } =
    await fixture();

  const comparison =
    compareHuggingFaceWatchSnapshots(
      watchSnapshot(
        "a".repeat(40),
      ),
      watchSnapshot(
        "c".repeat(40),
      ),
    );

  const nextIdentity =
    structuredClone(
      baseIdentity,
    );

  nextIdentity.candidateRevision =
    "c".repeat(40);

  const {
    reassessment,
  } =
    await service.recordMaterialChange({
      deploymentId:
        "deployment-1",
      checkedAt:
        "2026-11-14T20:15:00.000Z",
      comparison,
      nextIdentity,
      reason:
        "revision changed",
    });

  await service.completeReassessment({
    deploymentId:
      "deployment-1",
    requestId:
      reassessment.requestId,
    replacementQualificationRunId:
      "qualification-2",
    qualificationState:
      "QUALIFIED",
    exactArtifactBindingProven:
      true,
    evidenceGraphRootDigest:
      "graph-root-2",
    completedAt:
      "2026-11-14T20:30:00.000Z",
  });

  const beforeNewApproval =
    await service.decision(
      "deployment-1",
      "2026-11-14T20:31:00.000Z",
    );

  assert.equal(
    beforeNewApproval.allowed,
    false,
  );

  assert.ok(
    beforeNewApproval.reasons.includes(
      "APPROVAL_NONE",
    ),
  );

  await service.approve({
    deploymentId:
      "deployment-1",
    actorId:
      "approver-2",
    issuedAt:
      "2026-11-14T20:32:00.000Z",
    expiresAt:
      "2026-11-14T22:32:00.000Z",
    reason:
      "Approved reassessed exact deployment",
  });

  assert.equal(
    (
      await service.decision(
        "deployment-1",
        "2026-11-14T20:33:00.000Z",
      )
    ).allowed,
    true,
  );
});

test("approval expiry and revocation deny independently", async () => {
  {
    const {
      service,
    } =
      await fixture();

    await service.expireApproval({
      deploymentId:
        "deployment-1",
      occurredAt:
        "2026-11-14T22:02:00.000Z",
    });

    const decision =
      await service.decision(
        "deployment-1",
        "2026-11-14T22:03:00.000Z",
      );

    assert.equal(
      decision.allowed,
      false,
    );

    assert.ok(
      decision.reasons.includes(
        "LIFECYCLE_EXPIRED",
      ),
    );
  }

  {
    const {
      service,
    } =
      await fixture();

    await service.revokeApproval({
      deploymentId:
        "deployment-1",
      actorId:
        "security",
      occurredAt:
        "2026-11-14T20:20:00.000Z",
      reason:
        "Incident response",
    });

    const decision =
      await service.decision(
        "deployment-1",
        "2026-11-14T20:21:00.000Z",
      );

    assert.equal(
      decision.allowed,
      false,
    );

    assert.ok(
      decision.reasons.includes(
        "LIFECYCLE_REVOKED",
      ),
    );
  }
});

test("monitoring grace eventually fails closed without pretending drift occurred", async () => {
  const {
    service,
  } =
    await fixture();

  await service.recordWatchError({
    deploymentId:
      "deployment-1",
    checkedAt:
      "2026-11-14T20:10:00.000Z",
    previousSnapshotDigest:
      "previous",
    errorCode:
      "HF_NETWORK_ERROR",
    errorDetail:
      "offline",
  });

  const decision =
    await service.decision(
      "deployment-1",
      "2026-11-14T21:01:00.001Z",
    );

  assert.equal(
    decision.allowed,
    false,
  );

  assert.ok(
    decision.reasons.includes(
      "ASSURANCE_CHECK_OVERDUE",
    ),
  );

  const state =
    await service.state();

  assert.equal(
    state.reassessments.length,
    0,
  );
});


test("historical R2 summary contract is revision-level evidence, not a full HF bundle", () => {
  const historicalR2 = {
    schema:
      "admissary-r2-live-evidence/v1",
    targets: [
      {
        repository:
          "Qwen/Qwen3-0.6B",
        requestedRevision:
          "main",
        resolvedRevision:
          "c".repeat(40),
        fileCount:
          11,
        modelCard:
          true,
        licenseFile:
          false,
        config:
          true,
        remoteCode: {
          state:
            "NOT_INDICATED",
        },
        bundleDigest:
          "d".repeat(64),
      },
    ],
  };

  const target =
    historicalR2.targets.find(
      (item) =>
        item.repository ===
        "Qwen/Qwen3-0.6B",
    );

  assert.equal(
    historicalR2.schema,
    "admissary-r2-live-evidence/v1",
  );

  assert.ok(target);
  assert.equal(
    target.resolvedRevision,
    "c".repeat(40),
  );
  assert.equal(
    "modelMetadata" in target,
    false,
  );
  assert.equal(
    "fileManifest" in target,
    false,
  );
});
