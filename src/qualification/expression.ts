import type { EvidenceState } from "./types.js";

/**
 * The expression language is deliberately monotone.
 *
 * Negation is encoded in leaf evaluators ("remote_code_forbidden" passes when
 * remote code is not required) rather than as a Boolean NOT node. This keeps
 * blocker explanations precise and prevents ambiguous remediation semantics.
 */
export type Expr =
  | {
      type: "control";
      controlId: string;
    }
  | {
      type: "all";
      children: Expr[];
    }
  | {
      type: "any";
      children: Expr[];
    };

function requireChildren(children: Expr[], type: "all" | "any"): void {
  if (children.length === 0) {
    throw new Error(`${type.toUpperCase()} expression requires at least one child`);
  }
}

export function evaluateExpr(
  expr: Expr,
  states: Readonly<Record<string, EvidenceState>>,
): EvidenceState {
  switch (expr.type) {
    case "control": {
      return states[expr.controlId] ?? "UNKNOWN";
    }

    case "all": {
      requireChildren(expr.children, "all");
      const values = expr.children.map((child) => evaluateExpr(child, states));

      // System/infrastructure errors have highest precedence by design.
      if (values.includes("ERROR")) return "ERROR";
      if (values.includes("FAIL")) return "FAIL";
      if (values.includes("UNKNOWN")) return "UNKNOWN";
      return "PASS";
    }

    case "any": {
      requireChildren(expr.children, "any");
      const values = expr.children.map((child) => evaluateExpr(child, states));

      // A proven passing alternative is sufficient even when another optional
      // branch errored. If no path passes, errors prevent us from concluding FAIL.
      if (values.includes("PASS")) return "PASS";
      if (values.includes("ERROR")) return "ERROR";
      if (values.includes("UNKNOWN")) return "UNKNOWN";
      return "FAIL";
    }
  }
}
