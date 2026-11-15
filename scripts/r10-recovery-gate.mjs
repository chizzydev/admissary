import {
  createHash,
} from "node:crypto";
import {
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  join,
} from "node:path";

import {
  JsonFilePersistenceRepository,
  QualificationHistoryService,
  persistenceStateDigest,
} from "../dist/index.js";

const stateBytes =
  await readFile(
    "results/ADMISSARY_R7_STATE.json",
  );

const originalState =
  JSON.parse(
    stateBytes.toString(
      "utf8",
    ),
  );

const originalDigest =
  persistenceStateDigest(
    originalState,
  );

const tempRoot =
  join(
    "results",
    ".r10-recovery-test",
  );

await rm(
  tempRoot,
  {
    recursive: true,
    force: true,
  },
);

await mkdir(
  tempRoot,
  {
    recursive: true,
  },
);

const backupPath =
  join(
    tempRoot,
    "state.backup.json",
  );

const restorePath =
  join(
    tempRoot,
    "state.restored.json",
  );

await writeFile(
  backupPath,
  stateBytes,
);

const backupBytes =
  await readFile(
    backupPath,
  );

await writeFile(
  restorePath,
  backupBytes,
);

const repository =
  new JsonFilePersistenceRepository(
    restorePath,
  );

const restored =
  await repository.read();

const restoredDigest =
  persistenceStateDigest(
    restored,
  );

if (
  restoredDigest !==
  originalDigest
) {
  throw new Error(
    "R10 recovery digest mismatch",
  );
}

const service =
  new QualificationHistoryService(
    repository,
  );

const realDecision =
  await service.deploymentDecision(
    "r6-deepseek-live",
  );

if (
  realDecision.allowed
) {
  throw new Error(
    "Recovered real DeepSeek state unexpectedly became deployable",
  );
}

const fixtureDecision =
  await service.deploymentDecision(
    "authorization-acceptance-fixture",
  );

if (
  fixtureDecision.allowed
) {
  throw new Error(
    "Recovered revoked/stale acceptance fixture unexpectedly became deployable",
  );
}

console.log(
  `R10_RECOVERY_ORIGINAL_DIGEST=${originalDigest}`,
);
console.log(
  `R10_RECOVERY_RESTORED_DIGEST=${restoredDigest}`,
);
console.log(
  `R10_RECOVERY_REVISION=${restored.revision}`,
);
console.log(
  "R10_RECOVERY_REAL_DEPLOY_ALLOWED=NO",
);
console.log(
  "R10_RECOVERY_FIXTURE_DEPLOY_ALLOWED=NO",
);
console.log(
  "R10_RECOVERY_GATE=PASS",
);

await rm(
  tempRoot,
  {
    recursive: true,
    force: true,
  },
);
