import {
  digestCanonicalJson,
} from "../qualification/canonical.js";
import {
  fingerprintNode,
} from "../qualification/fingerprint.js";
import type {
  QualificationNodeType,
} from "../qualification/fingerprint.js";

export type WorkflowNodeExecutionState =
  | "COMPUTED"
  | "REUSED";

export interface WorkflowNodeContext {
  dependencyResults: ReadonlyMap<string, unknown>;
  dependencyResultDigests: ReadonlyMap<string, string>;
}

export interface WorkflowNodeSpec {
  key: string;
  nodeType: QualificationNodeType;
  evaluatorVersion: string;
  configuration: unknown;
  inputDigests: string[];
  dependencies: string[];
  evaluate: (
    context: WorkflowNodeContext,
  ) => unknown;
}

export interface ExecutedWorkflowNode {
  key: string;
  nodeType: QualificationNodeType;
  evaluatorVersion: string;
  configuration: unknown;
  inputDigests: string[];
  dependencies: string[];
  fingerprint: string;
  resultDigest: string;
  result: unknown;
  executionState: WorkflowNodeExecutionState;
}

export interface WorkflowExecution {
  schema: "admissary-workflow-execution/v1";
  nodes: ExecutedWorkflowNode[];
  rootDigest: string;
  reusedKeys: string[];
  recomputedKeys: string[];
}

export interface WorkflowDiff {
  reusedKeys: string[];
  recomputedKeys: string[];
  stalePreviousKeys: string[];
  addedKeys: string[];
  removedKeys: string[];
}

export class WorkflowGraphError extends Error {
  readonly code: string;

  constructor(
    code: string,
    message: string,
  ) {
    super(message);
    this.name = "WorkflowGraphError";
    this.code = code;
  }
}

function validateSpecs(
  specs: readonly WorkflowNodeSpec[],
): void {
  const keys = new Set<string>();

  for (const spec of specs) {
    if (spec.key.trim() === "") {
      throw new WorkflowGraphError(
        "WORKFLOW_INVALID_NODE",
        "Workflow node key must be non-empty",
      );
    }

    if (keys.has(spec.key)) {
      throw new WorkflowGraphError(
        "WORKFLOW_DUPLICATE_NODE",
        `Duplicate workflow node key: ${spec.key}`,
      );
    }

    keys.add(spec.key);

    if (new Set(spec.dependencies).size !== spec.dependencies.length) {
      throw new WorkflowGraphError(
        "WORKFLOW_DUPLICATE_DEPENDENCY",
        `Workflow node ${spec.key} repeats a dependency`,
      );
    }
  }

  for (const spec of specs) {
    for (const dependency of spec.dependencies) {
      if (!keys.has(dependency)) {
        throw new WorkflowGraphError(
          "WORKFLOW_MISSING_DEPENDENCY",
          `Workflow node ${spec.key} depends on missing node ${dependency}`,
        );
      }

      if (dependency === spec.key) {
        throw new WorkflowGraphError(
          "WORKFLOW_CYCLE",
          `Workflow node ${spec.key} depends on itself`,
        );
      }
    }
  }
}

function topologicalOrder(
  specs: readonly WorkflowNodeSpec[],
): WorkflowNodeSpec[] {
  validateSpecs(specs);

  const byKey = new Map(
    specs.map((spec) => [spec.key, spec]),
  );
  const pending = new Set(
    specs.map((spec) => spec.key),
  );
  const emitted = new Set<string>();
  const ordered: WorkflowNodeSpec[] = [];

  while (pending.size > 0) {
    let progressed = false;

    for (const spec of specs) {
      if (!pending.has(spec.key)) continue;

      if (
        spec.dependencies.every(
          (dependency) => emitted.has(dependency),
        )
      ) {
        ordered.push(byKey.get(spec.key)!);
        emitted.add(spec.key);
        pending.delete(spec.key);
        progressed = true;
      }
    }

    if (!progressed) {
      throw new WorkflowGraphError(
        "WORKFLOW_CYCLE",
        `Workflow graph contains a cycle among: ${
          [...pending].sort().join(", ")
        }`,
      );
    }
  }

  return ordered;
}

function validatePreviousExecution(
  previous: WorkflowExecution,
): void {
  const byKey = new Map<string, ExecutedWorkflowNode>();

  for (const node of previous.nodes) {
    if (byKey.has(node.key)) {
      throw new WorkflowGraphError(
        "WORKFLOW_CACHE_TAMPER",
        `Previous workflow repeats node key ${node.key}`,
      );
    }

    byKey.set(node.key, node);
  }

  for (const node of previous.nodes) {
    if (
      digestCanonicalJson(node.result) !==
      node.resultDigest
    ) {
      throw new WorkflowGraphError(
        "WORKFLOW_CACHE_TAMPER",
        `Previous workflow result digest is invalid for ${node.key}`,
      );
    }

    const dependencyResultDigests =
      node.dependencies.map(
        (dependency) => {
          const dependencyNode =
            byKey.get(dependency);

          if (!dependencyNode) {
            throw new WorkflowGraphError(
              "WORKFLOW_CACHE_TAMPER",
              `Previous workflow node ${node.key} references missing dependency ${dependency}`,
            );
          }

          return `${dependency}:${dependencyNode.resultDigest}`;
        },
      );

    const expectedFingerprint =
      fingerprintNode({
        nodeType: node.nodeType,
        evaluatorVersion:
          node.evaluatorVersion,
        configuration:
          node.configuration,
        inputDigests:
          node.inputDigests,
        dependencyResultDigests,
      });

    if (
      expectedFingerprint !==
      node.fingerprint
    ) {
      throw new WorkflowGraphError(
        "WORKFLOW_CACHE_TAMPER",
        `Previous workflow fingerprint is invalid for ${node.key}`,
      );
    }
  }

  const expectedRoot =
    digestCanonicalJson(
      [...previous.nodes]
        .map((node) => ({
          key: node.key,
          fingerprint:
            node.fingerprint,
          resultDigest:
            node.resultDigest,
        }))
        .sort(
          (a, b) =>
            a.key.localeCompare(b.key),
        ),
    );

  if (
    expectedRoot !== previous.rootDigest
  ) {
    throw new WorkflowGraphError(
      "WORKFLOW_CACHE_TAMPER",
      "Previous workflow root digest is invalid",
    );
  }
}

export function executeWorkflowGraph(
  specs: readonly WorkflowNodeSpec[],
  previous?: WorkflowExecution,
): WorkflowExecution {
  const ordered = topologicalOrder(specs);

  const previousByKey = new Map(
    (previous?.nodes ?? []).map(
      (node) => [node.key, node],
    ),
  );

  if (previous) {
    validatePreviousExecution(previous);
  }

  const current = new Map<string, ExecutedWorkflowNode>();
  const nodes: ExecutedWorkflowNode[] = [];

  for (const spec of ordered) {
    const dependencyResultDigests = spec.dependencies.map(
      (dependency) => {
        const node = current.get(dependency);

        if (!node) {
          throw new WorkflowGraphError(
            "WORKFLOW_INTERNAL_ORDER_ERROR",
            `Dependency ${dependency} was not executed before ${spec.key}`,
          );
        }

        return `${dependency}:${node.resultDigest}`;
      },
    );

    const fingerprint = fingerprintNode({
      nodeType: spec.nodeType,
      evaluatorVersion: spec.evaluatorVersion,
      configuration: spec.configuration,
      inputDigests: spec.inputDigests,
      dependencyResultDigests,
    });

    const previousNode = previousByKey.get(spec.key);

    let result: unknown;
    let resultDigest: string;
    let executionState: WorkflowNodeExecutionState;

    if (
      previousNode &&
      previousNode.fingerprint === fingerprint
    ) {
      result = previousNode.result;
      resultDigest = previousNode.resultDigest;
      executionState = "REUSED";
    } else {
      const dependencyResults = new Map<string, unknown>();
      const dependencyDigests = new Map<string, string>();

      for (const dependency of spec.dependencies) {
        const node = current.get(dependency)!;
        dependencyResults.set(
          dependency,
          node.result,
        );
        dependencyDigests.set(
          dependency,
          node.resultDigest,
        );
      }

      result = spec.evaluate({
        dependencyResults,
        dependencyResultDigests: dependencyDigests,
      });

      resultDigest = digestCanonicalJson(result);
      executionState = "COMPUTED";
    }

    const executed: ExecutedWorkflowNode = {
      key: spec.key,
      nodeType: spec.nodeType,
      evaluatorVersion: spec.evaluatorVersion,
      configuration: spec.configuration,
      inputDigests: [...spec.inputDigests],
      dependencies: [...spec.dependencies],
      fingerprint,
      resultDigest,
      result,
      executionState,
    };

    current.set(spec.key, executed);
    nodes.push(executed);
  }

  const rootDigest = digestCanonicalJson(
    [...nodes]
      .map((node) => ({
        key: node.key,
        fingerprint: node.fingerprint,
        resultDigest: node.resultDigest,
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  );

  return {
    schema: "admissary-workflow-execution/v1",
    nodes,
    rootDigest,
    reusedKeys: nodes
      .filter((node) => node.executionState === "REUSED")
      .map((node) => node.key)
      .sort(),
    recomputedKeys: nodes
      .filter((node) => node.executionState === "COMPUTED")
      .map((node) => node.key)
      .sort(),
  };
}

export function diffWorkflowExecutions(
  previous: WorkflowExecution,
  current: WorkflowExecution,
): WorkflowDiff {
  const previousByKey = new Map(
    previous.nodes.map(
      (node) => [node.key, node],
    ),
  );
  const currentByKey = new Map(
    current.nodes.map(
      (node) => [node.key, node],
    ),
  );

  const reusedKeys: string[] = [];
  const recomputedKeys: string[] = [];
  const stalePreviousKeys: string[] = [];
  const addedKeys: string[] = [];
  const removedKeys: string[] = [];

  for (const [key, node] of currentByKey) {
    const old = previousByKey.get(key);

    if (!old) {
      addedKeys.push(key);
      recomputedKeys.push(key);
      continue;
    }

    if (node.fingerprint === old.fingerprint) {
      reusedKeys.push(key);
    } else {
      recomputedKeys.push(key);
      stalePreviousKeys.push(key);
    }
  }

  for (const key of previousByKey.keys()) {
    if (!currentByKey.has(key)) {
      removedKeys.push(key);
      stalePreviousKeys.push(key);
    }
  }

  return {
    reusedKeys: reusedKeys.sort(),
    recomputedKeys: recomputedKeys.sort(),
    stalePreviousKeys: stalePreviousKeys.sort(),
    addedKeys: addedKeys.sort(),
    removedKeys: removedKeys.sort(),
  };
}
