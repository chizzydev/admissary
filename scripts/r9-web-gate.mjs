import {
  readFile,
} from "node:fs/promises";
import {
  createAdmissaryWebServer,
} from "./admissary-web-lib.mjs";

const snapshot = JSON.parse(
  await readFile("web/demo-snapshot.json", "utf8"),
);

if (snapshot.schema !== "admissary-judge-view/v1") {
  throw new Error("R9 judge snapshot schema mismatch");
}

if (snapshot.candidate.model !== "deepseek-ai/DeepSeek-V4.1-Flash") {
  throw new Error("R9 judge snapshot lost canonical DeepSeek model identity");
}

if (snapshot.candidate.empiricalFitness !== "UNFIT") {
  throw new Error("R9 judge snapshot lost real empirical UNFIT state");
}

if (snapshot.candidate.overallQualification !== "REVIEW_REQUIRED") {
  throw new Error("R9 judge snapshot misrepresents full qualification state");
}

if (snapshot.candidate.deployAllowed !== false) {
  throw new Error("R9 judge snapshot incorrectly marks real candidate deployable");
}

if (!snapshot.empiricalBlockers.includes("EVAL_CRITICAL_INTENT_RECALL") ||
    !snapshot.empiricalBlockers.includes("EVAL_SCHEMA_VALIDITY")) {
  throw new Error("R9 judge snapshot lost real empirical blockers");
}

if (snapshot.integrations.serv.liveArtifactPresent !== true ||
    snapshot.integrations.dolphin.liveArtifactPresent !== true) {
  throw new Error("R9 judge snapshot lost live sponsor evidence provenance");
}

const html = await readFile("web/index.html", "utf8");
const css = await readFile("web/styles.css", "utf8");
const app = await readFile("web/app.js", "utf8");
const serverSource = await readFile("scripts/admissary-web-lib.mjs", "utf8");

if (!html.includes('name="viewport"')) {
  throw new Error("R9 web UI is missing viewport metadata");
}

if (!css.includes("@media (max-width: 600px)")) {
  throw new Error("R9 web UI is missing mobile responsive rules");
}

for (const [label, source] of [
  ["index.html", html],
  ["styles.css", css],
  ["app.js", app],
  ["server", serverSource],
]) {
  for (const forbidden of [
    "SERV_API_KEY",
    "DOLPHIN_API_KEY",
    "Authorization: Bearer",
  ]) {
    if (source.includes(forbidden)) {
      throw new Error(`${label} exposes forbidden secret marker ${forbidden}`);
    }
  }
}

const server = createAdmissaryWebServer({
  snapshotPath: "web/demo-snapshot.json",
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

try {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("R9 server address unavailable");
  }

  const base = `http://127.0.0.1:${address.port}`;

  const healthResponse = await fetch(`${base}/health`);
  if (!healthResponse.ok) throw new Error(`R9 health HTTP ${healthResponse.status}`);
  const health = await healthResponse.json();
  if (health.status !== "ok" || health.providerCalls !== 0) {
    throw new Error("R9 health contract failed");
  }

  const rootResponse = await fetch(`${base}/`);
  if (!rootResponse.ok) throw new Error(`R9 root HTTP ${rootResponse.status}`);
  const root = await rootResponse.text();
  if (!root.includes('id="workspace"') || !app.includes("THE MEMORABLE ATTACK") || !app.includes("What prevents this model from shipping?")) {
    throw new Error("R9 root page is missing judge-memory surfaces");
  }

  const judgeResponse = await fetch(`${base}/api/judge`);
  if (!judgeResponse.ok) throw new Error(`R9 judge API HTTP ${judgeResponse.status}`);
  const judge = await judgeResponse.json();
  if (judge.snapshotDigest !== snapshot.snapshotDigest) {
    throw new Error("R9 judge API changed snapshot identity");
  }

  const scenarios = {
    valid: [true, null],
    revision: [false, "CANDIDATE_REVISION_MISMATCH"],
    contract: [false, "CONTRACT_DIGEST_MISMATCH"],
    stale: [false, "VALIDITY_NOT_CURRENT"],
    unapproved: [false, "AUTHORIZATION_NOT_APPROVED"],
  };

  for (const [scenario, [allowed, expectedReason]] of Object.entries(scenarios)) {
    const response = await fetch(`${base}/api/verify-demo?scenario=${scenario}`);
    if (!response.ok) throw new Error(`R9 verifier scenario ${scenario} HTTP ${response.status}`);
    const body = await response.json();
    if (body.result.allowed !== allowed) {
      throw new Error(`R9 verifier scenario ${scenario} allowed=${body.result.allowed}`);
    }
    if (expectedReason && !body.result.reasons.some((reason) => reason.code === expectedReason)) {
      throw new Error(`R9 verifier scenario ${scenario} missing ${expectedReason}`);
    }
  }

  console.log(`R9_WEB_PORT=${address.port}`);
  console.log("R9_HEALTH_GATE=PASS");
  console.log("R9_JUDGE_API_GATE=PASS");
  console.log("R9_RESPONSIVE_STATIC_GATE=PASS");
  console.log("R9_PUBLIC_SURFACE_SECRET_MARKERS=PASS");
  console.log("R9_VERIFIER_INTERACTION_GATE=PASS");
  console.log("R9_NO_KEY_JUDGE_VIEW=PASS");
  console.log("ADMISSARY_R9_WEB_GATE=PASS");
} finally {
  if (typeof server.closeIdleConnections === "function") {
    server.closeIdleConnections();
  }

  if (typeof server.closeAllConnections === "function") {
    server.closeAllConnections();
  }

  await new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }

    server.close(() => resolve());
  });
}
