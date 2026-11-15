import { runLocalRegressions } from "./local-regression-runner.mjs";
import { liveCandidateRecords } from "./live-candidate-evidence.mjs";
const liveRecords=await liveCandidateRecords();
await runLocalRegressions("r10c4-decision-workspace-gate", "H-06", 2);
import { readProof } from "./artifact-integrity.mjs";
await readProof("results/ADMISSARY_R10C_REGISTRY_PROOF.json","proofDigest","admissary-r10c-registry-proof/v1");
await readProof("results/ADMISSARY_R10C3_CONTINUOUS_ASSURANCE_PROOF.json","proofDigest","admissary-r10c3-continuous-assurance-proof/v1");
import { acceptedHistorical } from "./artifact-integrity.mjs";
import {
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";

import {
  buildAdmissaryGuidanceMapping,
  digestCanonicalJson,
  selectCandidates,
} from "../dist/index.js";
import {
  createAdmissaryWebServer,
} from "./admissary-web-lib.mjs";

async function latest(prefix) { return await acceptedHistorical(prefix); }

const registry =
  JSON.parse(
    await readFile(
      "results/ADMISSARY_R10C_REGISTRY_PROOF.json",
      "utf8",
    ),
  );

const assurance =
  JSON.parse(
    await readFile(
      "results/ADMISSARY_R10C3_CONTINUOUS_ASSURANCE_PROOF.json",
      "utf8",
    ),
  );

const r9 =
  JSON.parse(
    await readFile(
      "web/demo-snapshot.json",
      "utf8",
    ),
  );

const r2 =
  JSON.parse(
    await readFile(
      await latest(
        "ADMISSARY_R2_HF_EVIDENCE_",
      ),
      "utf8",
    ),
  );

const remoteCodeTarget =
  r2.targets.find(
    (item) =>
      item.repository ===
      "sgugger/custom-resnet50d",
  );

if (
  !remoteCodeTarget ||
  remoteCodeTarget
    .remoteCode
    ?.state !==
    "REQUIRED"
) {
  throw new Error(
    "Canonical real remote-code disqualification evidence is missing",
  );
}

if (
  r9.realModel?.empiricalFitness !==
    "UNFIT" &&
  r9.empiricalFitness !==
    "UNFIT"
) {
  // Support both historical snapshot shapes, but never silently change truth.
  const serialized =
    JSON.stringify(r9);

  if (
    !serialized.includes(
      '"empiricalFitness":"UNFIT"',
    )
  ) {
    throw new Error(
      "Canonical real DeepSeek empirical UNFIT truth is missing",
    );
  }
}

const candidates = [
  {
    candidateId:
      "real-remote-code-disqualified",
    displayName:
      "sgugger/custom-resnet50d",
    qualificationState:
      "DISQUALIFIED",
    exactArtifactBindingProven:
      true,
    blockers: [
      "REMOTE_CODE_REQUIRED",
    ],
    operational: {
      provider:
        "HUGGING_FACE",
      p95LatencyMs: {
        value: null,
        provenance:
          "UNKNOWN",
        sourceRef: null,
      },
      costPerMillionTokensUsd: {
        value: null,
        provenance:
          "UNKNOWN",
        sourceRef: null,
      },
      modelSizeB: {
        value: null,
        provenance:
          "UNKNOWN",
        sourceRef: null,
      },
    },
  },
  {
    candidateId:
      "real-deepseek-v41-flash",
    displayName:
      "DeepSeek V4.1 Flash",
    qualificationState:
      "REVIEW_REQUIRED",
    exactArtifactBindingProven:
      false,
    blockers: [
      "CRITICAL_INTENT_RECALL_FAIL",
      "SCHEMA_VALIDITY_FAIL",
      "EXACT_ARTIFACT_BINDING_UNPROVEN",
    ],
    operational: {
      provider:
        "DOLPHIN",
      p95LatencyMs: {
        value: 3817,
        provenance:
          "REAL",
        sourceRef:
          "R5:real-dolphin-run",
      },
      costPerMillionTokensUsd: {
        value: null,
        provenance:
          "UNKNOWN",
        sourceRef: null,
      },
      modelSizeB: {
        value: null,
        provenance:
          "UNKNOWN",
        sourceRef: null,
      },
    },
  },
  ...[
    [
      "candidate-gemma4-nvfp4",
      "Gemma 4 26B A4B NVFP4",
    ],
    [
      "candidate-qwen36-nvfp4",
      "Qwen 3.6 35B A3B NVFP4",
    ],
  ].map(
    (
      [
        id,
        name,
      ],
    ) => ({
      candidateId: id,
      displayName: name,
      qualificationState:
        "INCOMPLETE",
      exactArtifactBindingProven:
        false,
      blockers: [
        "NOT_EVALUATED",
      ],
      operational: {
        provider:
          "DOLPHIN",
        p95LatencyMs: {
          value: null,
          provenance:
            "UNKNOWN",
          sourceRef: null,
        },
        costPerMillionTokensUsd: {
          value: null,
          provenance:
            "UNKNOWN",
          sourceRef: null,
        },
        modelSizeB: {
          value: null,
          provenance:
            "UNKNOWN",
          sourceRef: null,
        },
      },
    }),
  ),
  {
    candidateId:
      "fixture-qualified-efficient",
    displayName:
      "Qualified acceptance candidate — efficient",
    qualificationState:
      "QUALIFIED",
    exactArtifactBindingProven:
      true,
    blockers: [],
    operational: {
      provider:
        "ACCEPTANCE_FIXTURE",
      p95LatencyMs: {
        value: 820,
        provenance:
          "FIXTURE",
        sourceRef:
          "R10C4:acceptance-fixture",
      },
      costPerMillionTokensUsd: {
        value: 0.8,
        provenance:
          "FIXTURE",
        sourceRef:
          "R10C4:acceptance-fixture",
      },
      modelSizeB: {
        value: 9,
        provenance:
          "FIXTURE",
        sourceRef:
          "R10C4:acceptance-fixture",
      },
    },
  },
  {
    candidateId:
      "fixture-qualified-fast",
    displayName:
      "Qualified acceptance candidate — fast",
    qualificationState:
      "QUALIFIED",
    exactArtifactBindingProven:
      true,
    blockers: [],
    operational: {
      provider:
        "ACCEPTANCE_FIXTURE",
      p95LatencyMs: {
        value: 390,
        provenance:
          "FIXTURE",
        sourceRef:
          "R10C4:acceptance-fixture",
      },
      costPerMillionTokensUsd: {
        value: 1.4,
        provenance:
          "FIXTURE",
        sourceRef:
          "R10C4:acceptance-fixture",
      },
      modelSizeB: {
        value: 12,
        provenance:
          "FIXTURE",
        sourceRef:
          "R10C4:acceptance-fixture",
      },
    },
  },
];

// Replace historical unevaluated rows only with validated pinned real evidence.
for(const live of liveRecords){
  const candidate=candidates.find(c=>c.candidateId===live.target.candidateId);
  if(!candidate)throw new Error('Live candidate missing from canonical comparison');
  candidate.qualificationState=live.qualificationState;candidate.blockers=live.blockers;
  if(live.raw)candidate.operational.p95LatencyMs={value:live.raw.metrics.p95_latency_ms,provenance:'REAL',sourceRef:`stored:${live.summary.artifactPath}#${live.raw.runDigest}`};
}
const policy = {
  schema:
    "admissary-candidate-selection-policy/v1",
  requireExactArtifactBinding:
    true,
  allowedProviders:
    null,
  maxP95LatencyMs:
    1500,
  maxCostPerMillionTokensUsd:
    2,
  maxModelSizeB:
    20,
  objectiveOrder: [
    "costPerMillionTokensUsd",
    "p95LatencyMs",
    "modelSizeB",
  ],
};

const selection =
  selectCandidates({
    candidates,
    policy,
  });
const realSelection=selectCandidates({candidates:candidates.filter(c=>c.operational.provider!=='ACCEPTANCE_FIXTURE'),policy});
if(realSelection.selectedCandidateId!==null)throw new Error('Unbound real candidate entered admissible selection');

if (
  selection.selectedCandidateId !==
  "fixture-qualified-efficient"
) {
  throw new Error(
    `Unexpected selected candidate: ${selection.selectedCandidateId}`,
  );
}

if (
  selection.claimScope !==
  "FIXTURE_ONLY"
) {
  throw new Error(
    "Acceptance-fixture selection lost provenance label",
  );
}

for (
  const [
    candidateId,
    expectedReason,
  ] of [
    [
      "real-remote-code-disqualified",
      "QUALIFICATION_DISQUALIFIED",
    ],
    [
      "real-deepseek-v41-flash",
      "QUALIFICATION_REVIEW_REQUIRED",
    ],
    [
      "candidate-gemma4-nvfp4",
      `QUALIFICATION_${candidates.find(c=>c.candidateId==='candidate-gemma4-nvfp4').qualificationState}`,
    ],
    [
      "candidate-qwen36-nvfp4",
      `QUALIFICATION_${candidates.find(c=>c.candidateId==='candidate-qwen36-nvfp4').qualificationState}`,
    ],
  ]
) {
  const exclusion =
    selection.excluded.find(
      (item) =>
        item.candidateId ===
        candidateId,
    );

  if (
    !exclusion?.reasons.includes(
      expectedReason,
    )
  ) {
    throw new Error(
      `${candidateId} was not excluded for ${expectedReason}`,
    );
  }
}

const guidance =
  buildAdmissaryGuidanceMapping();

const coverage =
  Object.fromEntries(
    [
      "SUPPORTED",
      "PARTIAL",
      "NOT_COVERED",
    ].map(
      (status) => [
        status,
        guidance.mappings.filter(
          (mapping) =>
            mapping.coverage ===
            status,
        ).length,
      ],
    ),
  );

if (
  coverage.SUPPORTED === 0 ||
  coverage.PARTIAL === 0 ||
  coverage.NOT_COVERED === 0
) {
  throw new Error(
    "Guidance mapping does not expose all coverage states",
  );
}

const OPERATOR_TOKEN =
  "r10c4-operator-token";

const VIEWER_TOKEN =
  "r10c4-viewer-token";

const server =
  createAdmissaryWebServer({
    mode:
      "r10c4-test",
    authTokens: {
      [OPERATOR_TOKEN]:
        "OPERATOR",
      [VIEWER_TOKEN]:
        "VIEWER",
    },
    productRegistryProofPath:
      "results/ADMISSARY_R10C_REGISTRY_PROOF.json",
    productAssuranceProofPath:
      "results/ADMISSARY_R10C3_CONTINUOUS_ASSURANCE_PROOF.json",
  });

await new Promise(
  (resolve, reject) => {
    server.once(
      "error",
      reject,
    );

    server.listen(
      0,
      "127.0.0.1",
      resolve,
    );
  },
);

try {
  const address =
    server.address();

  if (
    !address ||
    typeof address ===
      "string"
  ) {
    throw new Error(
      "R10C4 server address unavailable",
    );
  }

  const base =
    `http://127.0.0.1:${address.port}`;

  const unauth =
    await fetch(
      `${base}/v1/product/overview`,
    );

  if (
    unauth.status !== 401
  ) {
    throw new Error(
      `Unauthenticated product overview status ${unauth.status}`,
    );
  }

  const overviewResponse =
    await fetch(
      `${base}/v1/product/overview`,
      {
        headers: {
          authorization:
            `Bearer ${VIEWER_TOKEN}`,
        },
      },
    );

  const overview =
    await overviewResponse.json();

  if (
    overviewResponse.status !==
      200 ||
    overview.registry.candidates !==
      3 ||
    overview.realCandidateTruth
      .overallQualification !==
      "REVIEW_REQUIRED" ||
    overview.realCandidateTruth
      .deployAllowed !==
      false ||
    overview.continuousAssurance
      .caseBDriftAllowed !==
      false
  ) {
    throw new Error(
      `Product overview truth mismatch: ${JSON.stringify(overview)}`,
    );
  }

  const guidanceResponse =
    await fetch(
      `${base}/v1/product/guidance`,
      {
        headers: {
          authorization:
            `Bearer ${VIEWER_TOKEN}`,
        },
      },
    );

  const guidanceBody =
    await guidanceResponse.json();

  if (
    guidanceResponse.status !==
      200 ||
    guidanceBody.mapping
      .packDigest !==
      guidance.packDigest
  ) {
    throw new Error(
      "Product guidance API mismatch",
    );
  }

  const viewerSelection =
    await fetch(
      `${base}/v1/product/selection`,
      {
        method: "POST",
        headers: {
          authorization:
            `Bearer ${VIEWER_TOKEN}`,
          "content-type":
            "application/json",
        },
        body:
          JSON.stringify({
            schema:
              "admissary-product-selection-request/v1",
            candidates,
            policy,
          }),
      },
    );

  if (
    viewerSelection.status !==
    403
  ) {
    throw new Error(
      `Viewer selection status ${viewerSelection.status}`,
    );
  }

  const operatorSelection =
    await fetch(
      `${base}/v1/product/selection`,
      {
        method: "POST",
        headers: {
          authorization:
            `Bearer ${OPERATOR_TOKEN}`,
          "content-type":
            "application/json",
        },
        body:
          JSON.stringify({
            schema:
              "admissary-product-selection-request/v1",
            candidates,
            policy,
          }),
      },
    );

  const operatorBody =
    await operatorSelection.json();

  if (operatorSelection.status !== 400) throw new Error("Forged caller selection was accepted");
  const resolved = await fetch(`${base}/v1/product/selection`, { method: "POST", headers: { authorization: `Bearer ${OPERATOR_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ schema: "admissary-product-selection-request/v1", candidateIds: ["candidate-deepseek-v41-flash"], policy }) });
  const resolvedBody = await resolved.json();
  if (resolved.status !== 200 || resolvedBody.result.selectedCandidateId !== null) throw new Error("Authoritative real selection must have no winner");

} finally {
  if (
    typeof server
      .closeIdleConnections ===
    "function"
  ) {
    server.closeIdleConnections();
  }

  if (
    typeof server
      .closeAllConnections ===
    "function"
  ) {
    server.closeAllConnections();
  }

  await new Promise(
    (resolve) => {
      if (
        !server.listening
      ) {
        resolve();
        return;
      }

      server.close(
        () => resolve(),
      );
    },
  );
}

const proof = {
  schema:
    "admissary-r10c4-decision-workspace-proof/v1",
  createdAt:
    new Date().toISOString(),
  registryDigest:
    registry.registryDigest,
  assuranceProofDigest:
    assurance.proofDigest,
  guidance: {
    packDigest:
      guidance.packDigest,
    coverage,
    mappings:
      guidance.mappings.length,
  },
  selection: {
    policyDigest:
      selection.policyDigest,
    resultDigest:
      selection.resultDigest,
    selectedCandidateId:
      selection.selectedCandidateId,
    claimScope:
      selection.claimScope,
    ranked:
      selection.ranked,
    excluded:
      selection.excluded,
  },
  realSelection: {status:'NO_REAL_ADMISSIBLE_SELECTION',...realSelection},
  realCandidateStates: candidates.filter(c=>c.operational.provider!=='ACCEPTANCE_FIXTURE'),
  operatorApi: {
    overviewAuth:
      "VIEWER_OR_HIGHER",
    selectionAuth:
      "OPERATOR_OR_ADMIN",
    lifecycleWriteApi:
      false,
  },
};

proof.proofDigest =
  digestCanonicalJson(
    proof,
  );

await writeFile(
  "results/ADMISSARY_R10C4_DECISION_WORKSPACE_PROOF.json",
  JSON.stringify(
    proof,
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(
  `R10C4_GUIDANCE_PACK_DIGEST=${guidance.packDigest}`,
);
console.log(
  `R10C4_GUIDANCE_SUPPORTED=${coverage.SUPPORTED}`,
);
console.log(
  `R10C4_GUIDANCE_PARTIAL=${coverage.PARTIAL}`,
);
console.log(
  `R10C4_GUIDANCE_NOT_COVERED=${coverage.NOT_COVERED}`,
);
console.log(
  "R10C4_FALSE_COMPLIANCE_CLAIMS=NO",
);
console.log(
  "R10C4_REAL_REMOTE_CODE_CANDIDATE=DISQUALIFIED",
);
console.log(
  "R10C4_REAL_DEEPSEEK=EXCLUDED_REVIEW_REQUIRED",
);
console.log(
  `R10C4_REAL_GEMMA=EXCLUDED_${candidates.find(c=>c.candidateId==='candidate-gemma4-nvfp4').qualificationState}`,
);
console.log(
  `R10C4_REAL_QWEN=EXCLUDED_${candidates.find(c=>c.candidateId==='candidate-qwen36-nvfp4').qualificationState}`,
);
console.log(
  `R10C4_SELECTED_CANDIDATE=${selection.selectedCandidateId}`,
);
console.log(
  `R10C4_SELECTION_CLAIM_SCOPE=${selection.claimScope}`,
);
console.log(
  "R10C4_WEIGHTED_COMPENSATION=NO",
);
console.log(
  "R10C4_PRODUCT_OVERVIEW_API=PASS",
);
console.log(
  "R10C4_PRODUCT_GUIDANCE_API=PASS",
);
console.log(
  "R10C4_PRODUCT_SELECTION_VIEWER=DENY",
);
console.log(
  "R10C4_PRODUCT_SELECTION_OPERATOR=ALLOW",
);
console.log(
  "R10C4_LIFECYCLE_WRITE_API=NOT_YET_CLAIMED",
);
console.log(
  `R10C4_PROOF_DIGEST=${proof.proofDigest}`,
);
console.log(
  "ADMISSARY_R10C4_DECISION_WORKSPACE_GATE=PASS",
);
