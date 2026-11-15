import {
  readdir,
} from "node:fs/promises";
import {
  spawnSync,
} from "node:child_process";

function latest(
  files,
  prefix,
) {
  return files
    .filter(
      (name) =>
        name.startsWith(prefix) &&
        name.endsWith(".json"),
    )
    .sort()
    .at(-1);
}

const files =
  await readdir("results");

const manifest =
  latest(
    files,
    "ADMISSARY_R8_VALID_MANIFEST_",
  );

const context =
  latest(
    files,
    "ADMISSARY_R8_DEPLOYMENT_CONTEXT_",
  );

if (!manifest || !context) {
  throw new Error(
    "R8 verifier fixtures are missing",
  );
}

const result =
  spawnSync(
    process.execPath,
    [
      "scripts/admissary-verify.mjs",
      `results/${manifest}`,
      "--context",
      `results/${context}`,
    ],
    {
      encoding: "utf8",
    },
  );

if (result.status !== 0) {
  throw new Error(
    `Verifier CLI valid fixture failed: ${result.stdout}\n${result.stderr}`,
  );
}

if (
  !result.stdout.includes(
    "ADMISSARY_VERIFY_ALLOWED=YES",
  )
) {
  throw new Error(
    "Verifier CLI did not emit ALLOWED=YES",
  );
}

console.log(
  "R8_CLI_VALID_EXIT=0",
);
console.log(
  "R8_CLI_VALID_ALLOWED=YES",
);
console.log(
  "R8_CLI_GATE=PASS",
);
