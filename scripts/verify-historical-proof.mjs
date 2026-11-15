// Historical/offline proof consistency only. Current admission uses admissary-ci-check.mjs.
// Historical consistency only. Never a current deployment authorization check.
import {
  mkdir,
  readFile,
  writeFile,
  appendFile,
} from "node:fs/promises";
import {
  dirname,
} from "node:path";

import {
  verifyHistoricalManifestProofUnknown,
} from "../dist/index.js";

function arg(
  name,
) {
  const index =
    process.argv.indexOf(
      name,
    );

  return index >= 0
    ? process.argv[
        index + 1
      ]
    : null;
}

function fail(
  message,
  exitCode = 2,
) {
  console.error(
    `ADMISSARY_HISTORICAL_PROOF_ERROR=${message}`,
  );

  process.exitCode =
    exitCode;
}

const manifestPath =
  arg("--manifest");

const contextPath =
  arg("--context");

const reportPath =
  arg("--report") ??
  "admissary-historical-proof-report.json";

if (
  !manifestPath ||
  !contextPath
) {
  fail(
    "Usage: node scripts/verify-historical-proof.mjs --manifest <manifest.json> --context <context.json> [--report <report.json>]",
  );
} else {
  try {
    const manifest =
      JSON.parse(
        await readFile(
          manifestPath,
          "utf8",
        ),
      );

    const context =
      JSON.parse(
        await readFile(
          contextPath,
          "utf8",
        ),
      );

    const result =
      verifyHistoricalManifestProofUnknown(
        manifest,
        context,
      );

    const decision =
      result.allowed
        ? "VALID"
        : "INVALID";

    const reasonCodes =
      result.reasons.map(
        (item) =>
          item.code,
      );

    const report = {
      schema:
        "admissary-historical-manifest-proof/v1",
      decision,
      valid:
        result.allowed,
      authorityScope: "HISTORICAL_PROOF_ONLY",
      manifestDigest:
        result.manifestDigest,
      contextDigest:
        result.contextDigest,
      reasonCodes,
      reasons:
        result.reasons,
    };

    await mkdir(
      dirname(reportPath),
      {
        recursive: true,
      },
    );

    await writeFile(
      reportPath,
      JSON.stringify(
        report,
        null,
        2,
      ) + "\n",
      "utf8",
    );

    console.log(
      `ADMISSARY_HISTORICAL_PROOF_DECISION=${decision}`,
    );

    console.log(
      `ADMISSARY_HISTORICAL_PROOF_REASON_CODES=${
        reasonCodes.length
          ? reasonCodes.join(",")
          : "NONE"
      }`,
    );

    console.log(
      `ADMISSARY_HISTORICAL_PROOF_MANIFEST_DIGEST=${
        result.manifestDigest ??
        "NONE"
      }`,
    );

    console.log(
      `ADMISSARY_HISTORICAL_PROOF_CONTEXT_DIGEST=${result.contextDigest}`,
    );

    console.log(
      `ADMISSARY_HISTORICAL_PROOF_REPORT=${reportPath}`,
    );

    if (
      process.env
        .GITHUB_OUTPUT
    ) {
      await appendFile(
        process.env
          .GITHUB_OUTPUT,
        [
          `decision=${decision}`,
          `reason_codes=${
            reasonCodes.length
              ? reasonCodes.join(",")
              : "NONE"
          }`,
          `manifest_digest=${
            result.manifestDigest ??
            "NONE"
          }`,
          `context_digest=${result.contextDigest}`,
          `report_path=${reportPath}`,
          "",
        ].join("\n"),
        "utf8",
      );
    }

    if (
      process.env
        .GITHUB_STEP_SUMMARY
    ) {
      await appendFile(
        process.env
          .GITHUB_STEP_SUMMARY,
        [
          "## Admissary historical proof verification",
          "",
          `**Decision:** ${decision}`,
          "",
          `**Manifest:** \`${result.manifestDigest ?? "NONE"}\``,
          "",
          `**Context:** \`${result.contextDigest}\``,
          "",
          reasonCodes.length
            ? `**Reasons:** ${reasonCodes.map((code) => `\`${code}\``).join(", ")}`
            : "**Reasons:** none",
          "",
        ].join("\n"),
        "utf8",
      );
    }

    process.exitCode =
      result.allowed
        ? 0
        : 1;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.log("ADMISSARY_HISTORICAL_PROOF_DECISION=INVALID");
    try {
      await mkdir(dirname(reportPath), { recursive: true });
      await writeFile(reportPath, JSON.stringify({ schema: "admissary-historical-manifest-proof/v1", decision: "INVALID", valid: false, authorityScope: "HISTORICAL_PROOF_ONLY", manifestDigest: null, contextDigest: null, reasonCodes: ["INPUT_OR_VERIFICATION_ERROR"], reasons: [{code:"INPUT_OR_VERIFICATION_ERROR",detail}] }, null, 2) + "\n", "utf8");
    } catch (reportError) { console.error("ADMISSARY_HISTORICAL_PROOF_REPORT_WRITE_ERROR=" + (reportError?.code ?? "IO_ERROR")); }
    fail(
      error instanceof Error
        ? error.message
        : String(error),
    );
  }
}
