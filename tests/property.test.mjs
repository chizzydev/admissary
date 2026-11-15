import test from "node:test";
import assert from "node:assert/strict";

import {
  decideQualification,
  digestCanonicalJson,
} from "../dist/index.js";

const states = ["PASS", "FAIL", "UNKNOWN", "ERROR"];

test("deterministic input changes alter the digest across a broad sample", () => {
  for (let i = 0; i < 250; i += 1) {
    const base = {
      contract: "banking-support-prod",
      revision: `r-${i}`,
      threshold: i / 1000,
    };

    const changed = {
      ...base,
      revision: `r-${i}-changed`,
    };

    assert.notEqual(
      digestCanonicalJson(base),
      digestCanonicalJson(changed),
    );
  }
});

test("a mandatory deterministic FAIL never produces QUALIFIED", () => {
  for (const empirical of states) {
    for (const semantic of states) {
      const decision = decideQualification([
        {
          obligationId: "STATIC",
          kind: "DETERMINISTIC",
          criticality: "MANDATORY",
          state: "FAIL",
        },
        {
          obligationId: "SEMANTIC",
          kind: "SEMANTIC",
          criticality: "MANDATORY",
          state: semantic,
        },
        {
          obligationId: "EMPIRICAL",
          kind: "EMPIRICAL",
          criticality: "MANDATORY",
          state: empirical,
        },
      ]);

      assert.notEqual(decision.state, "QUALIFIED");
    }
  }
});

test("advisory result changes cannot alter an otherwise qualified decision", () => {
  for (const advisoryState of states) {
    const decision = decideQualification([
      {
        obligationId: "STATIC",
        kind: "DETERMINISTIC",
        criticality: "MANDATORY",
        state: "PASS",
      },
      {
        obligationId: "SEMANTIC",
        kind: "SEMANTIC",
        criticality: "MANDATORY",
        state: "PASS",
      },
      {
        obligationId: "EMPIRICAL",
        kind: "EMPIRICAL",
        criticality: "MANDATORY",
        state: "PASS",
      },
      {
        obligationId: "ADVISORY",
        kind: "EMPIRICAL",
        criticality: "ADVISORY",
        state: advisoryState,
      },
    ]);

    assert.equal(decision.state, "QUALIFIED");
  }
});
