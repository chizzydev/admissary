import {
  readdir,
  readFile,
} from "node:fs/promises";
import {
  join,
} from "node:path";

import {
  verifyDolphinRunIntegrity,
} from "../dist/index.js";

const EXPECTED_RUN_DIGEST =
  "1e56c082af49d232f834b67cc09901627557b019ef0eca32b12eafca8eae1628";

const EXPECTED_SUITE_DIGEST =
  "8eb57a06283737e394409976cf6bfb011c6537e53c64935065021f5ba39ae5f2";

const EXPECTED_MODEL =
  "deepseek-ai/DeepSeek-V4.1-Flash";

const files = (await readdir("results"))
  .filter(
    (name) =>
      name.startsWith(
        "ADMISSARY_R5_DOLPHIN_",
      ) &&
      name.endsWith(".json"),
  )
  .sort();

if (files.length === 0) {
  throw new Error(
    "No completed R5 Dolphin result artifact found",
  );
}

let matched = null;
let matchedFile = null;

for (const file of files) {
  const candidate = JSON.parse(
    await readFile(
      join("results", file),
      "utf8",
    ),
  );

  if (
    candidate.runDigest ===
    EXPECTED_RUN_DIGEST
  ) {
    matched = candidate;
    matchedFile = file;
    break;
  }
}

if (!matched || !matchedFile) {
  throw new Error(
    `Completed R5 artifact with canonical run digest ${EXPECTED_RUN_DIGEST} was not found`,
  );
}

if (
  matched.schema !==
  "admissary-dolphin-evaluation/v1"
) {
  throw new Error(
    "R5 artifact schema mismatch",
  );
}

if (!verifyDolphinRunIntegrity(matched)) {
  throw new Error(
    "R5 artifact run digest verification failed",
  );
}

if (
  matched.suiteDigest !==
  EXPECTED_SUITE_DIGEST
) {
  throw new Error(
    "R5 artifact suite digest mismatch",
  );
}

if (
  matched.requestedModel !==
    EXPECTED_MODEL ||
  matched.responseModel !==
    EXPECTED_MODEL
) {
  throw new Error(
    "R5 artifact model identity mismatch",
  );
}

if (
  !Array.isArray(matched.cases) ||
  matched.cases.length !== 144
) {
  throw new Error(
    `R5 artifact does not contain 144 cases`,
  );
}

if (
  matched.metrics.macro_f1 !==
    0.8914084502164502 &&
  Math.abs(
    matched.metrics.macro_f1 -
      0.891408,
  ) > 0.000001
) {
  throw new Error(
    `R5 macro F1 changed: ${matched.metrics.macro_f1}`,
  );
}

if (
  Math.abs(
    matched.metrics.critical_intent_recall -
      0.825,
  ) > 0.000001
) {
  throw new Error(
    "R5 critical-intent recall changed",
  );
}

if (
  Math.abs(
    matched.metrics.schema_validity -
      0.9930555555555556,
  ) > 0.000001
) {
  throw new Error(
    "R5 schema validity changed",
  );
}

if (
  Math.abs(
    matched.metrics.injection_invariance -
      0.9583333333333334,
  ) > 0.000001
) {
  throw new Error(
    "R5 injection invariance changed",
  );
}

if (
  Math.abs(
    matched.metrics.p95_latency_ms -
      3817,
  ) > 0.01
) {
  throw new Error(
    "R5 p95 latency changed",
  );
}

if (matched.mandatoryMetricsPass !== false) {
  throw new Error(
    "R5 artifact unexpectedly reports mandatory metrics PASS",
  );
}

console.log(
  `R5_PRIOR_LIVE_ARTIFACT=${matchedFile}`,
);
console.log(
  `R5_PRIOR_LIVE_RUN_DIGEST=${matched.runDigest}`,
);
console.log(
  `R5_PRIOR_LIVE_CASES=${matched.cases.length}`,
);
console.log(
  "R5_PRIOR_LIVE_EMPIRICAL_FITNESS=UNFIT",
);
console.log(
  "R5_PRIOR_LIVE_ARTIFACT_GATE=PASS",
);
