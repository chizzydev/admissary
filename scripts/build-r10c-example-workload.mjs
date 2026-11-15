import {
  readFile,
  writeFile,
} from "node:fs/promises";

import {
  buildWorkloadPack,
  verifyWorkloadPack,
} from "../dist/index.js";

const input =
  JSON.parse(
    await readFile(
      "data/workloads/release-risk-triage-v1.input.json",
      "utf8",
    ),
  );

const pack =
  buildWorkloadPack(
    input,
  );

if (
  !verifyWorkloadPack(
    pack,
  )
) {
  throw new Error(
    "Example workload pack digest verification failed",
  );
}

await writeFile(
  "data/workloads/release-risk-triage-v1.workload.json",
  JSON.stringify(
    pack,
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(
  `R10C_EXAMPLE_PACK_DIGEST=${pack.packDigest}`,
);
console.log(
  `R10C_EXAMPLE_PACK_CASES=${pack.cases.length}`,
);
console.log(
  `R10C_EXAMPLE_PACK_METRICS=${pack.metrics.length}`,
);
console.log(
  "R10C_EXAMPLE_PACK_GATE=PASS",
);
