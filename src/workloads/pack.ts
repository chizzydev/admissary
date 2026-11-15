import {
  digestCanonicalJson,
} from "../qualification/canonical.js";

export type WorkloadScalar =
  | string
  | number
  | boolean;

export type WorkloadExpectedValue =
  | WorkloadScalar
  | null;

export interface WorkloadEnumField {
  type: "enum";
  values: string[];
}

export interface WorkloadBooleanField {
  type: "boolean";
}

export interface WorkloadNumberField {
  type: "number";
}

export interface WorkloadStringField {
  type: "string";
}

export type WorkloadOutputField =
  | WorkloadEnumField
  | WorkloadBooleanField
  | WorkloadNumberField
  | WorkloadStringField;

export interface WorkloadOutputSchema {
  type: "object";
  additionalProperties: false;
  fields: Record<string, WorkloadOutputField>;
}

export interface WorkloadCase {
  id: string;
  kind: "BASELINE" | "ADVERSARIAL";
  input: Record<string, WorkloadExpectedValue>;
  expected: Record<string, WorkloadExpectedValue>;
  sourceCaseId?: string;
  mutationId?: string;
  tags?: string[];
}

export interface WorkloadMetricThreshold {
  operator: "gte" | "lte" | "eq";
  value: number;
  criticality: "MANDATORY" | "ADVISORY";
}

export type WorkloadMetricDefinition =
  | {
      id: string;
      scorer: "macro_f1";
      field: string;
      threshold: WorkloadMetricThreshold;
    }
  | {
      id: string;
      scorer: "critical_recall";
      field: string;
      criticalValues: string[];
      threshold: WorkloadMetricThreshold;
    }
  | {
      id: string;
      scorer: "schema_validity";
      threshold: WorkloadMetricThreshold;
    }
  | {
      id: string;
      scorer: "paired_invariance";
      fields: string[];
      threshold: WorkloadMetricThreshold;
    }
  | {
      id: string;
      scorer: "exact_match_rate";
      fields: string[];
      threshold: WorkloadMetricThreshold;
    }
  | {
      id: string;
      scorer: "p95_latency_ms";
      threshold: WorkloadMetricThreshold;
    };

export interface WorkloadLegacyBinding {
  type: "admissary-evaluation-suite/v1";
  suiteId: string;
  suiteDigest: string;
}

export interface WorkloadPack {
  schema: "admissary-workload-pack/v1";
  id: string;
  version: string;
  name: string;
  description: string;
  task: {
    kind: "STRUCTURED_OUTPUT";
    inputFields: string[];
    output: WorkloadOutputSchema;
  };
  cases: WorkloadCase[];
  metrics: WorkloadMetricDefinition[];
  metadata: {
    source: string;
    license?: string;
    owner?: string;
  };
  legacyBinding?: WorkloadLegacyBinding;
  packDigest: string;
}

export type WorkloadPackInput =
  Omit<WorkloadPack, "packDigest">;

export class WorkloadPackError extends Error {
  readonly code: string;

  constructor(
    code: string,
    message: string,
  ) {
    super(message);
    this.name = "WorkloadPackError";
    this.code = code;
  }
}

function assertNonEmpty(
  value: string,
  label: string,
): void {
  if (value.trim() === "") {
    throw new WorkloadPackError(
      "WORKLOAD_PACK_SCHEMA_ERROR",
      `${label} must be non-empty`,
    );
  }
}

function assertThreshold(
  threshold: WorkloadMetricThreshold,
  label: string,
): void {
  if (
    !Number.isFinite(
      threshold.value,
    )
  ) {
    throw new WorkloadPackError(
      "WORKLOAD_PACK_THRESHOLD_ERROR",
      `${label}.value must be finite`,
    );
  }
}

function validateFieldValue(
  field: WorkloadOutputField,
  value: WorkloadExpectedValue,
  label: string,
): void {
  if (value === null) {
    throw new WorkloadPackError(
      "WORKLOAD_PACK_CASE_ERROR",
      `${label} cannot be null`,
    );
  }

  switch (field.type) {
    case "enum":
      if (
        typeof value !== "string" ||
        !field.values.includes(value)
      ) {
        throw new WorkloadPackError(
          "WORKLOAD_PACK_CASE_ERROR",
          `${label} must be one of: ${field.values.join(", ")}`,
        );
      }
      break;
    case "boolean":
      if (
        typeof value !== "boolean"
      ) {
        throw new WorkloadPackError(
          "WORKLOAD_PACK_CASE_ERROR",
          `${label} must be boolean`,
        );
      }
      break;
    case "number":
      if (
        typeof value !== "number" ||
        !Number.isFinite(value)
      ) {
        throw new WorkloadPackError(
          "WORKLOAD_PACK_CASE_ERROR",
          `${label} must be a finite number`,
        );
      }
      break;
    case "string":
      if (
        typeof value !== "string"
      ) {
        throw new WorkloadPackError(
          "WORKLOAD_PACK_CASE_ERROR",
          `${label} must be string`,
        );
      }
      break;
  }
}

export function validateWorkloadPackInput(
  pack: WorkloadPackInput,
): void {
  if (
    pack.schema !==
    "admissary-workload-pack/v1"
  ) {
    throw new WorkloadPackError(
      "WORKLOAD_PACK_SCHEMA_ERROR",
      "Unsupported workload-pack schema",
    );
  }

  for (
    const [label, value] of [
      ["id", pack.id],
      ["version", pack.version],
      ["name", pack.name],
      ["description", pack.description],
      ["metadata.source", pack.metadata.source],
    ] as const
  ) {
    assertNonEmpty(
      value,
      label,
    );
  }

  if (
    pack.task.kind !==
    "STRUCTURED_OUTPUT"
  ) {
    throw new WorkloadPackError(
      "WORKLOAD_PACK_SCHEMA_ERROR",
      "Unsupported workload task kind",
    );
  }

  if (
    pack.task.output.type !==
      "object" ||
    pack.task.output.additionalProperties !==
      false
  ) {
    throw new WorkloadPackError(
      "WORKLOAD_PACK_SCHEMA_ERROR",
      "Output must be a strict object schema",
    );
  }

  const outputFields =
    Object.keys(
      pack.task.output.fields,
    );

  if (
    outputFields.length === 0
  ) {
    throw new WorkloadPackError(
      "WORKLOAD_PACK_SCHEMA_ERROR",
      "At least one output field is required",
    );
  }

  for (
    const [name, field] of
    Object.entries(
      pack.task.output.fields,
    )
  ) {
    assertNonEmpty(
      name,
      "output field",
    );

    if (
      field.type === "enum"
    ) {
      if (
        field.values.length < 2 ||
        new Set(
          field.values,
        ).size !==
          field.values.length
      ) {
        throw new WorkloadPackError(
          "WORKLOAD_PACK_SCHEMA_ERROR",
          `Enum field ${name} must contain at least two unique values`,
        );
      }
    }
  }

  if (
    pack.cases.length === 0
  ) {
    throw new WorkloadPackError(
      "WORKLOAD_PACK_CASE_ERROR",
      "At least one case is required",
    );
  }

  const caseById =
    new Map<string, WorkloadCase>();

  for (const testCase of pack.cases) {
    assertNonEmpty(
      testCase.id,
      "case.id",
    );

    if (
      caseById.has(
        testCase.id,
      )
    ) {
      throw new WorkloadPackError(
        "WORKLOAD_PACK_CASE_ERROR",
        `Duplicate case ID: ${testCase.id}`,
      );
    }

    caseById.set(
      testCase.id,
      testCase,
    );

    const expectedKeys =
      Object.keys(
        testCase.expected,
      ).sort();

    const schemaKeys =
      [...outputFields].sort();

    if (
      JSON.stringify(
        expectedKeys,
      ) !==
      JSON.stringify(
        schemaKeys,
      )
    ) {
      throw new WorkloadPackError(
        "WORKLOAD_PACK_CASE_ERROR",
        `Case ${testCase.id} expected-output keys do not match workload output schema`,
      );
    }

    for (
      const [
        fieldName,
        field,
      ] of
      Object.entries(
        pack.task.output.fields,
      )
    ) {
      validateFieldValue(
        field,
        testCase.expected[
          fieldName
        ]!,
        `case ${testCase.id} expected.${fieldName}`,
      );
    }

    if (
      testCase.kind ===
      "ADVERSARIAL"
    ) {
      if (
        !testCase.sourceCaseId ||
        !testCase.mutationId
      ) {
        throw new WorkloadPackError(
          "WORKLOAD_PACK_CASE_ERROR",
          `Adversarial case ${testCase.id} requires sourceCaseId and mutationId`,
        );
      }
    } else if (
      testCase.sourceCaseId ||
      testCase.mutationId
    ) {
      throw new WorkloadPackError(
        "WORKLOAD_PACK_CASE_ERROR",
        `Baseline case ${testCase.id} cannot carry adversarial linkage`,
      );
    }
  }

  for (const testCase of pack.cases) {
    if (
      testCase.kind ===
      "ADVERSARIAL"
    ) {
      const source =
        caseById.get(
          testCase.sourceCaseId!,
        );

      if (
        !source ||
        source.kind !==
          "BASELINE"
      ) {
        throw new WorkloadPackError(
          "WORKLOAD_PACK_CASE_ERROR",
          `Adversarial case ${testCase.id} must reference an existing baseline case`,
        );
      }
    }
  }

  const metricIds =
    new Set<string>();

  for (const metric of pack.metrics) {
    assertNonEmpty(
      metric.id,
      "metric.id",
    );

    if (
      metricIds.has(
        metric.id,
      )
    ) {
      throw new WorkloadPackError(
        "WORKLOAD_PACK_METRIC_ERROR",
        `Duplicate metric ID: ${metric.id}`,
      );
    }

    metricIds.add(
      metric.id,
    );

    assertThreshold(
      metric.threshold,
      `metric ${metric.id}`,
    );

    if (
      "field" in metric &&
      !pack.task.output.fields[
        metric.field
      ]
    ) {
      throw new WorkloadPackError(
        "WORKLOAD_PACK_METRIC_ERROR",
        `Metric ${metric.id} references unknown field ${metric.field}`,
      );
    }

    if (
      "fields" in metric
    ) {
      if (
        metric.fields.length === 0 ||
        new Set(
          metric.fields,
        ).size !==
          metric.fields.length
      ) {
        throw new WorkloadPackError(
          "WORKLOAD_PACK_METRIC_ERROR",
          `Metric ${metric.id} fields must be non-empty and unique`,
        );
      }

      for (
        const field of
        metric.fields
      ) {
        if (
          !pack.task.output.fields[
            field
          ]
        ) {
          throw new WorkloadPackError(
            "WORKLOAD_PACK_METRIC_ERROR",
            `Metric ${metric.id} references unknown field ${field}`,
          );
        }
      }
    }

    if (
      metric.scorer ===
      "macro_f1" ||
      metric.scorer ===
      "critical_recall"
    ) {
      const field =
        pack.task.output.fields[
          metric.field
        ];

      if (
        !field ||
        field.type !==
          "enum"
      ) {
        throw new WorkloadPackError(
          "WORKLOAD_PACK_METRIC_ERROR",
          `${metric.scorer} requires an enum field`,
        );
      }

      if (
        metric.scorer ===
        "critical_recall"
      ) {
        for (
          const value of
          metric.criticalValues
        ) {
          if (
            !field.values.includes(
              value,
            )
          ) {
            throw new WorkloadPackError(
              "WORKLOAD_PACK_METRIC_ERROR",
              `Critical value ${value} is outside enum ${metric.field}`,
            );
          }
        }
      }
    }
  }

  if (
    pack.legacyBinding
  ) {
    assertNonEmpty(
      pack.legacyBinding.suiteId,
      "legacyBinding.suiteId",
    );

    if (
      !/^[a-f0-9]{64}$/i.test(
        pack.legacyBinding.suiteDigest,
      )
    ) {
      throw new WorkloadPackError(
        "WORKLOAD_PACK_LEGACY_BINDING_ERROR",
        "legacyBinding.suiteDigest must be a SHA-256 hex digest",
      );
    }
  }
}

export function buildWorkloadPack(
  input: WorkloadPackInput,
): WorkloadPack {
  validateWorkloadPackInput(
    input,
  );

  return {
    ...structuredClone(input),
    packDigest:
      digestCanonicalJson(
        input,
      ),
  };
}

export function verifyWorkloadPack(
  pack: WorkloadPack,
): boolean {
  const {
    packDigest,
    ...input
  } = pack;

  try {
    validateWorkloadPackInput(
      input,
    );
  } catch {
    return false;
  }

  return (
    digestCanonicalJson(
      input,
    ) === packDigest
  );
}

export interface ParsedWorkloadOutput {
  schemaValid: boolean;
  output: Record<string, WorkloadExpectedValue> | null;
  error: string | null;
}

export function validateWorkloadOutput(
  pack: WorkloadPack,
  raw: unknown,
): ParsedWorkloadOutput {
  if (
    typeof raw !== "object" ||
    raw === null ||
    Array.isArray(raw)
  ) {
    return {
      schemaValid: false,
      output: null,
      error:
        "Output must be an object",
    };
  }

  const record =
    raw as Record<
      string,
      unknown
    >;

  const expectedKeys =
    Object.keys(
      pack.task.output.fields,
    ).sort();

  const actualKeys =
    Object.keys(
      record,
    ).sort();

  if (
    JSON.stringify(
      expectedKeys,
    ) !==
    JSON.stringify(
      actualKeys,
    )
  ) {
    return {
      schemaValid: false,
      output: null,
      error:
        "Output keys do not exactly match workload schema",
    };
  }

  const output:
    Record<
      string,
      WorkloadExpectedValue
    > = {};

  for (
    const [
      name,
      field,
    ] of
    Object.entries(
      pack.task.output.fields,
    )
  ) {
    const value =
      record[name];

    try {
      validateFieldValue(
        field,
        value as WorkloadExpectedValue,
        `output.${name}`,
      );
    } catch (error) {
      return {
        schemaValid: false,
        output: null,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      };
    }

    output[name] =
      value as WorkloadExpectedValue;
  }

  return {
    schemaValid: true,
    output,
    error: null,
  };
}
