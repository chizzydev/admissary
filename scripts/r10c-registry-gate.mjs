import { acceptedHistorical } from "./artifact-integrity.mjs";
import { liveCandidateRecords } from "./live-candidate-evidence.mjs";
const liveRecords=await liveCandidateRecords();
import {
  readFile,
  readdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  join,
} from "node:path";

import {
  JsonRegistryRepository,
  ModelRegistryService,
  registryStateDigest,
  verifyWorkloadPack,
} from "../dist/index.js";

async function latest(prefix) { return await acceptedHistorical(prefix); }

const r6 =
  JSON.parse(
    await readFile(
      await latest(
        "ADMISSARY_R6_ORCHESTRATION_",
      ),
      "utf8",
    ),
  );

const r9 =
  JSON.parse(
    await readFile(
      await latest(
        "ADMISSARY_R9_JUDGE_VIEW_",
      ),
      "utf8",
    ),
  );

const bankingPack =
  JSON.parse(
    await readFile(
      "data/workloads/banking-routing-v1.workload.json",
      "utf8",
    ),
  );

const releasePack =
  JSON.parse(
    await readFile(
      "data/workloads/release-risk-triage-v1.workload.json",
      "utf8",
    ),
  );

for (
  const pack of
  [bankingPack, releasePack]
) {
  if (
    !verifyWorkloadPack(
      pack,
    )
  ) {
    throw new Error(
      `Workload pack verification failed: ${pack.id}`,
    );
  }
}

if (
  bankingPack.legacyBinding?.suiteDigest !==
  r6.r5Evidence.suiteDigest
) {
  throw new Error(
    "BANKING77 workload pack no longer binds to canonical R5 suite digest",
  );
}

const statePath =
  "results/ADMISSARY_R10C_REGISTRY_STATE.json";

try {
  await unlink(
    statePath,
  );
} catch (error) {
  if (
    !(
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
  ) {
    throw error;
  }
}

const repository =
  new JsonRegistryRepository(
    statePath,
  );

const registry =
  new ModelRegistryService(
    repository,
  );

const t0 =
  "2026-11-14T19:10:00.000Z";

await registry.registerOrganization(
  {
    id:
      "org-demo-bank",
    name:
      "Demo Bank AI Platform",
  },
  t0,
);

await registry.registerEnvironment(
  {
    id:
      "env-prod-eu",
    organizationId:
      "org-demo-bank",
    name:
      "Production / EU",
    tier:
      "PRODUCTION",
    region:
      "eu",
  },
  "2026-11-14T19:10:01.000Z",
);

await registry.registerEnvironment(
  {
    id:
      "env-staging",
    organizationId:
      "org-demo-bank",
    name:
      "Staging",
    tier:
      "STAGING",
  },
  "2026-11-14T19:10:02.000Z",
);

await registry.registerWorkload(
  {
    id:
      "workload-banking-routing",
    packId:
      bankingPack.id,
    packVersion:
      bankingPack.version,
    packDigest:
      bankingPack.packDigest,
    name:
      bankingPack.name,
  },
  "2026-11-14T19:10:03.000Z",
);

await registry.registerWorkload(
  {
    id:
      "workload-release-risk",
    packId:
      releasePack.id,
    packVersion:
      releasePack.version,
    packDigest:
      releasePack.packDigest,
    name:
      releasePack.name,
  },
  "2026-11-14T19:10:04.000Z",
);

const candidates = [
  {
    id:
      "candidate-deepseek-v41-flash",
    displayName:
      "DeepSeek V4.1 Flash",
    repositoryOrModelId:
      "deepseek-ai/DeepSeek-V4.1-Flash",
  },
  {
    id:
      "candidate-gemma4-nvfp4",
    displayName:
      "Gemma 4 26B A4B NVFP4",
    repositoryOrModelId:
      "nvidia/Gemma-4-26B-A4B-NVFP4",
  },
  {
    id:
      "candidate-qwen36-nvfp4",
    displayName:
      "Qwen 3.6 35B A3B NVFP4",
    repositoryOrModelId:
      "nvidia/Qwen3.6-35B-A3B-NVFP4",
  },
];

for (
  let index = 0;
  index <
    candidates.length;
  index += 1
) {
  const candidate =
    candidates[index];

  await registry.registerCandidate(
    {
      id:
        candidate.id,
      organizationId:
        "org-demo-bank",
      displayName:
        candidate.displayName,
      source:
        "DOLPHIN",
      repositoryOrModelId:
        candidate.repositoryOrModelId,
      accountableOwner:
        "AI Platform",
      createdAt:
        `2026-11-14T19:11:0${index}.000Z`,
    },
    `2026-11-14T19:11:0${index}.000Z`,
  );

  await registry.registerArtifactRevision(
    {
      id:
        `artifact-${candidate.id}`,
      candidateId:
        candidate.id,
      immutableRevision:
        null,
      tokenizerRevision:
        null,
      artifactDigest:
        null,
      runtimeBindingScope:
        "PROVIDER_MODEL_IDENTITY",
      exactArtifactBindingProven:
        false,
      createdAt:
        `2026-11-14T19:12:0${index}.000Z`,
    },
    `2026-11-14T19:12:0${index}.000Z`,
  );
}

await registry.registerDeployment(
  {
    id:
      "deployment-deepseek-banking-prod",
    organizationId:
      "org-demo-bank",
    environmentId:
      "env-prod-eu",
    workloadId:
      "workload-banking-routing",
    contractId:
      r6.contract.id,
    contractVersion:
      r6.contract.version,
    candidateId:
      "candidate-deepseek-v41-flash",
    artifactRevisionId:
      "artifact-candidate-deepseek-v41-flash",
    qualificationState:
      r6.fullQualificationCoverage.state,
    authorizationState:
      "NOT_REQUESTED",
    validityState:
      "CURRENT",
    activeBlockers:
      r6.manifestEligibility.reasons,
    latestQualificationRunId:
      "r6-deepseek-live",
    latestAttestationDigest:
      null,
    nextReassessmentAt:
      null,
    updatedAt:
      r6.createdAt,
  },
  "2026-11-14T19:13:00.000Z",
);

for (
  const [
    candidateId,
    suffix,
  ] of [
    [
      "candidate-gemma4-nvfp4",
      "gemma",
    ],
    [
      "candidate-qwen36-nvfp4",
      "qwen",
    ],
  ]
) {
  const live=liveRecords.find(r=>r.target.candidateId===candidateId);
  // This timestamp records the actual registry import, including unexecuted credit-limited statuses.
  const observedAt=live ? new Date().toISOString() : "2026-11-14T19:13:30.000Z";
  await registry.registerDeployment(
    {
      id:
        `deployment-${suffix}-banking-staging`,
      organizationId:
        "org-demo-bank",
      environmentId:
        "env-staging",
      workloadId:
        "workload-banking-routing",
      contractId:
        r6.contract.id,
      contractVersion:
        r6.contract.version,
      candidateId,
      artifactRevisionId:
        `artifact-${candidateId}`,
      qualificationState: live?.qualificationState ?? "INCOMPLETE",
      authorizationState:
        "NOT_REQUESTED",
      validityState:
        "CURRENT",
      activeBlockers: live?.blockers ?? [
        "NOT_EVALUATED",
        "EXACT_ARTIFACT_BINDING_UNPROVEN",
      ],
      latestQualificationRunId: live?.raw?.runDigest ?? null,
      latestAttestationDigest:
        null,
      nextReassessmentAt:
        null,
      updatedAt: observedAt,
    },
    observedAt,
  );
}

await registry.registerDeployment(
  {
    id:
      "deployment-deepseek-release-risk-staging",
    organizationId:
      "org-demo-bank",
    environmentId:
      "env-staging",
    workloadId:
      "workload-release-risk",
    contractId:
      "release-risk-triage-demo",
    contractVersion:
      "1.0.0",
    candidateId:
      "candidate-deepseek-v41-flash",
    artifactRevisionId:
      "artifact-candidate-deepseek-v41-flash",
    qualificationState:
      "INCOMPLETE",
    authorizationState:
      "NOT_REQUESTED",
    validityState:
      "CURRENT",
    activeBlockers: [
      "NOT_EVALUATED",
      "NO_DEPLOYMENT_CONTRACT_RESULT",
    ],
    latestQualificationRunId:
      null,
    latestAttestationDigest:
      null,
    nextReassessmentAt:
      null,
    updatedAt:
      "2026-11-14T19:14:00.000Z",
  },
  "2026-11-14T19:14:00.000Z",
);

const summaries =
  await registry.summaries();

if (
  summaries.length !== 4
) {
  throw new Error(
    `Expected four registry deployment entries, got ${summaries.length}`,
  );
}

const realDeepSeek =
  summaries.find(
    (item) =>
      item.deploymentId ===
      "deployment-deepseek-banking-prod",
  );

if (
  !realDeepSeek ||
  realDeepSeek.qualificationState !==
    "REVIEW_REQUIRED" ||
  realDeepSeek.exactArtifactBindingProven !==
    false
) {
  throw new Error(
    "Real DeepSeek registry truth drifted",
  );
}

for (
  const id of [
    "deployment-gemma-banking-staging",
    "deployment-qwen-banking-staging",
  ]
) {
  const summary =
    summaries.find(
      (item) =>
        item.deploymentId === id,
    );

  const live=liveRecords.find(r=>id===`deployment-${r.target.slug}-banking-staging`);
  if (
    !summary ||
    summary.qualificationState !==
      (live?.qualificationState ?? "INCOMPLETE") ||
    !summary.blockers.includes(
      live ? "EXACT_ARTIFACT_BINDING_UNPROVEN" : "NOT_EVALUATED",
    )
  ) {
    throw new Error(
      `Unevaluated candidate ${id} was misrepresented`,
    );
  }
}

const state =
  await repository.read();

const digest =
  registryStateDigest(
    state,
  );

const artifact = {
  schema:
    "admissary-r10c-registry-proof/v1",
  createdAt:
    new Date().toISOString(),
  registryDigest:
    digest,
  counts: {
    organizations:
      state.organizations.length,
    environments:
      state.environments.length,
    workloads:
      state.workloads.length,
    candidates:
      state.candidates.length,
    artifactRevisions:
      state.artifactRevisions.length,
    deployments:
      state.deployments.length,
    events:
      state.events.length,
  },
  bankingPack: {
    id:
      bankingPack.id,
    digest:
      bankingPack.packDigest,
    legacySuiteDigest:
      bankingPack.legacyBinding.suiteDigest,
    cases:
      bankingPack.cases.length,
  },
  examplePack: {
    id:
      releasePack.id,
    digest:
      releasePack.packDigest,
    cases:
      releasePack.cases.length,
  },
  deployments:
    summaries,
};
await writeFile(
  "results/ADMISSARY_R10C_REGISTRY_PROOF.json",
  JSON.stringify(
    {
      ...artifact,
      proofDigest:
        (await import("../dist/index.js"))
          .digestCanonicalJson(
            artifact,
          ),
    },
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(
  `R10C_REGISTRY_DIGEST=${digest}`,
);
console.log(
  `R10C_REGISTRY_ORGANIZATIONS=${state.organizations.length}`,
);
console.log(
  `R10C_REGISTRY_ENVIRONMENTS=${state.environments.length}`,
);
console.log(
  `R10C_REGISTRY_WORKLOADS=${state.workloads.length}`,
);
console.log(
  `R10C_REGISTRY_CANDIDATES=${state.candidates.length}`,
);
console.log(
  `R10C_REGISTRY_DEPLOYMENTS=${state.deployments.length}`,
);
console.log(
  "R10C_REAL_DEEPSEEK_STATE=REVIEW_REQUIRED",
);
console.log(
  `R10C_GEMMA_STATE=${liveRecords.find(r=>r.target.slug==='gemma')?.qualificationState ?? 'INCOMPLETE_NOT_EVALUATED'}`,
);
console.log(
  `R10C_QWEN_STATE=${liveRecords.find(r=>r.target.slug==='qwen')?.qualificationState ?? 'INCOMPLETE_NOT_EVALUATED'}`,
);
console.log(
  "R10C_MULTI_MODEL_REGISTRY=PASS",
);
console.log(
  "R10C_MULTI_WORKLOAD_REGISTRY=PASS",
);
console.log(
  "R10C_REGISTRY_TRUTH_GATE=PASS",
);
