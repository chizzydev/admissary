import {
  digestCanonicalJson,
} from "../qualification/canonical.js";

export type GuidanceCoverage =
  | "SUPPORTED"
  | "PARTIAL"
  | "NOT_COVERED";

export interface GuidanceSource {
  sourceId: string;
  title: string;
  publisher: string;
  url: string;
}

export interface GuidanceMapping {
  mappingId: string;
  sourceId: string;
  sourceSection: string;
  practice: string;
  coverage:
    GuidanceCoverage;
  proofRefs: string[];
  evidenceNote: string;
  gap: string | null;
}

export interface GuidanceMappingPack {
  schema:
    "admissary-guidance-mapping/v1";
  version: string;
  sources:
    GuidanceSource[];
  mappings:
    GuidanceMapping[];
  disclaimer: string;
  packDigest: string;
}

export class GuidanceMappingError
  extends Error {
  readonly code: string;

  constructor(
    code: string,
    message: string,
  ) {
    super(message);
    this.name =
      "GuidanceMappingError";
    this.code = code;
  }
}

const PROHIBITED_CLAIMS = [
  "compliant",
  "certified",
  "approved by",
  "certification",
];

export function buildAdmissaryGuidanceMapping():
  GuidanceMappingPack {
  const sources:
    GuidanceSource[] = [
      {
        sourceId:
          "ASD-OPEN-WEIGHT",
        title:
          "Open-weight AI models: Selecting, deploying and operating open-weight AI models securely",
        publisher:
          "Australian Signals Directorate / Australian Cyber Security Centre",
        url:
          "https://www.cyber.gov.au/publication/open-weight-ai-models-selecting-deploying-and-operating-open-weight-ai-models-securely",
      },
      {
        sourceId:
          "NIST-AI-RMF-GOVERN",
        title:
          "NIST AI RMF Playbook — Govern",
        publisher:
          "National Institute of Standards and Technology",
        url:
          "https://airc.nist.gov/airmf-resources/playbook/govern/",
      },
      {
        sourceId:
          "SLSA-PROVENANCE",
        title:
          "SLSA Provenance",
        publisher:
          "SLSA",
        url:
          "https://slsa.dev/spec/v1.2/provenance",
      },
    ];

  const mappings:
    GuidanceMapping[] = [
      {
        mappingId:
          "ASD-GOVERNANCE-REGISTER",
        sourceId:
          "ASD-OPEN-WEIGHT",
        sourceSection:
          "Governance",
        practice:
          "Maintain an approved-model register and technical inventory with use case, owner, deployed versions, artifacts and review information.",
        coverage:
          "SUPPORTED",
        proofRefs: [
          "R10C1:model-registry",
          "R10C3:scoped-approval",
        ],
        evidenceNote:
          "The registry models organizations, environments, workloads, candidates, artifact identities, deployment state, accountable owner and reassessment metadata.",
        gap: null,
      },
      {
        mappingId:
          "ASD-VERIFY-SOURCE",
        sourceId:
          "ASD-OPEN-WEIGHT",
        sourceSection:
          "Know and verify the source",
        practice:
          "Verify model source, provenance, lineage, license conditions and material modifications before adoption.",
        coverage:
          "PARTIAL",
        proofRefs: [
          "R2:hugging-face-evidence",
          "R3:serv-semantic-evidence",
          "R10C3:hf-watcher",
        ],
        evidenceNote:
          "Admissary captures immutable Hugging Face revisions, artifact/file evidence, remote-code indicators and bounded semantic license/lineage interpretation.",
        gap:
          "Hosted-provider model aliases may still lack exact runtime artifact binding; that limitation remains explicit.",
      },
      {
        mappingId:
          "ASD-VERIFY-SUITABILITY",
        sourceId:
          "ASD-OPEN-WEIGHT",
        sourceSection:
          "Verify suitability",
        practice:
          "Independently test the specific model version against intended operating conditions and defined requirements rather than relying on general benchmarks.",
        coverage:
          "SUPPORTED",
        proofRefs: [
          "R4:banking77-workload",
          "R5:dolphin-empirical-run",
          "R10C1:generic-workload-pack",
        ],
        evidenceNote:
          "Deployment contracts compile workload-specific mandatory thresholds; the canonical real Dolphin run can fail deployment despite strong aggregate quality.",
        gap: null,
      },
      {
        mappingId:
          "ASD-MAINTAIN-ASSURANCE",
        sourceId:
          "ASD-OPEN-WEIGHT",
        sourceSection:
          "Maintain assurance",
        practice:
          "Define material-change triggers and reassess models after changes to weights, adapters, software, safeguards, integrations, license or distribution arrangements.",
        coverage:
          "PARTIAL",
        proofRefs: [
          "R6:dependency-graph",
          "R10C3:continuous-assurance",
          "R10C3:reassessment",
        ],
        evidenceNote:
          "The watcher distinguishes real material change from monitoring error, invalidates affected proof branches, preserves history and requires fresh approval after reassessment.",
        gap: "Local change-source adapters and fail-closed reassessment are tested; production scheduling, external change-source coverage and operator ownership remain deployment responsibilities.",
      },
      {
        mappingId:
          "ASD-ROLLBACK-INCIDENT",
        sourceId:
          "ASD-OPEN-WEIGHT",
        sourceSection:
          "Model maintenance and updates / Monitoring, evaluation and incident response",
        practice:
          "Maintain rollback, replacement, evidence-preservation and incident-response procedures.",
        coverage:
          "PARTIAL",
        proofRefs: [
          "R7:persistence-history",
          "R10C3:revocation",
          "R10D:current-proof-rollback",
        ],
        evidenceNote:
          "Admissary preserves historical qualification/approval state and can revoke current deployment authority.",
        gap:
          "Current-proof rollback eligibility and audit preservation are tested in Case D; production rollback execution, external incident integration and retention policy remain operator responsibilities.",
      },
      {
        mappingId:
          "NIST-GOVERN-1.6-INVENTORY",
        sourceId:
          "NIST-AI-RMF-GOVERN",
        sourceSection:
          "GOVERN 1.6",
        practice:
          "Maintain an AI system inventory that can answer model-level and organization-level operational questions.",
        coverage:
          "SUPPORTED",
        proofRefs: [
          "R10C1:model-registry",
          "R10C4:operator-overview",
        ],
        evidenceNote:
          "The registry exposes model, environment, workload, exact artifact identity, qualification, authorization, validity, blockers and owner context.",
        gap: null,
      },
      {
        mappingId:
          "NIST-CHANGE-MANAGEMENT",
        sourceId:
          "NIST-AI-RMF-GOVERN",
        sourceSection:
          "Transparency and Documentation",
        practice:
          "Document deployment, monitoring and change-management plans and keep AI-system documentation current.",
        coverage:
          "PARTIAL",
        proofRefs: [
          "R6:content-addressed-graph",
          "R7:event-history",
          "R10C3:watch-history",
        ],
        evidenceNote:
          "Qualification inputs, evidence roots, authorization events, material-change checks and reassessment state are content-addressed or durably recorded.",
        gap: "Local evidence and change records do not establish a complete organizational change-management process or production monitoring operation.",
      },
      {
        mappingId:
          "SLSA-ATTESTATION-CONCEPT",
        sourceId:
          "SLSA-PROVENANCE",
        sourceSection:
          "Provenance / attestation concepts",
        practice:
          "Use verifiable provenance-style attestations that bind evidence to an artifact identity.",
        coverage:
          "PARTIAL",
        proofRefs: [
          "R10C2:ed25519-attestation",
          "R8:deployment-verifier",
        ],
        evidenceNote:
          "Admissary emits a signed in-toto-style qualification statement binding an exact deployment identity, manifest digest and evidence root.",
        gap:
          "The attestation is a qualification attestation, not SLSA build provenance, and there is no transparency log or Sigstore identity claim.",
      },
      {
        mappingId:
          "RUNTIME-BEHAVIOR-MONITORING",
        sourceId:
          "ASD-OPEN-WEIGHT",
        sourceSection:
          "Monitoring, evaluation and incident response",
        practice:
          "Continuously monitor runtime prompts, responses, abnormal use, exfiltration attempts and safeguard bypass behavior.",
        coverage:
          "NOT_COVERED",
        proofRefs: [],
        evidenceNote:
          "Admissary currently monitors deployment identity and qualification inputs rather than production inference telemetry.",
        gap:
          "Runtime behavioral telemetry and SOC alerting are outside the current product boundary.",
      },
    ];

  for (
    const mapping of mappings
  ) {
    if (
      mapping.coverage ===
        "SUPPORTED" &&
      mapping.proofRefs
        .length === 0
    ) {
      throw new GuidanceMappingError(
        "GUIDANCE_PROOF_REQUIRED",
        `SUPPORTED mapping ${mapping.mappingId} requires proof references`,
      );
    }

    if (
      mapping.coverage ===
        "NOT_COVERED" &&
      !mapping.gap
    ) {
      throw new GuidanceMappingError(
        "GUIDANCE_GAP_REQUIRED",
        `NOT_COVERED mapping ${mapping.mappingId} requires an explicit gap`,
      );
    }
  }

  const disclaimer =
    "This mapping explains which practices Admissary evidence can support. It is not a claim of regulatory compliance, certification, endorsement, or approval by any referenced organization.";

  const claimSurface =
    JSON.stringify({
      sources,
      mappings,
    }).toLowerCase();

  for (
    const prohibited of
    PROHIBITED_CLAIMS
  ) {
    if (
      claimSurface.includes(
        prohibited,
      )
    ) {
      throw new GuidanceMappingError(
        "GUIDANCE_COMPLIANCE_CLAIM_ERROR",
        `Mapping content contains prohibited claim language: ${prohibited}`,
      );
    }
  }

  const payload = {
    schema:
      "admissary-guidance-mapping/v1" as const,
    version:
      "1.0.0",
    sources,
    mappings,
    disclaimer,
  };

  return {
    ...payload,
    packDigest:
      digestCanonicalJson(
        payload,
      ),
  };
}
