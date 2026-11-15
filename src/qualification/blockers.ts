import type { Expr } from "./expression.js";
import { evaluateExpr } from "./expression.js";
import type { EvidenceState } from "./types.js";

export type BlockingSet = string[];

function keyOf(set: readonly string[]): string {
  return [...new Set(set)].sort().join("\u0000");
}

function normalize(sets: BlockingSet[]): BlockingSet[] {
  const unique = new Map<string, BlockingSet>();

  for (const set of sets) {
    const normalized = [...new Set(set)].sort();
    unique.set(keyOf(normalized), normalized);
  }

  const ordered = [...unique.values()].sort(
    (a, b) => a.length - b.length || keyOf(a).localeCompare(keyOf(b)),
  );

  return ordered.filter((candidate, index) => {
    return !ordered.slice(0, index).some((smaller) =>
      smaller.every((item) => candidate.includes(item)),
    );
  });
}

function crossProductUnion(groups: BlockingSet[][]): BlockingSet[] {
  let product: BlockingSet[] = [[]];

  for (const group of groups) {
    const next: BlockingSet[] = [];

    for (const prefix of product) {
      for (const option of group) {
        next.push([...prefix, ...option]);
      }
    }

    product = normalize(next);
  }

  return product;
}

/**
 * Computes minimal sets of currently failing leaf controls that independently
 * explain why a monotone expression evaluates to FAIL.
 *
 * UNKNOWN and ERROR are intentionally not treated as blockers. They are
 * unresolved evidence/system states, not proven contradictions.
 */
export function minimalBlockingSets(
  expr: Expr,
  states: Readonly<Record<string, EvidenceState>>,
): BlockingSet[] {
  if (evaluateExpr(expr, states) !== "FAIL") {
    return [];
  }

  switch (expr.type) {
    case "control":
      return states[expr.controlId] === "FAIL" ? [[expr.controlId]] : [];

    case "all": {
      const blockers: BlockingSet[] = [];

      for (const child of expr.children) {
        if (evaluateExpr(child, states) === "FAIL") {
          blockers.push(...minimalBlockingSets(child, states));
        }
      }

      return normalize(blockers);
    }

    case "any": {
      const groups = expr.children.map((child) => minimalBlockingSets(child, states));

      if (groups.some((group) => group.length === 0)) {
        // This should not happen when the ANY expression is FAIL, but keeping the
        // guard makes malformed future evaluators fail conservatively.
        return [];
      }

      return normalize(crossProductUnion(groups));
    }
  }
}
