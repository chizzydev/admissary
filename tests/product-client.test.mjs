import test from "node:test";
import assert from "node:assert/strict";

import {
  AdmissaryProductClient,
} from "../dist/index.js";

test("typed product client targets stable operator API routes", async () => {
  const calls = [];

  const client =
    new AdmissaryProductClient({
      async request(
        input,
      ) {
        calls.push(input);

        if (
          input.path ===
          "/v1/product/overview"
        ) {
          return {
            schema:
              "admissary-product-overview/v1",
          };
        }

        if (
          input.path ===
          "/v1/product/guidance"
        ) {
          return {
            schema:
              "admissary-product-guidance-response/v1",
          };
        }

        return {
          schema:
            "admissary-product-selection-response/v1",
        };
      },
    });

  await client.overview();
  await client.guidance();
  await client.selectCandidates({
    schema:
      "admissary-product-selection-request/v1",
    candidateIds: [],
    policy: {
      schema:
        "admissary-candidate-selection-policy/v1",
      requireExactArtifactBinding:
        true,
      allowedProviders:
        null,
      maxP95LatencyMs:
        null,
      maxCostPerMillionTokensUsd:
        null,
      maxModelSizeB:
        null,
      objectiveOrder: [
        "p95LatencyMs",
      ],
    },
  });

  assert.deepEqual(
    calls.map(
      (call) => [
        call.method,
        call.path,
      ],
    ),
    [
      [
        "GET",
        "/v1/product/overview",
      ],
      [
        "GET",
        "/v1/product/guidance",
      ],
      [
        "POST",
        "/v1/product/selection",
      ],
    ],
  );
});


test("typed product client exposes lifecycle routes without judge-only paths", async () => {
  const calls = [];
  const client = new AdmissaryProductClient({
    async request(input) {
      calls.push(input);
      return {};
    },
  });

  await client.candidates();
  await client.contracts();
  await client.startQualification({
    schema: "admissary-product-start-qualification/v1",
    candidateId: "c",
    contractId: "x",
    contractVersion: "1",
    requestedAt: "2026-11-14T20:00:00.000Z",
    reason: "test",
  });
  await client.qualification("run");
  await client.blockers("run");
  await client.deployments("STALE", "2026-11-14T20:00:00.000Z");
  await client.requestRequalification("deployment", {
    schema: "admissary-product-requalification-request/v1",
    requestedAt: "2026-11-14T20:00:00.000Z",
    reason: "test",
  });
  await client.attestation("deployment");

  assert.deepEqual(
    calls.map((call) => [call.method, call.path]),
    [
      ["GET", "/v1/product/candidates"],
      ["GET", "/v1/product/contracts"],
      ["POST", "/v1/product/qualifications"],
      ["GET", "/v1/product/qualifications/run"],
      ["GET", "/v1/product/qualifications/run/blockers"],
      ["GET", "/v1/product/deployments?validity=STALE&now=2026-11-14T20%3A00%3A00.000Z"],
      ["POST", "/v1/product/deployments/deployment/requalification"],
      ["GET", "/v1/product/deployments/deployment/attestation"],
    ],
  );
});


test("typed product client exposes audit, rollback and canonical-case routes", async () => {
  const calls = [];
  const client =
    new AdmissaryProductClient({
      async request(input) {
        calls.push(input);
        return {};
      },
    });

  await client.currentAdmission(
    "deployment",
    {
      schema:
        "admissary-current-deployment-admission-request/v1",
      context: {},
    },
  );

  await client.auditDeployment(
    "deployment",
    "2026-11-14T20:00:00.000Z",
  );

  await client.rollbackTargets(
    "deployment",
    "2026-11-14T20:00:00.000Z",
  );

  await client.canonicalCases();

  assert.deepEqual(
    calls.map(
      (call) => [
        call.method,
        call.path,
      ],
    ),
    [
      [
        "POST",
        "/v1/product/deployments/deployment/admission",
      ],
      [
        "GET",
        "/v1/product/deployments/deployment/audit?now=2026-11-14T20%3A00%3A00.000Z",
      ],
      [
        "GET",
        "/v1/product/deployments/deployment/rollback-targets?now=2026-11-14T20%3A00%3A00.000Z",
      ],
      [
        "GET",
        "/v1/product/scenarios",
      ],
    ],
  );
});
