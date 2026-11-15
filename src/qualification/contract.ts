export type UnlistedLicenseAction = "review" | "reject";

export interface MetricRequirement {
  metric: string;
  operator: "gte" | "lte" | "eq";
  value: number;
  criticality?: "MANDATORY" | "ADVISORY";
}

export interface DeploymentContract {
  apiVersion: "qualification/v1alpha1";
  kind: "DeploymentContract";

  metadata: {
    id: string;
    version: string;
  };

  spec: {
    purpose: {
      workload: string;
      environment: string;
      audience: string;
    };

    deployment: {
      commercialUse: boolean;
      regions: string[];
      dataClasses: string[];
    };

    artifact: {
      immutableRevision: "required";
      allowedWeightFormats: string[];
      remoteRepositoryCode: {
        mode: "forbidden" | "allowed";
      };
      tokenizerRevision: {
        immutable: "required";
      };
    };

    provenance: {
      publisherIdentity: {
        required: boolean;
      };
      declaredLineage: {
        required: boolean;
      };
    };

    licensing: {
      approvedIdentifiers: string[];
      unlistedLicense: {
        action: UnlistedLicenseAction;
      };
    };

    workloadAcceptance: {
      suite: string;
      requirements: MetricRequirement[];
    };

    authorization: {
      humanApproval: "required" | "optional";
    };
  };
}

export class ContractValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid DeploymentContract:\n- ${issues.join("\n- ")}`);
    this.name = "ContractValidationError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: string[],
): string | undefined {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(`${path}.${key} must be a non-empty string`);
    return undefined;
  }
  return value;
}

function requireRecord(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: string[],
): Record<string, unknown> | undefined {
  const value = record[key];
  if (!isRecord(value)) {
    issues.push(`${path}.${key} must be an object`);
    return undefined;
  }
  return value;
}

function requireStringArray(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: string[],
  allowEmpty = false,
): string[] | undefined {
  const value = record[key];
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.some((item) => typeof item !== "string" || item.trim() === "")
  ) {
    issues.push(`${path}.${key} must be ${allowEmpty ? "a" : "a non-empty"} string array`);
    return undefined;
  }
  return value as string[];
}

export function parseDeploymentContract(input: unknown): DeploymentContract {
  const issues: string[] = [];

  if (!isRecord(input)) {
    throw new ContractValidationError(["root must be an object"]);
  }

  if (input.apiVersion !== "qualification/v1alpha1") {
    issues.push('apiVersion must equal "qualification/v1alpha1"');
  }

  if (input.kind !== "DeploymentContract") {
    issues.push('kind must equal "DeploymentContract"');
  }

  const metadata = requireRecord(input, "metadata", "root", issues);
  if (metadata) {
    requireString(metadata, "id", "metadata", issues);
    requireString(metadata, "version", "metadata", issues);
  }

  const spec = requireRecord(input, "spec", "root", issues);

  if (spec) {
    const purpose = requireRecord(spec, "purpose", "spec", issues);
    if (purpose) {
      requireString(purpose, "workload", "spec.purpose", issues);
      requireString(purpose, "environment", "spec.purpose", issues);
      requireString(purpose, "audience", "spec.purpose", issues);
    }

    const deployment = requireRecord(spec, "deployment", "spec", issues);
    if (deployment) {
      if (typeof deployment.commercialUse !== "boolean") {
        issues.push("spec.deployment.commercialUse must be boolean");
      }
      requireStringArray(deployment, "regions", "spec.deployment", issues);
      requireStringArray(deployment, "dataClasses", "spec.deployment", issues);
    }

    const artifact = requireRecord(spec, "artifact", "spec", issues);
    if (artifact) {
      if (artifact.immutableRevision !== "required") {
        issues.push('spec.artifact.immutableRevision must equal "required"');
      }

      requireStringArray(artifact, "allowedWeightFormats", "spec.artifact", issues);

      const remoteRepositoryCode = requireRecord(
        artifact,
        "remoteRepositoryCode",
        "spec.artifact",
        issues,
      );
      if (
        remoteRepositoryCode &&
        remoteRepositoryCode.mode !== "forbidden" &&
        remoteRepositoryCode.mode !== "allowed"
      ) {
        issues.push('spec.artifact.remoteRepositoryCode.mode must be "forbidden" or "allowed"');
      }

      const tokenizerRevision = requireRecord(
        artifact,
        "tokenizerRevision",
        "spec.artifact",
        issues,
      );
      if (tokenizerRevision && tokenizerRevision.immutable !== "required") {
        issues.push('spec.artifact.tokenizerRevision.immutable must equal "required"');
      }
    }

    const provenance = requireRecord(spec, "provenance", "spec", issues);
    if (provenance) {
      for (const field of ["publisherIdentity", "declaredLineage"] as const) {
        const entry = requireRecord(provenance, field, "spec.provenance", issues);
        if (entry && typeof entry.required !== "boolean") {
          issues.push(`spec.provenance.${field}.required must be boolean`);
        }
      }
    }

    const licensing = requireRecord(spec, "licensing", "spec", issues);
    if (licensing) {
      requireStringArray(licensing, "approvedIdentifiers", "spec.licensing", issues);

      const unlistedLicense = requireRecord(
        licensing,
        "unlistedLicense",
        "spec.licensing",
        issues,
      );
      if (
        unlistedLicense &&
        unlistedLicense.action !== "review" &&
        unlistedLicense.action !== "reject"
      ) {
        issues.push('spec.licensing.unlistedLicense.action must be "review" or "reject"');
      }
    }

    const workloadAcceptance = requireRecord(
      spec,
      "workloadAcceptance",
      "spec",
      issues,
    );
    if (workloadAcceptance) {
      requireString(workloadAcceptance, "suite", "spec.workloadAcceptance", issues);

      const requirements = workloadAcceptance.requirements;
      if (!Array.isArray(requirements) || requirements.length === 0) {
        issues.push("spec.workloadAcceptance.requirements must be a non-empty array");
      } else {
        const metrics = new Set<string>();

        requirements.forEach((raw, index) => {
          const path = `spec.workloadAcceptance.requirements[${index}]`;
          if (!isRecord(raw)) {
            issues.push(`${path} must be an object`);
            return;
          }

          const metric = requireString(raw, "metric", path, issues);
          if (metric) {
            if (metrics.has(metric)) {
              issues.push(`${path}.metric duplicates metric "${metric}"`);
            }
            metrics.add(metric);
          }

          if (!["gte", "lte", "eq"].includes(String(raw.operator))) {
            issues.push(`${path}.operator must be gte, lte, or eq`);
          }

          if (typeof raw.value !== "number" || !Number.isFinite(raw.value)) {
            issues.push(`${path}.value must be a finite number`);
          }

          if (
            raw.criticality !== undefined &&
            raw.criticality !== "MANDATORY" &&
            raw.criticality !== "ADVISORY"
          ) {
            issues.push(`${path}.criticality must be MANDATORY or ADVISORY`);
          }
        });
      }
    }

    const authorization = requireRecord(spec, "authorization", "spec", issues);
    if (
      authorization &&
      authorization.humanApproval !== "required" &&
      authorization.humanApproval !== "optional"
    ) {
      issues.push('spec.authorization.humanApproval must be "required" or "optional"');
    }
  }

  if (issues.length > 0) {
    throw new ContractValidationError(issues);
  }

  return input as unknown as DeploymentContract;
}
