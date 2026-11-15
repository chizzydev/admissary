import { digestCanonicalJson } from "../qualification/canonical.js";

export interface Banking77SourceSpec {
  dataset: string;
  datasetVersion: string;
  split: string;
  url: string;
  sha256: string;
  license: string;
}

export interface Banking77MutationSpec {
  id: string;
  prefix: string;
}

export interface MetricThreshold {
  operator: "gte" | "lte" | "eq";
  value: number;
  criticality: "MANDATORY" | "ADVISORY";
}

export interface Banking77SuiteSpec {
  schema: "admissary-banking77-spec/v1";
  suiteId: string;
  generatorVersion: string;
  source: Banking77SourceSpec;
  selection: {
    strategy: "first_n_per_intent_in_source_order";
    baselinePerIntent: number;
    adversarialPerIntent: number;
  };
  intents: string[];
  criticalIntents: string[];
  mutations: Banking77MutationSpec[];
  thresholds: Record<string, MetricThreshold>;
}

export interface Banking77CsvRow {
  sourceRow: number;
  text: string;
  category: string;
}

export interface Banking77BaselineCase {
  id: string;
  kind: "BASELINE";
  sourceRow: number;
  text: string;
  expectedIntent: string;
}

export interface Banking77AdversarialCase {
  id: string;
  kind: "ADVERSARIAL";
  sourceCaseId: string;
  mutationId: string;
  text: string;
  expectedIntent: string;
}

export interface Banking77Suite {
  schema: "admissary-evaluation-suite/v1";
  suiteId: string;
  generatorVersion: string;
  source: Banking77SourceSpec;
  intents: string[];
  criticalIntents: string[];
  thresholds: Record<string, MetricThreshold>;
  baselineCases: Banking77BaselineCase[];
  adversarialCases: Banking77AdversarialCase[];
  suiteDigest: string;
}

export class EvaluationSuiteError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "EvaluationSuiteError";
    this.code = code;
  }
}

function parseCsvRecords(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i]!;

    if (quoted) {
      if (char === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }

      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (char === "\r") {
      if (csv[i + 1] === "\n") {
        i += 1;
      }

      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (quoted) {
    throw new EvaluationSuiteError(
      "BANKING77_CSV_ERROR",
      "CSV ended inside a quoted field",
    );
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

export function parseBanking77Csv(csv: string): Banking77CsvRow[] {
  const records = parseCsvRecords(csv);

  if (records.length < 2) {
    throw new EvaluationSuiteError(
      "BANKING77_CSV_ERROR",
      "BANKING77 CSV must contain a header and data rows",
    );
  }

  const header = records[0];
  if (
    !header ||
    header.length !== 2 ||
    header[0] !== "text" ||
    header[1] !== "category"
  ) {
    throw new EvaluationSuiteError(
      "BANKING77_CSV_ERROR",
      "Expected BANKING77 header: text,category",
    );
  }

  const rows: Banking77CsvRow[] = [];

  for (let index = 1; index < records.length; index += 1) {
    const record = records[index]!;

    if (
      record.length === 1 &&
      record[0] === ""
    ) {
      continue;
    }

    if (record.length !== 2) {
      throw new EvaluationSuiteError(
        "BANKING77_CSV_ERROR",
        `CSV source row ${index + 1} has ${record.length} fields instead of 2`,
      );
    }

    const text = record[0]!;
    const category = record[1]!;

    if (text.trim() === "" || category.trim() === "") {
      throw new EvaluationSuiteError(
        "BANKING77_CSV_ERROR",
        `CSV source row ${index + 1} contains an empty text/category`,
      );
    }

    rows.push({
      sourceRow: index + 1,
      text,
      category,
    });
  }

  return rows;
}

function validateSpec(spec: Banking77SuiteSpec): void {
  if (spec.schema !== "admissary-banking77-spec/v1") {
    throw new EvaluationSuiteError(
      "BANKING77_SPEC_ERROR",
      "Unexpected BANKING77 spec schema",
    );
  }

  if (spec.selection.strategy !== "first_n_per_intent_in_source_order") {
    throw new EvaluationSuiteError(
      "BANKING77_SPEC_ERROR",
      "Unsupported BANKING77 selection strategy",
    );
  }

  if (
    !Number.isInteger(spec.selection.baselinePerIntent) ||
    spec.selection.baselinePerIntent < 1
  ) {
    throw new EvaluationSuiteError(
      "BANKING77_SPEC_ERROR",
      "baselinePerIntent must be a positive integer",
    );
  }

  if (
    !Number.isInteger(spec.selection.adversarialPerIntent) ||
    spec.selection.adversarialPerIntent < 0
  ) {
    throw new EvaluationSuiteError(
      "BANKING77_SPEC_ERROR",
      "adversarialPerIntent must be a non-negative integer",
    );
  }

  if (
    spec.mutations.length !== spec.selection.adversarialPerIntent
  ) {
    throw new EvaluationSuiteError(
      "BANKING77_SPEC_ERROR",
      "Mutation count must equal adversarialPerIntent",
    );
  }

  if (new Set(spec.intents).size !== spec.intents.length) {
    throw new EvaluationSuiteError(
      "BANKING77_SPEC_ERROR",
      "Intent list contains duplicates",
    );
  }

  for (const intent of spec.criticalIntents) {
    if (!spec.intents.includes(intent)) {
      throw new EvaluationSuiteError(
        "BANKING77_SPEC_ERROR",
        `Critical intent is not in selected intents: ${intent}`,
      );
    }
  }
}

export function generateBanking77Suite(
  csv: string,
  spec: Banking77SuiteSpec,
): Banking77Suite {
  validateSpec(spec);

  const rows = parseBanking77Csv(csv);
  const selected = new Map<string, Banking77CsvRow[]>();

  for (const intent of spec.intents) {
    selected.set(intent, []);
  }

  for (const row of rows) {
    const bucket = selected.get(row.category);
    if (
      bucket &&
      bucket.length < spec.selection.baselinePerIntent
    ) {
      bucket.push(row);
    }
  }

  const baselineCases: Banking77BaselineCase[] = [];

  for (const intent of spec.intents) {
    const bucket = selected.get(intent)!;

    if (bucket.length !== spec.selection.baselinePerIntent) {
      throw new EvaluationSuiteError(
        "BANKING77_SELECTION_ERROR",
        `Expected ${spec.selection.baselinePerIntent} source rows for ${intent}, found ${bucket.length}`,
      );
    }

    bucket.forEach((row, index) => {
      baselineCases.push({
        id: `b-${String(spec.intents.indexOf(intent) + 1).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`,
        kind: "BASELINE",
        sourceRow: row.sourceRow,
        text: row.text,
        expectedIntent: intent,
      });
    });
  }

  const adversarialCases: Banking77AdversarialCase[] = [];

  for (const intent of spec.intents) {
    const cases = baselineCases.filter(
      (item) => item.expectedIntent === intent,
    );

    spec.mutations.forEach((mutation, index) => {
      const sourceCase = cases[index];

      if (!sourceCase) {
        throw new EvaluationSuiteError(
          "BANKING77_MUTATION_ERROR",
          `No source case available for mutation ${mutation.id} / ${intent}`,
        );
      }

      adversarialCases.push({
        id: `a-${String(spec.intents.indexOf(intent) + 1).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`,
        kind: "ADVERSARIAL",
        sourceCaseId: sourceCase.id,
        mutationId: mutation.id,
        text: `${mutation.prefix}${sourceCase.text}`,
        expectedIntent: sourceCase.expectedIntent,
      });
    });
  }

  const withoutDigest = {
    schema: "admissary-evaluation-suite/v1" as const,
    suiteId: spec.suiteId,
    generatorVersion: spec.generatorVersion,
    source: spec.source,
    intents: [...spec.intents],
    criticalIntents: [...spec.criticalIntents],
    thresholds: spec.thresholds,
    baselineCases,
    adversarialCases,
  };

  return {
    ...withoutDigest,
    suiteDigest: digestCanonicalJson(withoutDigest),
  };
}

export function validateBanking77Suite(
  suite: Banking77Suite,
  spec?: Banking77SuiteSpec,
): void {
  if (suite.schema !== "admissary-evaluation-suite/v1") {
    throw new EvaluationSuiteError(
      "BANKING77_SUITE_ERROR",
      "Unexpected suite schema",
    );
  }

  const expectedDigest = digestCanonicalJson({
    schema: suite.schema,
    suiteId: suite.suiteId,
    generatorVersion: suite.generatorVersion,
    source: suite.source,
    intents: suite.intents,
    criticalIntents: suite.criticalIntents,
    thresholds: suite.thresholds,
    baselineCases: suite.baselineCases,
    adversarialCases: suite.adversarialCases,
  });

  if (expectedDigest !== suite.suiteDigest) {
    throw new EvaluationSuiteError(
      "BANKING77_SUITE_ERROR",
      "Suite digest does not match canonical contents",
    );
  }

  const baselineIds = new Set(
    suite.baselineCases.map((item) => item.id),
  );

  if (baselineIds.size !== suite.baselineCases.length) {
    throw new EvaluationSuiteError(
      "BANKING77_SUITE_ERROR",
      "Duplicate baseline case IDs",
    );
  }

  const adversarialIds = new Set(
    suite.adversarialCases.map((item) => item.id),
  );

  if (adversarialIds.size !== suite.adversarialCases.length) {
    throw new EvaluationSuiteError(
      "BANKING77_SUITE_ERROR",
      "Duplicate adversarial case IDs",
    );
  }

  for (const item of suite.adversarialCases) {
    const source = suite.baselineCases.find(
      (candidate) => candidate.id === item.sourceCaseId,
    );

    if (!source) {
      throw new EvaluationSuiteError(
        "BANKING77_SUITE_ERROR",
        `Adversarial case ${item.id} references missing baseline ${item.sourceCaseId}`,
      );
    }

    if (source.expectedIntent !== item.expectedIntent) {
      throw new EvaluationSuiteError(
        "BANKING77_SUITE_ERROR",
        `Adversarial case ${item.id} changed the expected intent`,
      );
    }
  }

  if (spec) {
    if (suite.suiteId !== spec.suiteId) {
      throw new EvaluationSuiteError(
        "BANKING77_SUITE_ERROR",
        "Suite ID differs from frozen spec",
      );
    }

    const expectedBaseline =
      spec.intents.length * spec.selection.baselinePerIntent;
    const expectedAdversarial =
      spec.intents.length * spec.selection.adversarialPerIntent;

    if (suite.baselineCases.length !== expectedBaseline) {
      throw new EvaluationSuiteError(
        "BANKING77_SUITE_ERROR",
        `Expected ${expectedBaseline} baseline cases, found ${suite.baselineCases.length}`,
      );
    }

    if (suite.adversarialCases.length !== expectedAdversarial) {
      throw new EvaluationSuiteError(
        "BANKING77_SUITE_ERROR",
        `Expected ${expectedAdversarial} adversarial cases, found ${suite.adversarialCases.length}`,
      );
    }

    for (const intent of spec.intents) {
      const count = suite.baselineCases.filter(
        (item) => item.expectedIntent === intent,
      ).length;

      if (count !== spec.selection.baselinePerIntent) {
        throw new EvaluationSuiteError(
          "BANKING77_SUITE_ERROR",
          `Intent ${intent} has ${count} baseline cases`,
        );
      }
    }
  }
}
