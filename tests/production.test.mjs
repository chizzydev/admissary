import test from "node:test";
import assert from "node:assert/strict";
import {
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";

import {
  buildJudgeView,
} from "../dist/index.js";
import {
  createAdmissaryWebServer,
} from "../scripts/admissary-web-lib.mjs";

function fixtureInput() {
  return {
    generatedAt:
      "2026-11-14T18:40:00.000Z",
    contract: {
      id:
        "banking-support-prod",
      version:
        "1.0.0",
      digest:
        "contract-digest",
      workload:
        "customer-support-intent-routing",
      environment:
        "production",
    },
    candidate: {
      model:
        "deepseek-ai/DeepSeek-V4.1-Flash",
      provider:
        "Dolphin",
      providerHost:
        "lighthouse.dphn.ai",
      bindingScope:
        "PROVIDER_MODEL_IDENTITY",
      exactArtifactBindingProven:
        false,
      empiricalFitness:
        "UNFIT",
      overallQualification:
        "REVIEW_REQUIRED",
      deployAllowed:
        false,
    },
    metrics: [],
    empiricalBlockers: [],
    deploymentBlockers: [
      "QUALIFICATION_REVIEW_REQUIRED",
    ],
    missingObligations: [],
    requalification: {
      unchanged: {
        reused: 10,
        recomputed: 0,
      },
      policyChange: {
        reused: [],
        recomputed: [],
      },
      artifactChange: {
        reused: [],
        recomputed: [],
      },
    },
    authorization: {
      approvalDeniedForRealRun:
        true,
      realDeployAllowed:
        false,
      viewerApprovalDenied:
        true,
      fixtureApprovedDeployAllowed:
        true,
      fixtureStaleDeployAllowed:
        false,
      fixtureStaleAuthorization:
        "APPROVED",
      fixtureStaleValidity:
        "STALE",
      fixtureRevokedAuthorization:
        "REVOKED",
    },
    verifier: {
      valid:
        "ALLOW",
      tampered:
        "DENY",
      tamperedReason:
        "MANIFEST_INTEGRITY_ERROR",
      rehashedRevisionChange:
        "DENY",
      rehashedRevisionChangeReason:
        "CANDIDATE_REVISION_MISMATCH",
      stale:
        "DENY",
      staleReason:
        "VALIDITY_NOT_CURRENT",
      unapproved:
        "DENY",
      unapprovedReason:
        "AUTHORIZATION_NOT_APPROVED",
      contractMismatch:
        "DENY",
      contractMismatchReason:
        "CONTRACT_DIGEST_MISMATCH",
      networkCalls: 0,
    },
    integrations: {
      serv: {
        liveArtifactPresent:
          true,
        artifactFile:
          "r3.json",
        role:
          "bounded semantics",
      },
      dolphin: {
        liveArtifactPresent:
          true,
        artifactFile:
          "r5.json",
        runDigest:
          "run-digest",
        cases: 144,
        role:
          "empirical execution",
      },
    },
    artifacts: [],
    candidates: [],
  };
}

async function startServer(
  options,
) {
  const server =
    createAdmissaryWebServer(
      options,
    );

  await new Promise(
    (resolve, reject) => {
      server.once(
        "error",
        reject,
      );

      server.listen(
        0,
        "127.0.0.1",
        resolve,
      );
    },
  );

  const address =
    server.address();

  assert.ok(
    address &&
      typeof address !==
        "string",
  );

  return {
    server,
    base:
      `http://127.0.0.1:${address.port}`,
  };
}

test("production server applies security headers and role boundary", async () => {
  const {server,base}=await startServer({secureTransport:true,authTokens:{admin:"ADMIN",viewer:"VIEWER"}});
  try {
    const health=await fetch(`${base}/health`);assert.equal(health.status,200);
    assert.match(health.headers.get("content-security-policy"),/frame-ancestors 'none'/);
    assert.equal(health.headers.get("x-frame-options"),"DENY");assert.match(health.headers.get("strict-transport-security"),/max-age=31536000/);
    for(const [token,status] of [[null,401],["viewer",403],["admin",200]]) assert.equal((await fetch(`${base}/api/admin/status`,{headers:token?{authorization:`Bearer ${token}`}:{}})).status,status);
  } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test("rate limiter fails closed with 429 and retry-after", async () => {
  const {server,base}=await startServer({rateLimit:{windowMs:60000,max:1}});
  try {assert.equal((await fetch(`${base}/health`)).status,200);const denied=await fetch(`${base}/health`);assert.equal(denied.status,429);assert.ok(denied.headers.get("retry-after"));}
  finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
