import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAdmissaryGuidanceMapping,
} from "../dist/index.js";

test("guidance mapping has explicit supported, partial and not-covered states", () => {
  const pack =
    buildAdmissaryGuidanceMapping();

  const states =
    new Set(
      pack.mappings.map(
        (item) =>
          item.coverage,
      ),
    );

  assert.deepEqual(
    [...states].sort(),
    [
      "NOT_COVERED",
      "PARTIAL",
      "SUPPORTED",
    ],
  );
});

test("supported mappings always link to actual Admissary proof references", () => {
  const pack =
    buildAdmissaryGuidanceMapping();

  assert.equal(
    pack.mappings
      .filter(
        (item) =>
          item.coverage ===
          "SUPPORTED",
      )
      .every(
        (item) =>
          item.proofRefs
            .length > 0,
      ),
    true,
  );
});

test("mapping explicitly avoids false standards claims", () => {
  const pack =
    buildAdmissaryGuidanceMapping();

  const sourceContent =
    JSON.stringify(
      pack.mappings,
    ).toLowerCase();

  assert.equal(
    sourceContent.includes(
      "certified",
    ),
    false,
  );

  assert.match(
    pack.disclaimer,
    /not a claim/i,
  );
});
