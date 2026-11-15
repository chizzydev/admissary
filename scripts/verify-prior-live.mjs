import { acceptedHistorical } from "./artifact-integrity.mjs";
import {
  readdir,
  readFile,
} from "node:fs/promises";
import {
  join,
} from "node:path";

async function latest(prefix) { return  (await acceptedHistorical(prefix)).slice(8); }

const r2File = await latest("ADMISSARY_R2_HF_EVIDENCE_");
const r3File = await latest("ADMISSARY_R3_SERV_EVIDENCE_");

const r2 = JSON.parse(
  await readFile(join("results", r2File), "utf8"),
);
const r3 = JSON.parse(
  await readFile(join("results", r3File), "utf8"),
);

if (r2.schema !== "admissary-r2-live-evidence/v1") {
  throw new Error("Latest R2 live artifact has unexpected schema");
}

if (!Array.isArray(r2.targets) || r2.targets.length < 3) {
  throw new Error("Latest R2 live artifact does not contain expected targets");
}

const expectedR2 = new Map([
  ["Qwen/Qwen3-0.6B", "NOT_INDICATED"],
  ["Qwen/Qwen3-4B", "NOT_INDICATED"],
  ["sgugger/custom-resnet50d", "REQUIRED"],
]);

for (const [repository, remoteCode] of expectedR2) {
  const item = r2.targets.find(
    (target) => target.repository === repository,
  );

  if (!item) {
    throw new Error(`R2 artifact missing ${repository}`);
  }

  if (!/^[a-f0-9]{40}$/i.test(item.resolvedRevision)) {
    throw new Error(`R2 artifact has invalid SHA for ${repository}`);
  }

  if (item.remoteCode?.state !== remoteCode) {
    throw new Error(
      `R2 remote-code state changed for ${repository}: ${item.remoteCode?.state}`,
    );
  }

  if (!/^[a-f0-9]{64}$/i.test(item.bundleDigest)) {
    throw new Error(`R2 artifact has invalid bundle digest for ${repository}`);
  }
}

if (r3.schema !== "admissary-r3-live-serv/v1") {
  throw new Error("Latest R3 live artifact has unexpected schema");
}

const expectedR3 = new Map([
  ["SUPPORTED", ["SUPPORTED", "PASS"]],
  ["CONTRADICTED", ["CONTRADICTED", "FAIL"]],
  ["UNRESOLVED", ["UNRESOLVED", "UNKNOWN"]],
]);

for (const [id, expected] of expectedR3) {
  const item = r3.cases?.find((candidate) => candidate.id === id);

  if (!item) {
    throw new Error(`R3 artifact missing ${id}`);
  }

  if (item.result !== expected[0] || item.evidenceState !== expected[1]) {
    throw new Error(
      `R3 artifact mismatch for ${id}: ${item.result}/${item.evidenceState}`,
    );
  }

  if (
    typeof item.responseId !== "string" ||
    item.responseId.length === 0 ||
    !/^[a-f0-9]{64}$/i.test(item.responseDigest)
  ) {
    throw new Error(`R3 artifact lacks provider response identity for ${id}`);
  }
}

console.log(`R2_PRIOR_LIVE_ARTIFACT=${r2File}`);
console.log("R2_PRIOR_LIVE_ARTIFACT_GATE=PASS");
console.log(`R3_PRIOR_LIVE_ARTIFACT=${r3File}`);
console.log("R3_PRIOR_LIVE_ARTIFACT_GATE=PASS");
console.log("ADMISSARY_PRIOR_LIVE_REGRESSION_GATE=PASS");
