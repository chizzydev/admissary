import {
  readFile,
} from "node:fs/promises";
import {
  validateBanking77Suite,
} from "../dist/index.js";

const expectedDigest =
  "8eb57a06283737e394409976cf6bfb011c6537e53c64935065021f5ba39ae5f2";

const spec = JSON.parse(
  await readFile(
    "data/banking77/banking-routing-v1.spec.json",
    "utf8",
  ),
);

const suite = JSON.parse(
  await readFile(
    "data/banking77/banking-routing-v1.json",
    "utf8",
  ),
);

validateBanking77Suite(suite, spec);

if (suite.suiteDigest !== expectedDigest) {
  throw new Error(
    `Frozen BANKING77 digest changed: ${suite.suiteDigest}`,
  );
}

if (
  suite.baselineCases.length !== 120 ||
  suite.adversarialCases.length !== 24 ||
  suite.intents.length !== 12
) {
  throw new Error("Frozen BANKING77 counts changed");
}

console.log(`BANKING77_SUITE_DIGEST=${suite.suiteDigest}`);
console.log(`BANKING77_BASELINE_CASES=${suite.baselineCases.length}`);
console.log(`BANKING77_ADVERSARIAL_CASES=${suite.adversarialCases.length}`);
console.log("ADMISSARY_R4_FROZEN_SUITE_GATE=PASS");
