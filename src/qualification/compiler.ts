import type {
  DeploymentContract,
  MetricRequirement,
} from "./contract.js";
import type {
  Criticality,
  Obligation,
} from "./types.js";

function metricCriticality(requirement: MetricRequirement): Criticality {
  return requirement.criticality ?? "MANDATORY";
}

function metricId(metric: string): string {
  return metric
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export interface QualificationPlan {
  contractId: string;
  contractVersion: string;
  evaluationSuite: string;
  evaluationDigest?: string;
  obligations: Obligation[];
}

export function compileContract(contract: DeploymentContract, evaluationDigest?: string): QualificationPlan {
  const obligations: Obligation[] = [
    {
      id: "ART_REVISION_IMMUTABLE",
      kind: "DETERMINISTIC",
      criticality: "MANDATORY",
      evaluator: "artifact.revision.immutable/v1",
      dependencies: ["model.revision"],
      requirement: {
        required: contract.spec.artifact.immutableRevision === "required",
      },
    },
    {
      id: "ART_TOKENIZER_IMMUTABLE",
      kind: "DETERMINISTIC",
      criticality: "MANDATORY",
      evaluator: "artifact.tokenizer.immutable/v1",
      dependencies: ["model.tokenizerRevision"],
      requirement: {
        required: contract.spec.artifact.tokenizerRevision.immutable === "required",
      },
    },
    {
      id: "ART_WEIGHT_FORMAT",
      kind: "DETERMINISTIC",
      criticality: "MANDATORY",
      evaluator: "artifact.weight-format/v1",
      dependencies: ["model.files"],
      requirement: {
        allowed: [...contract.spec.artifact.allowedWeightFormats].sort(),
      },
    },
    {
      id: "ART_REMOTE_CODE",
      kind: "DETERMINISTIC",
      criticality: "MANDATORY",
      evaluator: "artifact.remote-code/v1",
      dependencies: ["model.repositoryMetadata", "model.files"],
      requirement: {
        mode: contract.spec.artifact.remoteRepositoryCode.mode,
      },
    },
    {
      id: "PROV_PUBLISHER",
      kind: "DETERMINISTIC",
      criticality: contract.spec.provenance.publisherIdentity.required
        ? "MANDATORY"
        : "ADVISORY",
      evaluator: "provenance.publisher/v1",
      dependencies: ["model.publisherMetadata"],
      requirement: {
        required: contract.spec.provenance.publisherIdentity.required,
      },
    },
    {
      id: "PROV_LINEAGE",
      kind: "SEMANTIC",
      criticality: contract.spec.provenance.declaredLineage.required
        ? "MANDATORY"
        : "ADVISORY",
      evaluator: "serv.provenance-lineage/v1",
      dependencies: ["evidence.modelCard", "evidence.repositoryMetadata"],
      requirement: {
        required: contract.spec.provenance.declaredLineage.required,
      },
    },
    {
      id: "LIC_DECLARED",
      kind: "DETERMINISTIC",
      criticality: "MANDATORY",
      evaluator: "license.identifier/v1",
      dependencies: ["evidence.licenseMetadata"],
      requirement: {
        approvedIdentifiers: [...contract.spec.licensing.approvedIdentifiers].sort(),
        unlistedAction: contract.spec.licensing.unlistedLicense.action,
      },
    },
    {
      id: "LIC_DEPLOYMENT_COMPATIBILITY",
      kind: "SEMANTIC",
      criticality: "MANDATORY",
      evaluator: "serv.license-deployment-compatibility/v1",
      dependencies: [
        "evidence.licenseText",
        "deployment.intent",
        "policy.license",
      ],
      requirement: {
        commercialUse: contract.spec.deployment.commercialUse,
        workload: contract.spec.purpose.workload,
        environment: contract.spec.purpose.environment,
        audience: contract.spec.purpose.audience,
      },
    },
  ];

  for (const requirement of contract.spec.workloadAcceptance.requirements) {
    obligations.push({
      id: `EVAL_${metricId(requirement.metric)}`,
      kind: "EMPIRICAL",
      criticality: metricCriticality(requirement),
      evaluator: `dolphin.metric.${requirement.metric}/v1`,
      dependencies: [
        "candidate.modelRevision",
        `evaluation.suite.${contract.spec.workloadAcceptance.suite}`,
      ],
      requirement: {
        operator: requirement.operator,
        value: requirement.value,
      },
    });
  }

  return {
    contractId: contract.metadata.id,
    contractVersion: contract.metadata.version,
    evaluationSuite: contract.spec.workloadAcceptance.suite,
    ...(evaluationDigest === undefined ? {} : { evaluationDigest }),
    obligations,
  };
}
