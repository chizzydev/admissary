import {
  createHash,
} from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import {
  generateBanking77Suite,
  validateBanking77Suite,
} from "../dist/index.js";

const specPath = "data/banking77/banking-routing-v1.spec.json";
const suitePath = "data/banking77/banking-routing-v1.json";

const spec = JSON.parse(
  await readFile(specPath, "utf8"),
);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fetchSource(url, attempts = 4) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        cache: "no-store",
        headers: {
          "User-Agent": "Admissary/0.4 BANKING77-freezer",
          "Accept": "text/csv,text/plain;q=0.9,*/*;q=0.1",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        if (
          (response.status === 408 ||
            response.status === 425 ||
            response.status === 429 ||
            response.status >= 500) &&
          attempt < attempts
        ) {
          await response.body?.cancel();
          await new Promise(
            (resolve) => setTimeout(resolve, 400 * (2 ** (attempt - 1))),
          );
          continue;
        }

        throw new Error(`HTTP ${response.status}`);
      }

      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      lastError = error;

      if (attempt >= attempts) {
        throw error;
      }

      await new Promise(
        (resolve) => setTimeout(resolve, 400 * (2 ** (attempt - 1))),
      );
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error("BANKING77 source fetch failed");
}

console.log(`BANKING77_SOURCE=${spec.source.url}`);
console.log(`BANKING77_EXPECTED_SOURCE_SHA256=${spec.source.sha256}`);
console.log("BANKING77_RETRY_ATTEMPTS=4");

const bytes = await fetchSource(spec.source.url);
const actualSourceSha = sha256(bytes);

console.log(`BANKING77_SOURCE_BYTES=${bytes.byteLength}`);
console.log(`BANKING77_ACTUAL_SOURCE_SHA256=${actualSourceSha}`);

if (actualSourceSha !== spec.source.sha256) {
  console.error("BANKING77_SOURCE_INTEGRITY=FAIL");
  process.exitCode = 1;
} else {
  console.log("BANKING77_SOURCE_INTEGRITY=PASS");

  const csv = new TextDecoder("utf-8", {
    fatal: true,
  }).decode(bytes);

  const suite = generateBanking77Suite(csv, spec);
  validateBanking77Suite(suite, spec);

  await mkdir("data/banking77", {
    recursive: true,
  });

  const serialized = JSON.stringify(suite, null, 2) + "\n";

  let priorDigest = null;
  try {
    const prior = JSON.parse(
      await readFile(suitePath, "utf8"),
    );
    priorDigest = prior.suiteDigest ?? null;
  } catch {
    // First freeze.
  }

  await writeFile(
    suitePath,
    serialized,
    "utf8",
  );

  console.log(`BANKING77_BASELINE_CASES=${suite.baselineCases.length}`);
  console.log(`BANKING77_ADVERSARIAL_CASES=${suite.adversarialCases.length}`);
  console.log(`BANKING77_INTENTS=${suite.intents.length}`);
  console.log(`BANKING77_SUITE_DIGEST=${suite.suiteDigest}`);

  if (priorDigest !== null && priorDigest !== suite.suiteDigest) {
    console.error(
      `BANKING77_PRIOR_DIGEST_MISMATCH=${priorDigest}`,
    );
    console.error("ADMISSARY_R4_BANKING77_GATE=FAIL");
    process.exitCode = 1;
  } else {
    console.log(
      priorDigest === null
        ? "BANKING77_FREEZE_STATE=CREATED"
        : "BANKING77_FREEZE_STATE=REPRODUCED",
    );

    console.log(`BANKING77_SUITE_FILE=${suitePath}`);
    console.log("ADMISSARY_R4_BANKING77_GATE=PASS");
  }
}
