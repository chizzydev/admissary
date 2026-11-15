import type {
  ArtifactFileIdentity,
  RemoteCodeAssessment,
} from "./types.js";

function collectAutoMapEntries(
  value: unknown,
  path = "auto_map",
): string[] {
  if (typeof value === "string") {
    return [`${path}=${value}`];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectAutoMapEntries(item, `${path}[${index}]`)
    );
  }

  if (typeof value === "object" && value !== null) {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, item]) => collectAutoMapEntries(item, `${path}.${key}`),
    );
  }

  return [];
}

export function assessRemoteCodeRequirement(
  config: Record<string, unknown> | null,
  files: readonly ArtifactFileIdentity[],
): RemoteCodeAssessment {
  const reasons: string[] = [];
  const evidencePaths = new Set<string>();

  if (config && Object.prototype.hasOwnProperty.call(config, "auto_map")) {
    const entries = collectAutoMapEntries(config.auto_map);
    if (entries.length > 0) {
      reasons.push(
        "config.json declares auto_map entries for custom AutoClass loading",
      );
      evidencePaths.add("config.json");

      return {
        state: "REQUIRED",
        reasons,
        evidencePaths: [...evidencePaths].sort(),
      };
    }
  }

  const customGenerate = files.filter((file) => {
    const lower = file.path.toLowerCase().replaceAll("\\", "/");
    return (
      lower === "custom_generate/generate.py" ||
      lower.endsWith("/custom_generate/generate.py")
    );
  });

  if (customGenerate.length > 0) {
    reasons.push(
      "repository contains custom_generate/generate.py, a custom generation code path",
    );
    for (const file of customGenerate) evidencePaths.add(file.path);
  }

  const modelCode = files.filter((file) => file.role === "MODEL_CODE");
  if (modelCode.length > 0) {
    reasons.push(
      "repository contains executable Python/model code; presence alone does not prove the standard load path requires it",
    );
    for (const file of modelCode) evidencePaths.add(file.path);
  }

  if (reasons.length > 0) {
    return {
      state: "INDICATED",
      reasons,
      evidencePaths: [...evidencePaths].sort(),
    };
  }

  if (!config) {
    return {
      state: "UNKNOWN",
      reasons: ["config.json was not available for remote-code assessment"],
      evidencePaths: [],
    };
  }

  return {
    state: "NOT_INDICATED",
    reasons: [
      "no auto_map declaration or repository custom-code indicators were found in collected evidence",
    ],
    evidencePaths: ["config.json"],
  };
}
