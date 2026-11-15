import type {
  ObligationResult,
  QualificationState,
} from "./types.js";

export interface QualificationDecision {
  state: QualificationState;
  decisiveObligations: string[];
}

export function validateObligationResults(results: readonly ObligationResult[]): void {
  if (!Array.isArray(results)) throw new TypeError("Obligation results must be an array");
  const seen = new Set<string>();
  for (const r of results) {
    if (!r || typeof r.obligationId !== "string" || !r.obligationId.trim() || seen.has(r.obligationId) ||
        !["MANDATORY", "ADVISORY"].includes(r.criticality) ||
        !["DETERMINISTIC", "SEMANTIC", "EMPIRICAL"].includes(r.kind) ||
        !["PASS", "FAIL", "UNKNOWN", "ERROR"].includes(r.state)) throw new TypeError("Invalid obligation result");
    seen.add(r.obligationId);
  }
}

function mandatory(results: readonly ObligationResult[]): ObligationResult[] {
  return results.filter((result) => result.criticality === "MANDATORY");
}

function ids(results: readonly ObligationResult[]): string[] {
  return results.map((result) => result.obligationId).sort();
}

export function decideQualification(
  results: readonly ObligationResult[],
): QualificationDecision {
  validateObligationResults(results);
  const required = mandatory(results);

  const errors = required.filter((result) => result.state === "ERROR");
  if (errors.length > 0) {
    return {
      state: "ERROR",
      decisiveObligations: ids(errors),
    };
  }

  const admissibilityFailures = required.filter(
    (result) =>
      result.state === "FAIL" &&
      (result.kind === "DETERMINISTIC" || result.kind === "SEMANTIC"),
  );
  if (admissibilityFailures.length > 0) {
    return {
      state: "DISQUALIFIED",
      decisiveObligations: ids(admissibilityFailures),
    };
  }

  const semanticUnknowns = required.filter(
    (result) => result.kind === "SEMANTIC" && result.state === "UNKNOWN",
  );
  if (semanticUnknowns.length > 0) {
    return {
      state: "REVIEW_REQUIRED",
      decisiveObligations: ids(semanticUnknowns),
    };
  }

  const incomplete = required.filter(
    (result) =>
      result.state === "UNKNOWN" &&
      (result.kind === "DETERMINISTIC" || result.kind === "EMPIRICAL"),
  );
  if (incomplete.length > 0) {
    return {
      state: "INCOMPLETE",
      decisiveObligations: ids(incomplete),
    };
  }

  const empiricalFailures = required.filter(
    (result) => result.kind === "EMPIRICAL" && result.state === "FAIL",
  );
  if (empiricalFailures.length > 0) {
    return {
      state: "UNFIT",
      decisiveObligations: ids(empiricalFailures),
    };
  }

  return {
    state: "QUALIFIED",
    decisiveObligations: [],
  };
}
