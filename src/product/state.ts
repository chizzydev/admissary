import { open } from "node:fs/promises";
import { lockStateFile } from "../persistence/file-lock.js";
import { validateAuthorityState } from "../persistence/validation.js";
import {
  dirname,
} from "node:path";
import {
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";

import {
  digestCanonicalJson,
} from "../qualification/canonical.js";
import type {
  QualificationState,
} from "../qualification/types.js";
import type {
  SignedQualificationAttestation,
} from "../attestations/qualification-attestation.js";

export interface ProductCandidateRecord {
  candidateId: string;
  displayName: string;
  provider: string;
  repositoryOrModelId: string;
  revision: string | null;
  tokenizerRevision: string | null;
  artifactManifestDigest: string | null;
  registeredBy: string;
  registeredAt: string;
}

export interface ProductContractRecord {
  contractId: string;
  version: string;
  digest: string;
  workloadId: string;
  environmentId: string;
  registeredBy: string;
  registeredAt: string;
  updatedAt: string;
}

export type ProductQualificationStatus =
  | "REQUESTED"
  | "COMPLETED"
  | "FAILED";

export interface ProductQualificationRunRecord {
  runId: string;
  candidateId: string;
  contractId: string;
  contractVersion: string;
  environmentId: string;
  workloadId: string;
  status: ProductQualificationStatus;
  qualificationState: QualificationState | null;
  blockers: string[];
  exactArtifactBindingProven: boolean;
  evidenceGraphRootDigest: string | null;
  policyVersion: string | null;
  policyDigest: string | null;
  evaluationSuite: string | null;
  evaluationDigest: string | null;
  sourceRefs: string[];
  requestedBy: string;
  requestedAt: string;
  completedBy: string | null;
  completedAt: string | null;
  replacesDeploymentId: string | null;
  reason: string;
  requestDigest: string;
  completionEvidence?: import("./completion.js").CompletionEvidence;
}

export type ProductDeploymentStatus =
  | "PROVISIONING"
  | "ACTIVE"
  | "ERROR";

export interface ProductDeploymentRecord {
  deploymentId: string;
  candidateId: string;
  contractId: string;
  contractVersion: string;
  qualificationRunId: string;
  assuranceDeploymentId: string;
  status: ProductDeploymentStatus;
  provisioningRequestDigest?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  provisioningError: string | null;
  attestationId: string | null;
}

export interface ProductAttestationRecord {
  attestationId: string;
  deploymentId: string;
  attestation: SignedQualificationAttestation;
  attestationDigest: string;
  recordedBy: string;
  recordedAt: string;
}

export interface ProductEvent {
  recordedAt?: string;
  appendSequence?: number;
  eventId: string;
  occurredAt: string;
  actorId: string;
  type:
    | "CANDIDATE_REGISTERED"
    | "CONTRACT_REGISTERED"
    | "QUALIFICATION_REQUESTED"
    | "QUALIFICATION_COMPLETED"
    | "DEPLOYMENT_PROVISIONING"
    | "DEPLOYMENT_ACTIVE"
    | "DEPLOYMENT_ERROR"
    | "REQUALIFICATION_REQUESTED"
    | "ATTESTATION_RECORDED"
    | "MATERIAL_CHANGE_RECORDED"
    | "REASSESSMENT_COMPLETED";
  subjectId: string;
  detail: string;
}

export interface ProductApplicationState {
  schema: "admissary-product-application/v1";
  revision: number;
  candidates: ProductCandidateRecord[];
  contracts: ProductContractRecord[];
  qualificationRuns: ProductQualificationRunRecord[];
  deployments: ProductDeploymentRecord[];
  attestations: ProductAttestationRecord[];
  events: ProductEvent[];
}

export class ProductStateError extends Error {
  readonly code: string;

  constructor(
    code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProductStateError";
    this.code = code;
  }
}

export interface ProductRepository {
  read(): Promise<ProductApplicationState>;

  transact<T>(
    transaction: (
      draft: ProductApplicationState,
    ) => T | Promise<T>,
  ): Promise<T>;
}

export function emptyProductApplicationState():
  ProductApplicationState {
  return {
    schema: "admissary-product-application/v1",
    revision: 0,
    candidates: [],
    contracts: [],
    qualificationRuns: [],
    deployments: [],
    attestations: [],
    events: [],
  };
}

function validate(
  state: ProductApplicationState,
): void {
  validateAuthorityState(state, "product");
  if (
    state.schema !==
    "admissary-product-application/v1"
  ) {
    throw new ProductStateError(
      "PRODUCT_STATE_SCHEMA_ERROR",
      "Unsupported product application state schema",
    );
  }

  if (
    !Number.isInteger(state.revision) ||
    state.revision < 0
  ) {
    throw new ProductStateError(
      "PRODUCT_STATE_REVISION_ERROR",
      "Product state revision must be a non-negative integer",
    );
  }
}

function clone(
  state: ProductApplicationState,
): ProductApplicationState {
  return structuredClone(state);
}

export class MemoryProductRepository
  implements ProductRepository {
  private state: ProductApplicationState;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    initial: ProductApplicationState =
      emptyProductApplicationState(),
  ) {
    validate(initial);
    this.state = clone(initial);
  }

  async read(): Promise<ProductApplicationState> {
    return clone(this.state);
  }

  async transact<T>(
    transaction: (
      draft: ProductApplicationState,
    ) => T | Promise<T>,
  ): Promise<T> {
    let release!: () => void;
    const wait = this.queue;
    this.queue = new Promise<void>(
      (resolve) => {
        release = resolve;
      },
    );

    await wait;

    try {
      const draft = clone(this.state);
      const result = await transaction(draft);
      draft.revision = this.state.revision;
      validate(draft);

      if (
        digestCanonicalJson(draft) ===
        digestCanonicalJson(this.state)
      ) {
        return result;
      }

      draft.revision = this.state.revision + 1;
      this.state = clone(draft);
      return result;
    } finally {
      release();
    }
  }
}

export class JsonProductRepository
  implements ProductRepository {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    readonly path: string,
  ) {}

  private async load(): Promise<ProductApplicationState> {
    try {
      const parsed = JSON.parse(
        await readFile(this.path, "utf8"),
      ) as ProductApplicationState;
      validate(parsed);
      return parsed;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return emptyProductApplicationState();
      }
      throw error;
    }
  }

  private async save(
    state: ProductApplicationState,
  ): Promise<void> {
    validate(state);
    await mkdir(dirname(this.path), {
      recursive: true,
    });

    const temporary = `${this.path}.tmp`;
    const handle = await open(temporary, "w");
    try { await handle.writeFile(JSON.stringify(state, null, 2) + "\n"); await handle.sync(); }
    finally { await handle.close(); }

    await rename(temporary, this.path);
  }

  async read(): Promise<ProductApplicationState> {
    return clone(await this.load());
  }

  async transact<T>(
    transaction: (
      draft: ProductApplicationState,
    ) => T | Promise<T>,
  ): Promise<T> {
    let release!: () => void;
    const wait = this.queue;
    this.queue = new Promise<void>(
      (resolve) => {
        release = resolve;
      },
    );

    await wait;

    let unlock: (() => Promise<void>) | undefined;
    try {
      unlock = await lockStateFile(this.path);
      const current = await this.load();
      const draft = clone(current);
      const result = await transaction(draft);
      draft.revision = current.revision;
      validate(draft);

      if (
        digestCanonicalJson(draft) ===
        digestCanonicalJson(current)
      ) {
        return result;
      }

      draft.revision = current.revision + 1;
      await this.save(draft);
      return result;
    } finally {
      try { await unlock?.(); } finally { release(); }
    }
  }
}

export function productApplicationStateDigest(
  state: ProductApplicationState,
): string {
  return digestCanonicalJson(state);
}
