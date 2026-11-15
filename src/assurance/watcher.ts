import {
  digestCanonicalJson,
} from "../qualification/canonical.js";
import type {
  HuggingFaceModelEvidenceBundle,
} from "../evidence/types.js";
import {
  HuggingFaceEvidenceCollector,
  HuggingFaceEvidenceError,
} from "../evidence/huggingface.js";
import type {
  HuggingFaceWatchSnapshot,
  WatchChangeKind,
  WatchComparison,
} from "./types.js";

const FULL_ARTIFACT_BRANCH = [
  "source:artifact",
  "evidence:artifact",
  "control:license-policy",
  "control:workload",
  "evaluation:workload",
  "decision:qualification",
] as const;

const POLICY_EVIDENCE_BRANCH = [
  "evidence:artifact",
  "control:license-policy",
  "decision:qualification",
] as const;

function sortedUnique(
  values:
    readonly string[],
): string[] {
  return [
    ...new Set(values),
  ].sort();
}

export function huggingFaceWatchSnapshotFromEvidence(
  bundle:
    HuggingFaceModelEvidenceBundle,
): HuggingFaceWatchSnapshot {
  const payload = {
    schema:
      "admissary-hf-watch-snapshot/v1" as const,
    repository:
      bundle.repository,
    requestedRevision:
      bundle.requestedRevision,
    resolvedRevision:
      bundle.resolvedRevision,
    modelMetadataDigest:
      bundle.modelMetadata
        .contentDigest,
    fileManifestDigest:
      bundle.fileManifest
        .contentDigest,
    modelCardDigest:
      bundle.modelCard
        ?.contentDigest ??
      null,
    licenseDigest:
      bundle.license
        ?.contentDigest ??
      null,
    configDigest:
      bundle.config
        ?.contentDigest ??
      null,
    remoteCodeDigest:
      bundle.remoteCode
        .contentDigest,
    evidenceBundleDigest:
      bundle.bundleDigest,
    capturedAt:
      bundle.capturedAt,
  };

  return {
    ...payload,
    snapshotDigest:
      digestCanonicalJson(
        payload,
      ),
  };
}

export function compareHuggingFaceWatchSnapshots(
  previous:
    HuggingFaceWatchSnapshot,
  current:
    HuggingFaceWatchSnapshot,
): WatchComparison {
  if (
    previous.repository !==
    current.repository
  ) {
    throw new Error(
      "Cannot compare watch snapshots from different repositories",
    );
  }

  const changes:
    WatchChangeKind[] = [];

  if (
    previous.resolvedRevision !==
    current.resolvedRevision
  ) {
    changes.push(
      "REPOSITORY_REVISION",
    );
  }

  if (
    previous.modelMetadataDigest !==
    current.modelMetadataDigest
  ) {
    changes.push(
      "MODEL_METADATA",
    );
  }

  if (
    previous.fileManifestDigest !==
    current.fileManifestDigest
  ) {
    changes.push(
      "FILE_MANIFEST",
    );
  }

  if (
    previous.modelCardDigest !==
    current.modelCardDigest
  ) {
    changes.push(
      "MODEL_CARD",
    );
  }

  if (
    previous.licenseDigest !==
    current.licenseDigest
  ) {
    changes.push(
      "LICENSE",
    );
  }

  if (
    previous.configDigest !==
    current.configDigest
  ) {
    changes.push(
      "CONFIG",
    );
  }

  if (
    previous.remoteCodeDigest !==
    current.remoteCodeDigest
  ) {
    changes.push(
      "REMOTE_CODE",
    );
  }

  const fullArtifactChange =
    changes.some(
      (change) =>
        [
          "REPOSITORY_REVISION",
          "MODEL_METADATA",
          "FILE_MANIFEST",
          "CONFIG",
          "REMOTE_CODE",
        ].includes(
          change,
        ),
    );

  const invalidatedNodes =
    fullArtifactChange
      ? [
          ...FULL_ARTIFACT_BRANCH,
        ]
      : changes.length > 0
        ? [
            ...POLICY_EVIDENCE_BRANCH,
          ]
        : [];

  return {
    outcome:
      changes.length === 0
        ? "UNCHANGED"
        : "MATERIAL_CHANGE",
    changes,
    invalidatedNodes:
      sortedUnique(
        invalidatedNodes,
      ),
    previousSnapshotDigest:
      previous.snapshotDigest,
    currentSnapshotDigest:
      current.snapshotDigest,
  };
}

export interface HuggingFaceWatchResult {
  outcome:
    | "UNCHANGED"
    | "MATERIAL_CHANGE"
    | "CHECK_ERROR";
  previous:
    HuggingFaceWatchSnapshot;
  current:
    HuggingFaceWatchSnapshot | null;
  comparison:
    WatchComparison | null;
  errorCode: string | null;
  errorDetail: string | null;
}

export async function runHuggingFaceWatch(
  input: {
    collector:
      HuggingFaceEvidenceCollector;
    previous:
      HuggingFaceWatchSnapshot;
    repository:
      string;
    requestedRevision?: string;
  },
): Promise<HuggingFaceWatchResult> {
  try {
    const bundle =
      await input.collector.collect(
        input.repository,
        input.requestedRevision ??
          "main",
      );

    const current =
      huggingFaceWatchSnapshotFromEvidence(
        bundle,
      );

    const comparison =
      compareHuggingFaceWatchSnapshots(
        input.previous,
        current,
      );

    return {
      outcome:
        comparison.outcome,
      previous:
        input.previous,
      current,
      comparison,
      errorCode: null,
      errorDetail: null,
    };
  } catch (error) {
    if (
      error instanceof
      HuggingFaceEvidenceError
    ) {
      return {
        outcome:
          "CHECK_ERROR",
        previous:
          input.previous,
        current: null,
        comparison: null,
        errorCode:
          error.code,
        errorDetail:
          error.message,
      };
    }

    return {
      outcome:
        "CHECK_ERROR",
      previous:
        input.previous,
      current: null,
      comparison: null,
      errorCode:
        "WATCH_UNKNOWN_ERROR",
      errorDetail:
        error instanceof Error
          ? error.message
          : String(error),
    };
  }
}
