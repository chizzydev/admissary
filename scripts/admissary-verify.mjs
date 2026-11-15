// Historical/offline proof consistency only. Current admission uses admissary-ci-check.mjs.
import {
  readFile,
} from "node:fs/promises";

import {
  verifyHistoricalManifestProofUnknown,
} from "../dist/index.js";

function fail(message) {
  console.error(`ADMISSARY_VERIFY_ERROR=${message}`);
  process.exitCode = 2;
}

const manifestPath =
  process.argv[2];

const contextFlagIndex =
  process.argv.indexOf("--context");

const contextPath =
  contextFlagIndex >= 0
    ? process.argv[
        contextFlagIndex + 1
      ]
    : undefined;

if (
  !manifestPath ||
  !contextPath
) {
  fail(
    "Usage: node scripts/admissary-verify.mjs <manifest.json> --context <deployment-context.json>",
  );
} else {
  try {
    const rawManifest =
      JSON.parse(
        await readFile(
          manifestPath,
          "utf8",
        ),
      );

    const rawContext =
      JSON.parse(
        await readFile(
          contextPath,
          "utf8",
        ),
      );

    const result =
      verifyHistoricalManifestProofUnknown(
        rawManifest,
        rawContext,
      );

    console.log("ADMISSARY_VERIFY_AUTHORITY_SCOPE=HISTORICAL_PROOF_ONLY");
    console.log(
      `ADMISSARY_VERIFY_ALLOWED=${
        result.allowed ? "YES" : "NO"
      }`,
    );

    console.log(
      `ADMISSARY_VERIFY_MANIFEST_DIGEST=${
        result.manifestDigest ?? "NONE"
      }`,
    );

    console.log(
      `ADMISSARY_VERIFY_CONTEXT_DIGEST=${result.contextDigest}`,
    );

    for (const reason of result.reasons) {
      console.log(
        `ADMISSARY_VERIFY_REASON=${reason.code}:${reason.detail}`,
      );
    }

    console.log(
      `ADMISSARY_VERIFY_RESULT=${
        JSON.stringify(result)
      }`,
    );

    process.exitCode =
      result.allowed ? 0 : 1;
  } catch (error) {
    fail(
      error instanceof Error
        ? error.message
        : String(error),
    );
  }
}
