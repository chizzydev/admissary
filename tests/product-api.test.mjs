import { fixtureEvidence, completionInput } from "../scripts/remediation-fixtures.mjs";
import { digestCanonicalJson } from "../dist/index.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  unlink,
  writeFile,
} from "node:fs/promises";

import {
  createAdmissaryWebServer,
} from "../scripts/admissary-web-lib.mjs";

async function ignoreMissing(path) {
  try { await unlink(path); } catch (error) {
    if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
  }
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  if (typeof server.closeIdleConnections === "function") server.closeIdleConnections();
  if (typeof server.closeAllConnections === "function") server.closeAllConnections();
  await new Promise((resolve) => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
  });
}

async function request(base, path, { method = "GET", token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload = null;
  try { payload = await response.json(); } catch {}
  return { response, payload };
}

test("product lifecycle API enforces distinct operator/admin/approver roles", async () => {
  const productPath = "results/.r10c5-product-api-test.json";
  const assurancePath = "results/.r10c5-assurance-api-test.json";
  const snapshotPath = "results/.r10c5-snapshot-api-test.json";
  await Promise.all([
    ignoreMissing(productPath),
    ignoreMissing(assurancePath),
    ignoreMissing(snapshotPath),
  ]);

  await writeFile(
    snapshotPath,
    JSON.stringify({
      schema: "admissary-judge-view/v1",
      snapshotDigest: "test-snapshot",
      candidate: { model: "test/model" },
    }) + "\n",
    "utf8",
  );

  const tokens = {
    viewer: "viewer",
    operator: "operator",
    approver: "approver",
    admin: "admin",
  };

  const server = createAdmissaryWebServer({
    mode: "test",
    snapshotPath: "web/demo-snapshot.json",
    completionEvidenceResolver: async (r,c,k) => fixtureEvidence(c,k),
    productStatePath: productPath,
    productAssuranceStatePath: assurancePath,
    authTokens: {
      [tokens.viewer]: "VIEWER",
      [tokens.operator]: "OPERATOR",
      [tokens.approver]: "APPROVER",
      [tokens.admin]: "ADMIN",
    },
  });

  const base = await listen(server);
  try {
    const publicView = await request(base, "/v1/product/judge-view");
    assert.equal(publicView.response.status, 200);
    assert.match(publicView.payload.snapshotDigest, /^[a-f0-9]{64}$/);

    const candidateBody = {
      schema: "admissary-product-register-candidate/v1",
      candidateId: "candidate",
      displayName: "Candidate",
      provider: "TEST",
      repositoryOrModelId: "example/model",
      revision: "a".repeat(40),
      tokenizerRevision: "b".repeat(40),
      artifactManifestDigest: digestCanonicalJson({fixture:"artifact"}),
      occurredAt: "2026-11-14T20:00:00.000Z",
    };

    assert.equal(
      (await request(base, "/v1/product/candidates", { method: "POST", token: tokens.viewer, body: candidateBody })).response.status,
      403,
    );
    assert.equal(
      (await request(base, "/v1/product/candidates", { method: "POST", token: tokens.operator, body: candidateBody })).response.status,
      201,
    );

    const contractBody = {
      schema: "admissary-product-register-contract/v1",
      contractId: "contract",
      version: "1.0.0",
      digest: digestCanonicalJson({fixture:"contract-digest"}),
      workloadId: "workload",
      environmentId: "prod",
      occurredAt: "2026-11-14T20:00:01.000Z",
    };
    assert.equal(
      (await request(base, "/v1/product/contracts", { method: "POST", token: tokens.operator, body: contractBody })).response.status,
      201,
    );

    const start = await request(base, "/v1/product/qualifications", {
      method: "POST",
      token: tokens.operator,
      body: {
        schema: "admissary-product-start-qualification/v1",
        candidateId: "candidate",
        contractId: "contract",
        contractVersion: "1.0.0",
        requestedAt: "2026-11-14T20:00:02.000Z",
        reason: "test",
      },
    });
    assert.equal(start.response.status, 202);
    assert.equal(start.payload.executionStatus, "REQUESTED_NOT_RUN");
    assert.equal(start.payload.providerCalls, 0);

    const runId = start.payload.run.runId;
    const completionBody = {
      schema: "admissary-product-complete-qualification/v1",
      ...completionInput(fixtureEvidence(candidateBody, contractBody)),
      completedAt: "2026-11-14T20:00:03.000Z",
    };

    assert.equal(
      (await request(base, `/v1/product/qualifications/${runId}/complete`, { method: "POST", token: tokens.operator, body: completionBody })).response.status,
      403,
    );
    assert.equal(
      (await request(base, `/v1/product/qualifications/${runId}/complete`, { method: "POST", token: tokens.admin, body: completionBody })).response.status,
      200,
    );

    assert.equal(
      (await request(base, "/v1/product/deployments", {
        method: "POST",
        token: tokens.operator,
        body: {
          schema: "admissary-product-create-deployment/v1",
          deploymentId: "deployment",
          runId,
          createdAt: "2026-11-14T20:00:04.000Z",
          maxEvidenceAgeMs: 3600000,
        },
      })).response.status,
      201,
    );

    assert.equal(
      (await request(base, "/v1/product/deployments/deployment/approve", {
        method: "POST",
        token: tokens.operator,
        body: {
          schema: "admissary-product-approval-request/v1",
          issuedAt: "2026-11-14T20:00:05.000Z",
          expiresAt: null,
          reason: "approve",
        },
      })).response.status,
      403,
    );

    assert.equal(
      (await request(base, "/v1/product/deployments/deployment/approve", {
        method: "POST",
        token: tokens.approver,
        body: {
          schema: "admissary-product-approval-request/v1",
          issuedAt: "2026-11-14T20:00:05.000Z",
          expiresAt: null,
          reason: "approve",
        },
      })).response.status,
      200,
    );

    const view = await request(base, "/v1/product/deployments/deployment?now=2026-11-14T20%3A00%3A06.000Z", { token: tokens.viewer });
    assert.equal(view.response.status, 200);
    assert.equal(view.payload.view.decision.allowed, true);
  } finally {
    await close(server);
    await Promise.all([
      ignoreMissing(productPath),
      ignoreMissing(assurancePath),
      ignoreMissing(snapshotPath),
    ]);
  }
});
