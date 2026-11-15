import {
  buildQualificationManifest,
  compileContract,
  decideQualification,
  minimalBlockingSets,
  parseDeploymentContract,
} from "../dist/index.js";

const contract = parseDeploymentContract({
  apiVersion: "qualification/v1alpha1",
  kind: "DeploymentContract",
  metadata: {
    id: "banking-support-prod",
    version: "1.0.0",
  },
  spec: {
    purpose: {
      workload: "customer-support-intent-routing",
      environment: "production",
      audience: "customers",
    },
    deployment: {
      commercialUse: true,
      regions: ["eu", "uk"],
      dataClasses: ["internal", "confidential"],
    },
    artifact: {
      immutableRevision: "required",
      allowedWeightFormats: ["safetensors"],
      remoteRepositoryCode: { mode: "forbidden" },
      tokenizerRevision: { immutable: "required" },
    },
    provenance: {
      publisherIdentity: { required: true },
      declaredLineage: { required: true },
    },
    licensing: {
      approvedIdentifiers: ["apache-2.0", "mit", "bsd-3-clause"],
      unlistedLicense: { action: "review" },
    },
    workloadAcceptance: {
      suite: "banking-routing-v1",
      requirements: [
        { metric: "macro_f1", operator: "gte", value: 0.82 },
        { metric: "critical_intent_recall", operator: "gte", value: 0.90 },
        { metric: "schema_validity", operator: "eq", value: 1.0 },
        { metric: "injection_invariance", operator: "gte", value: 0.95 }
      ],
    },
    authorization: {
      humanApproval: "required",
    },
  },
});

const plan = compileContract(contract);

const decision = decideQualification(
  plan.obligations.map((obligation) => ({
    obligationId: obligation.id,
    kind: obligation.kind,
    criticality: obligation.criticality,
    state:
      obligation.id === "ART_REMOTE_CODE"
        ? "FAIL"
        : "PASS",
  })),
);

const policyExpression = {
  type: "all",
  children: [
    { type: "control", controlId: "ART_REVISION_IMMUTABLE" },
    { type: "control", controlId: "ART_REMOTE_CODE" },
    {
      type: "any",
      children: [
        { type: "control", controlId: "PROV_PUBLISHER" },
        { type: "control", controlId: "APPROVED_INTERNAL_MIRROR" },
      ],
    },
  ],
};

const blockers = minimalBlockingSets(policyExpression, {
  ART_REVISION_IMMUTABLE: "PASS",
  ART_REMOTE_CODE: "FAIL",
  PROV_PUBLISHER: "FAIL",
  APPROVED_INTERNAL_MIRROR: "FAIL",
});

const manifest = buildQualificationManifest({
  schema: "qualification-manifest/v1",
  candidate: {
    repository: "example/custom-code-model",
    revision: "abc123",
    tokenizerRevision: "tok123",
    artifactManifestDigest: "sha256:artifact",
  },
  contract: {
    id: contract.metadata.id,
    version: contract.metadata.version,
    digest: "sha256:contract",
  },
  policyPack: {
    version: "1.0.0",
    digest: "sha256:policy",
  },
  evaluation: {
    suite: contract.spec.workloadAcceptance.suite,
    digest: "sha256:evaluation",
  },
  evidenceGraph: {
    rootDigest: "sha256:evidence",
  },
  qualification: {
    state: decision.state,
  },
  authorization: {
    state: "NOT_REQUESTED",
  },
  validity: {
    state: "CURRENT",
  },
});

console.log(JSON.stringify({
  contract: `${plan.contractId}@${plan.contractVersion}`,
  obligations: plan.obligations.length,
  decision,
  blockers,
  manifestDigest: manifest.manifestDigest,
}, null, 2));
