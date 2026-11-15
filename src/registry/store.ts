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
  ModelRegistryState,
} from "./types.js";

export class RegistryError extends Error {
  readonly code: string;

  constructor(
    code: string,
    message: string,
  ) {
    super(message);
    this.name = "RegistryError";
    this.code = code;
  }
}

export interface RegistryRepository {
  read(): Promise<ModelRegistryState>;

  transact<T>(
    transaction: (
      draft:
        ModelRegistryState,
    ) =>
      T | Promise<T>,
  ): Promise<T>;
}

export function emptyModelRegistryState(): ModelRegistryState {
  return {
    schema:
      "admissary-model-registry/v1",
    revision: 0,
    organizations: [],
    environments: [],
    workloads: [],
    candidates: [],
    artifactRevisions: [],
    deployments: [],
    events: [],
  };
}

function validateState(
  state: ModelRegistryState,
): void {
  validateAuthorityState(state, "registry");
  if (
    state.schema !==
    "admissary-model-registry/v1"
  ) {
    throw new RegistryError(
      "REGISTRY_SCHEMA_ERROR",
      "Unsupported registry schema",
    );
  }

  if (
    !Number.isInteger(
      state.revision,
    ) ||
    state.revision < 0
  ) {
    throw new RegistryError(
      "REGISTRY_REVISION_ERROR",
      "Registry revision must be a non-negative integer",
    );
  }
}

function clone(
  state: ModelRegistryState,
): ModelRegistryState {
  return structuredClone(
    state,
  );
}

export class MemoryRegistryRepository
  implements RegistryRepository {
  private state:
    ModelRegistryState;
  private queue:
    Promise<void> =
      Promise.resolve();

  constructor(
    initial:
      ModelRegistryState =
        emptyModelRegistryState(),
  ) {
    validateState(
      initial,
    );

    this.state =
      clone(initial);
  }

  async read(): Promise<ModelRegistryState> {
    return clone(
      this.state,
    );
  }

  async transact<T>(
    transaction: (
      draft:
        ModelRegistryState,
    ) =>
      T | Promise<T>,
  ): Promise<T> {
    let release!: () => void;

    const wait =
      this.queue;

    this.queue =
      new Promise<void>(
        (resolve) => {
          release = resolve;
        },
      );

    await wait;

    try {
      const draft =
        clone(
          this.state,
        );

      const result =
        await transaction(
          draft,
        );

      draft.revision =
        this.state.revision + 1;

      validateState(
        draft,
      );

      this.state =
        clone(draft);

      return result;
    } finally {
      release();
    }
  }
}

export class JsonRegistryRepository
  implements RegistryRepository {
  private queue:
    Promise<void> =
      Promise.resolve();

  constructor(
    readonly path: string,
  ) {}

  private async load(): Promise<ModelRegistryState> {
    try {
      const state =
        JSON.parse(
          await readFile(
            this.path,
            "utf8",
          ),
        ) as ModelRegistryState;

      validateState(
        state,
      );

      return state;
    } catch (error) {
      if (
        error &&
        typeof error ===
          "object" &&
        "code" in error &&
        error.code ===
          "ENOENT"
      ) {
        return emptyModelRegistryState();
      }

      throw error;
    }
  }

  private async save(
    state: ModelRegistryState,
  ): Promise<void> {
    validateState(
      state,
    );

    await mkdir(
      dirname(
        this.path,
      ),
      {
        recursive: true,
      },
    );

    const temporary =
      `${this.path}.tmp`;

    const handle = await open(temporary, "w");
    try { await handle.writeFile(JSON.stringify(state, null, 2) + "\n"); await handle.sync(); }
    finally { await handle.close(); }

    await rename(
      temporary,
      this.path,
    );
  }

  async read(): Promise<ModelRegistryState> {
    return clone(
      await this.load(),
    );
  }

  async transact<T>(
    transaction: (
      draft:
        ModelRegistryState,
    ) =>
      T | Promise<T>,
  ): Promise<T> {
    let release!: () => void;

    const wait =
      this.queue;

    this.queue =
      new Promise<void>(
        (resolve) => {
          release = resolve;
        },
      );

    await wait;

    let unlock: (() => Promise<void>) | undefined;
    try {
      unlock = await lockStateFile(this.path);
      const current =
        await this.load();

      const draft =
        clone(current);

      const result =
        await transaction(
          draft,
        );

      draft.revision =
        current.revision + 1;

      await this.save(
        draft,
      );

      return result;
    } finally {
      try { await unlock?.(); } finally { release(); }
    }
  }
}

export function registryStateDigest(
  state: ModelRegistryState,
): string {
  return digestCanonicalJson(
    state,
  );
}
