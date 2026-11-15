import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";

import {
  buildWorkloadPack,
  verifyWorkloadPack,
} from "../dist/index.js";

const legacy =
  JSON.parse(
    await readFile(
      "data/banking77/banking-routing-v1.json",
      "utf8",
    ),
  );

if (
  legacy.schema !==
  "admissary-evaluation-suite/v1"
) {
  throw new Error(
    "Legacy BANKING77 suite schema mismatch",
  );
}

const outputFields = {
  intent: {
    type: "enum",
    values: legacy.intents,
  },
};

const metrics = [
  {
    id: "macro_f1",
    scorer: "macro_f1",
    field: "intent",
    threshold:
      legacy.thresholds.macro_f1,
  },
  {
    id:
      "critical_intent_recall",
    scorer:
      "critical_recall",
    field: "intent",
    criticalValues:
      legacy.criticalIntents,
    threshold:
      legacy.thresholds
        .critical_intent_recall,
  },
  {
    id:
      "schema_validity",
    scorer:
      "schema_validity",
    threshold:
      legacy.thresholds
        .schema_validity,
  },
  {
    id:
      "injection_invariance",
    scorer:
      "paired_invariance",
    fields: ["intent"],
    threshold:
      legacy.thresholds
        .injection_invariance,
  },
  {
    id:
      "p95_latency_ms",
    scorer:
      "p95_latency_ms",
    threshold:
      legacy.thresholds
        .p95_latency_ms,
  },
];

const pack =
  buildWorkloadPack({
    schema:
      "admissary-workload-pack/v1",
    id:
      legacy.suiteId,
    version:
      "1.0.0",
    name:
      "BANKING77 Production Intent Routing",
    description:
      "Generic Admissary workload-pack representation of the frozen BANKING77 evaluation suite used by the canonical Dolphin R5 run.",
    task: {
      kind:
        "STRUCTURED_OUTPUT",
      inputFields:
        ["text"],
      output: {
        type:
          "object",
        additionalProperties:
          false,
        fields:
          outputFields,
      },
    },
    cases: [
      ...legacy.baselineCases.map(
        (item) => ({
          id:
            item.id,
          kind:
            "BASELINE",
          input: {
            text:
              item.text,
          },
          expected: {
            intent:
              item.expectedIntent,
          },
          tags: [
            "banking77",
            "baseline",
          ],
        }),
      ),
      ...legacy.adversarialCases.map(
        (item) => ({
          id:
            item.id,
          kind:
            "ADVERSARIAL",
          sourceCaseId:
            item.sourceCaseId,
          mutationId:
            item.mutationId,
          input: {
            text:
              item.text,
          },
          expected: {
            intent:
              item.expectedIntent,
          },
          tags: [
            "banking77",
            "adversarial",
          ],
        }),
      ),
    ],
    metrics,
    metadata: {
      source:
        `${legacy.source.dataset}@${legacy.source.datasetVersion}`,
      license:
        legacy.source.license,
      owner:
        "Admissary",
    },
    legacyBinding: {
      type:
        "admissary-evaluation-suite/v1",
      suiteId:
        legacy.suiteId,
      suiteDigest:
        legacy.suiteDigest,
    },
  });

if (
  !verifyWorkloadPack(
    pack,
  )
) {
  throw new Error(
    "Migrated BANKING77 workload pack failed digest verification",
  );
}

await mkdir(
  "data/workloads",
  {
    recursive: true,
  },
);

await writeFile(
  "data/workloads/banking-routing-v1.workload.json",
  JSON.stringify(
    pack,
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(
  `R10C_BANKING77_LEGACY_SUITE_DIGEST=${legacy.suiteDigest}`,
);
console.log(
  `R10C_BANKING77_PACK_DIGEST=${pack.packDigest}`,
);
console.log(
  `R10C_BANKING77_PACK_CASES=${pack.cases.length}`,
);
console.log(
  `R10C_BANKING77_PACK_METRICS=${pack.metrics.length}`,
);
console.log(
  "R10C_BANKING77_PACK_MIGRATION=PASS",
);
