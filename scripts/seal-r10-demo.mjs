import { acceptedHistorical } from "./artifact-integrity.mjs";
import {
  createHash,
} from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import {
  join,
} from "node:path";

import {
  digestCanonicalJson,
} from "../dist/index.js";

function sha256(
  bytes,
) {
  return createHash(
    "sha256",
  )
    .update(bytes)
    .digest("hex");
}

async function latest(prefix) { return await acceptedHistorical(prefix); }

const snapshotBytes =
  await readFile(
    "web/demo-snapshot.json",
  );

const snapshot =
  JSON.parse(
    snapshotBytes.toString(
      "utf8",
    ),
  );

if (
  snapshot.schema !==
  "admissary-judge-view/v1"
) {
  throw new Error(
    "R10 seed snapshot schema mismatch",
  );
}

const {
  snapshotDigest,
  ...snapshotPayload
} = snapshot;

const recomputedSnapshotDigest =
  digestCanonicalJson(
    snapshotPayload,
  );

if (
  recomputedSnapshotDigest !==
  snapshotDigest
) {
  throw new Error(
    "R10 seed snapshot digest verification failed",
  );
}

if (
  snapshot.candidate?.model !==
    "deepseek-ai/DeepSeek-V4.1-Flash" ||
  snapshot.candidate?.empiricalFitness !==
    "UNFIT" ||
  snapshot.candidate?.overallQualification !==
    "REVIEW_REQUIRED" ||
  snapshot.candidate?.deployAllowed !==
    false
) {
  throw new Error(
    "R10 seed snapshot lost canonical real-evidence truth",
  );
}

const verifierManifestPath = "data/verifier-fixtures/qualification-manifest.json";
const verifierContextPath = "data/verifier-fixtures/deployment-context.json";

const verifierManifestBytes =
  await readFile(
    verifierManifestPath,
  );

const verifierContextBytes =
  await readFile(
    verifierContextPath,
  );

await mkdir(
  "deploy/seed",
  {
    recursive: true,
  },
);

const seedFiles = [
  {
    name:
      "demo-snapshot.json",
    bytes:
      snapshotBytes,
    provenance:
      "REAL_R2_R9_DERIVED_JUDGE_SNAPSHOT",
  },
  {
    name:
      "verifier-manifest.json",
    bytes:
      verifierManifestBytes,
    provenance:
      "EXPLICIT_R8_ACCEPTANCE_FIXTURE",
  },
  {
    name:
      "deployment-context.json",
    bytes:
      verifierContextBytes,
    provenance:
      "EXPLICIT_R8_ACCEPTANCE_FIXTURE",
  },
];

for (
  const file of
  seedFiles
) {
  await writeFile(
    join(
      "deploy/seed",
      file.name,
    ),
    file.bytes,
  );
}

const manifest = {
  schema:
    "admissary-production-seed/v1",
  createdAt:
    new Date().toISOString(),
  judgeSnapshot: {
    snapshotDigest,
    model:
      snapshot.candidate.model,
    empiricalFitness:
      snapshot.candidate.empiricalFitness,
    overallQualification:
      snapshot.candidate.overallQualification,
    deployAllowed:
      snapshot.candidate.deployAllowed,
  },
  files:
    seedFiles.map(
      (file) => ({
        name:
          file.name,
        sha256:
          sha256(
            file.bytes,
          ),
        provenance:
          file.provenance,
      }),
    ),
};

const seedDigest =
  digestCanonicalJson(
    manifest,
  );

await writeFile(
  "deploy/seed/SEED_MANIFEST.json",
  JSON.stringify(
    {
      ...manifest,
      seedDigest,
    },
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(
  `R10_SEED_SNAPSHOT_DIGEST=${snapshotDigest}`,
);
console.log(
  `R10_SEED_DIGEST=${seedDigest}`,
);
console.log(
  `R10_SEED_FILES=${seedFiles.length}`,
);
console.log(
  "R10_SEED_REAL_MODEL=deepseek-ai/DeepSeek-V4.1-Flash",
);
console.log(
  "R10_SEED_REAL_DEPLOY_ALLOWED=NO",
);
console.log(
  "R10_SEED_GATE=PASS",
);
