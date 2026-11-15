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
  PersistenceState,
} from "./types.js";

export class PersistenceError extends Error {
  readonly code: string;

  constructor(
    code: string,
    message: string,
  ) {
    super(message);
    this.name = "PersistenceError";
    this.code = code;
  }
}

export type StateTransaction<T> = (
  draft: PersistenceState,
) => T | Promise<T>;

export interface PersistenceRepository {
  read(): Promise<PersistenceState>;

  transact<T>(
    transaction: StateTransaction<T>,
  ): Promise<T>;
}

export function emptyPersistenceState(): PersistenceState {
  return {
    schema: "admissary-persistence/v1",
    revision: 0,
    qualificationRuns: [],
    authorizationEvents: [],
    validityEvents: [],
    auditEvents: [],
  };
}

function validateState(
  state: PersistenceState,
): void {
  validateAuthorityState(state, "legacy");
  if (
    state.schema !==
    "admissary-persistence/v1"
  ) {
    throw new PersistenceError(
      "PERSISTENCE_SCHEMA_ERROR",
      "Unsupported persistence schema",
    );
  }

  if (
    !Number.isInteger(state.revision) ||
    state.revision < 0
  ) {
    throw new PersistenceError(
      "PERSISTENCE_REVISION_ERROR",
      "Persistence revision must be a non-negative integer",
    );
  }
}

function cloneState(
  state: PersistenceState,
): PersistenceState {
  return structuredClone(state);
}

export class MemoryPersistenceRepository
  implements PersistenceRepository {
  private state: PersistenceState;
  private queue: Promise<void> =
    Promise.resolve();

  constructor(
    initial: PersistenceState =
      emptyPersistenceState(),
  ) {
    validateState(initial);
    this.state = cloneState(initial);
  }

  async read(): Promise<PersistenceState> {
    return cloneState(this.state);
  }

  async transact<T>(
    transaction: StateTransaction<T>,
  ): Promise<T> {
    let release!: () => void;

    const waitForTurn = this.queue;
    this.queue = new Promise<void>(
      (resolve) => {
        release = resolve;
      },
    );

    await waitForTurn;

    try {
      const draft =
        cloneState(this.state);

      const result =
        await transaction(draft);

      draft.revision =
        this.state.revision + 1;

      validateState(draft);
      this.state =
        cloneState(draft);

      return result;
    } finally {
      release();
    }
  }
}

export class JsonFilePersistenceRepository
  implements PersistenceRepository {
  private queue: Promise<void> =
    Promise.resolve();

  constructor(
    readonly path: string,
  ) {}

  private async load(): Promise<PersistenceState> {
    try {
      const parsed = JSON.parse(
        await readFile(
          this.path,
          "utf8",
        ),
      ) as PersistenceState;

      validateState(parsed);
      return parsed;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return emptyPersistenceState();
      }

      throw error;
    }
  }

  private async save(
    state: PersistenceState,
  ): Promise<void> {
    validateState(state);

    await mkdir(
      dirname(this.path),
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

  async read(): Promise<PersistenceState> {
    return cloneState(
      await this.load(),
    );
  }

  async transact<T>(
    transaction: StateTransaction<T>,
  ): Promise<T> {
    let release!: () => void;

    const waitForTurn = this.queue;
    this.queue = new Promise<void>(
      (resolve) => {
        release = resolve;
      },
    );

    await waitForTurn;

    let unlock: (() => Promise<void>) | undefined;
    try {
      unlock = await lockStateFile(this.path);
      const current =
        await this.load();

      const draft =
        cloneState(current);

      const result =
        await transaction(draft);

      draft.revision =
        current.revision + 1;

      await this.save(draft);

      return result;
    } finally {
      try { await unlock?.(); } finally { release(); }
    }
  }
}

export function persistenceStateDigest(
  state: PersistenceState,
): string {
  return digestCanonicalJson(state);
}
