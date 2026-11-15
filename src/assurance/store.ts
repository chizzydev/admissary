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
  ContinuousAssuranceState,
} from "./types.js";

export class AssuranceError extends Error {
  readonly code: string;

  constructor(
    code: string,
    message: string,
  ) {
    super(message);
    this.name =
      "AssuranceError";
    this.code = code;
  }
}

export interface AssuranceRepository {
  read():
    Promise<
      ContinuousAssuranceState
    >;

  transact<T>(
    transaction: (
      draft:
        ContinuousAssuranceState,
    ) =>
      T | Promise<T>,
  ): Promise<T>;
}

export function emptyContinuousAssuranceState():
  ContinuousAssuranceState {
  return {
    schema:
      "admissary-continuous-assurance/v1",
    revision: 0,
    deployments: [],
    approvals: [],
    watchChecks: [],
    reassessments: [],
    events: [],
  };
}

function validateState(
  state:
    ContinuousAssuranceState,
): void {
  validateAuthorityState(state, "assurance");
  if (
    state.schema !==
    "admissary-continuous-assurance/v1"
  ) {
    throw new AssuranceError(
      "ASSURANCE_SCHEMA_ERROR",
      "Unsupported assurance state schema",
    );
  }

  if (
    !Number.isInteger(
      state.revision,
    ) ||
    state.revision < 0
  ) {
    throw new AssuranceError(
      "ASSURANCE_REVISION_ERROR",
      "Assurance revision must be a non-negative integer",
    );
  }
}

function clone(
  state:
    ContinuousAssuranceState,
): ContinuousAssuranceState {
  return structuredClone(
    state,
  );
}

export class MemoryAssuranceRepository
  implements AssuranceRepository {
  private state:
    ContinuousAssuranceState;

  private queue:
    Promise<void> =
      Promise.resolve();

  constructor(
    initial:
      ContinuousAssuranceState =
        emptyContinuousAssuranceState(),
  ) {
    validateState(
      initial,
    );

    this.state =
      clone(initial);
  }

  async read():
    Promise<
      ContinuousAssuranceState
    > {
    return clone(
      this.state,
    );
  }

  async transact<T>(
    transaction: (
      draft:
        ContinuousAssuranceState,
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

export class JsonAssuranceRepository
  implements AssuranceRepository {
  private queue:
    Promise<void> =
      Promise.resolve();

  constructor(
    readonly path: string,
  ) {}

  private async load():
    Promise<
      ContinuousAssuranceState
    > {
    try {
      const parsed =
        JSON.parse(
          await readFile(
            this.path,
            "utf8",
          ),
        ) as
          ContinuousAssuranceState;

      validateState(
        parsed,
      );

      return parsed;
    } catch (error) {
      if (
        error &&
        typeof error ===
          "object" &&
        "code" in error &&
        error.code ===
          "ENOENT"
      ) {
        return emptyContinuousAssuranceState();
      }

      throw error;
    }
  }

  private async save(
    state:
      ContinuousAssuranceState,
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

  async read():
    Promise<
      ContinuousAssuranceState
    > {
    return clone(
      await this.load(),
    );
  }

  async transact<T>(
    transaction: (
      draft:
        ContinuousAssuranceState,
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

export function continuousAssuranceStateDigest(
  state:
    ContinuousAssuranceState,
): string {
  return digestCanonicalJson(
    state,
  );
}
