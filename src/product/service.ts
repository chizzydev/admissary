import type { AssuranceDeploymentRecord, DeploymentAssuranceIdentity, WatchComparison } from "../assurance/types.js";
import { recordEventOrder } from "../persistence/event-order.js";
import { parseDeploymentVerificationContext } from "../verifier/verifier.js";
import type { CurrentDeploymentAdmissionResponse } from "./contracts.js";
import { verifySignedQualificationAttestation, verifyHistoricalAttestationProof } from "../attestations/qualification-attestation.js";
import { selectCandidates, type CandidateSelectionPolicy, type SelectionCandidate } from "../selection/candidate-selection.js";
import { deriveCompletion, type CompletionEvidenceResolver } from "./completion.js";
import { currentProofContext, productProofMatches, attestationMatchesProof, assuranceIdentityFor } from "./proof.js";
import {
  digestCanonicalJson,
} from "../qualification/canonical.js";
import type {
  QualificationState,
} from "../qualification/types.js";
import type {
  ContinuousAssuranceService,
} from "../assurance/service.js";
import type {
  AssuranceDecision,
} from "../assurance/types.js";
import type {
  SignedQualificationAttestation,
} from "../attestations/qualification-attestation.js";
import type {
  ProductApplicationState,
  ProductAttestationRecord,
  ProductCandidateRecord,
  ProductContractRecord,
  ProductDeploymentRecord,
  ProductEvent,
  ProductQualificationRunRecord,
  ProductRepository,
} from "./state.js";
import {
  buildDeploymentAudit,
  rollbackTargetFromState,
} from "./audit.js";
import type {
  ProductDeploymentAudit,
  ProductRollbackTarget,
} from "./audit.js";
import {
  ProductStateError,
} from "./state.js";

function canonicalIso(
  value: string,
  label: string,
): string {
  const date = new Date(value);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString() !== value
  ) {
    throw new ProductStateError(
      "PRODUCT_INVALID_TIMESTAMP",
      `${label} must be canonical ISO-8601`,
    );
  }
  return value;
}

function nonEmpty(
  value: string,
  label: string,
): string {
  if (!value.trim()) {
    throw new ProductStateError(
      "PRODUCT_VALIDATION_ERROR",
      `${label} must be non-empty`,
    );
  }
  return value;
}

function eventId(
  type: ProductEvent["type"],
  actorId: string,
  subjectId: string,
  occurredAt: string,
  detail: string,
): string {
  return `${type.toLowerCase()}-${digestCanonicalJson({
    actorId,
    subjectId,
    occurredAt,
    detail,
  }).slice(0, 24)}`;
}

function pushEvent(
  state: ProductApplicationState,
  input: {
    type: ProductEvent["type"];
    actorId: string;
    subjectId: string;
    occurredAt: string;
    detail: string;
  },
): void {
  state.events.push({
    ...recordEventOrder(state.events),
    eventId: eventId(
      input.type,
      input.actorId,
      input.subjectId,
      input.occurredAt,
      input.detail,
    ),
    occurredAt: input.occurredAt,
    actorId: input.actorId,
    type: input.type,
    subjectId: input.subjectId,
    detail: input.detail,
  });
}

function candidateById(
  state: ProductApplicationState,
  candidateId: string,
): ProductCandidateRecord {
  const candidate = state.candidates.find(
    (item) => item.candidateId === candidateId,
  );
  if (!candidate) {
    throw new ProductStateError(
      "PRODUCT_CANDIDATE_NOT_FOUND",
      `Candidate not found: ${candidateId}`,
    );
  }
  return candidate;
}

function contractByKey(
  state: ProductApplicationState,
  contractId: string,
  version: string,
): ProductContractRecord {
  const contract = state.contracts.find(
    (item) =>
      item.contractId === contractId &&
      item.version === version,
  );
  if (!contract) {
    throw new ProductStateError(
      "PRODUCT_CONTRACT_NOT_FOUND",
      `Contract not found: ${contractId}@${version}`,
    );
  }
  return contract;
}

function runById(
  state: ProductApplicationState,
  runId: string,
): ProductQualificationRunRecord {
  const run = state.qualificationRuns.find(
    (item) => item.runId === runId,
  );
  if (!run) {
    throw new ProductStateError(
      "PRODUCT_QUALIFICATION_NOT_FOUND",
      `Qualification run not found: ${runId}`,
    );
  }
  return run;
}

function deploymentById(
  state: ProductApplicationState,
  deploymentId: string,
): ProductDeploymentRecord {
  const deployment = state.deployments.find(
    (item) => item.deploymentId === deploymentId,
  );
  if (!deployment) {
    throw new ProductStateError(
      "PRODUCT_DEPLOYMENT_NOT_FOUND",
      `Deployment not found: ${deploymentId}`,
    );
  }
  return deployment;
}

function sameCandidate(
  left: ProductCandidateRecord,
  right: Omit<ProductCandidateRecord, "registeredAt"> & {
    registeredAt: string;
  },
): boolean {
  return digestCanonicalJson({
    candidateId: left.candidateId,
    displayName: left.displayName,
    provider: left.provider,
    repositoryOrModelId: left.repositoryOrModelId,
    revision: left.revision,
    tokenizerRevision: left.tokenizerRevision,
    artifactManifestDigest: left.artifactManifestDigest,
  }) === digestCanonicalJson({
    candidateId: right.candidateId,
    displayName: right.displayName,
    provider: right.provider,
    repositoryOrModelId: right.repositoryOrModelId,
    revision: right.revision,
    tokenizerRevision: right.tokenizerRevision,
    artifactManifestDigest: right.artifactManifestDigest,
  });
}

function sameContract(
  left: ProductContractRecord,
  right: Omit<ProductContractRecord, "updatedAt"> & {
    updatedAt: string;
  },
): boolean {
  return digestCanonicalJson({
    contractId: left.contractId,
    version: left.version,
    digest: left.digest,
    workloadId: left.workloadId,
    environmentId: left.environmentId,
  }) === digestCanonicalJson({
    contractId: right.contractId,
    version: right.version,
    digest: right.digest,
    workloadId: right.workloadId,
    environmentId: right.environmentId,
  });
}

export interface ProductDeploymentView {
  deployment: ProductDeploymentRecord;
  decision: AssuranceDecision;
  validity: "CURRENT" | "STALE";
}

export class ProductApplicationService {
  constructor(
    private readonly repository: ProductRepository,
    private readonly assurance: ContinuousAssuranceService,
    private readonly completionEvidenceResolver?: CompletionEvidenceResolver,
    private readonly trustStore: Readonly<Record<string,string>> = {},
  ) { this.assurance.onCurrentProofChanged(async () => { await this.currentState(); }); }

  async registerCandidate(
    input: {
      candidateId: string;
      displayName: string;
      provider: string;
      repositoryOrModelId: string;
      revision: string | null;
      tokenizerRevision: string | null;
      artifactManifestDigest: string | null;
      actorId: string;
      occurredAt: string;
    },
  ): Promise<{ candidate: ProductCandidateRecord; created: boolean }> {
    canonicalIso(input.occurredAt, "occurredAt");
    nonEmpty(input.candidateId, "candidateId");
    nonEmpty(input.displayName, "displayName");
    nonEmpty(input.provider, "provider");
    nonEmpty(input.repositoryOrModelId, "repositoryOrModelId");

    return this.repository.transact((state) => {
      const candidate: ProductCandidateRecord = {
        candidateId: input.candidateId,
        displayName: input.displayName,
        provider: input.provider,
        repositoryOrModelId: input.repositoryOrModelId,
        revision: input.revision,
        tokenizerRevision: input.tokenizerRevision,
        artifactManifestDigest: input.artifactManifestDigest,
        registeredBy: input.actorId,
        registeredAt: input.occurredAt,
      };

      const existing = state.candidates.find(
        (item) => item.candidateId === input.candidateId,
      );

      if (existing) {
        if (!sameCandidate(existing, candidate)) {
          throw new ProductStateError(
            "PRODUCT_CANDIDATE_CONFLICT",
            `Candidate ID already exists with different identity: ${input.candidateId}`,
          );
        }
        return {
          candidate: structuredClone(existing),
          created: false,
        };
      }

      state.candidates.push(candidate);
      pushEvent(state, {
        type: "CANDIDATE_REGISTERED",
        actorId: input.actorId,
        subjectId: input.candidateId,
        occurredAt: input.occurredAt,
        detail: `provider=${input.provider}; source=${input.repositoryOrModelId}`,
      });

      return {
        candidate: structuredClone(candidate),
        created: true,
      };
    });
  }

  async registerContract(
    input: {
      contractId: string;
      version: string;
      digest: string;
      workloadId: string;
      environmentId: string;
      actorId: string;
      occurredAt: string;
    },
  ): Promise<{ contract: ProductContractRecord; created: boolean }> {
    canonicalIso(input.occurredAt, "occurredAt");
    for (const [label, value] of Object.entries({
      contractId: input.contractId,
      version: input.version,
      digest: input.digest,
      workloadId: input.workloadId,
      environmentId: input.environmentId,
    })) {
      nonEmpty(value, label);
    }

    return this.repository.transact((state) => {
      const contract: ProductContractRecord = {
        contractId: input.contractId,
        version: input.version,
        digest: input.digest,
        workloadId: input.workloadId,
        environmentId: input.environmentId,
        registeredBy: input.actorId,
        registeredAt: input.occurredAt,
        updatedAt: input.occurredAt,
      };

      const existing = state.contracts.find(
        (item) =>
          item.contractId === input.contractId &&
          item.version === input.version,
      );

      if (existing) {
        if (!sameContract(existing, contract)) {
          throw new ProductStateError(
            "PRODUCT_CONTRACT_CONFLICT",
            `Contract version already exists with different content: ${input.contractId}@${input.version}`,
          );
        }
        return {
          contract: structuredClone(existing),
          created: false,
        };
      }

      state.contracts.push(contract);
      pushEvent(state, {
        type: "CONTRACT_REGISTERED",
        actorId: input.actorId,
        subjectId: `${input.contractId}@${input.version}`,
        occurredAt: input.occurredAt,
        detail: `digest=${input.digest}; workload=${input.workloadId}; environment=${input.environmentId}`,
      });

      return {
        contract: structuredClone(contract),
        created: true,
      };
    });
  }

  async startQualification(
    input: {
      candidateId: string;
      contractId: string;
      contractVersion: string;
      actorId: string;
      requestedAt: string;
      reason: string;
      replacesDeploymentId?: string | null;
    },
  ): Promise<ProductQualificationRunRecord> {
    canonicalIso(input.requestedAt, "requestedAt");
    nonEmpty(input.reason, "reason");

    return this.repository.transact((state) => {
      candidateById(state, input.candidateId);
      const contract = contractByKey(
        state,
        input.contractId,
        input.contractVersion,
      );

      if (input.replacesDeploymentId) {
        deploymentById(state, input.replacesDeploymentId);
      }

      const runId = `qualification-${digestCanonicalJson({
        candidateId: input.candidateId,
        contractId: input.contractId,
        contractVersion: input.contractVersion,
        actorId: input.actorId,
        requestedAt: input.requestedAt,
        replacesDeploymentId: input.replacesDeploymentId ?? null,
      }).slice(0, 24)}`;

      const existing = state.qualificationRuns.find(
        (item) => item.runId === runId,
      );
      if (existing) return structuredClone(existing);

      const requestPayload = {
        candidateId: input.candidateId,
        contractId: input.contractId,
        contractVersion: input.contractVersion,
        environmentId: contract.environmentId,
        workloadId: contract.workloadId,
        reason: input.reason,
        replacesDeploymentId: input.replacesDeploymentId ?? null,
      };

      const run: ProductQualificationRunRecord = {
        runId,
        candidateId: input.candidateId,
        contractId: input.contractId,
        contractVersion: input.contractVersion,
        environmentId: contract.environmentId,
        workloadId: contract.workloadId,
        status: "REQUESTED",
        qualificationState: null,
        blockers: [],
        exactArtifactBindingProven: false,
        evidenceGraphRootDigest: null,
        policyVersion: null,
        policyDigest: null,
        evaluationSuite: null,
        evaluationDigest: null,
        sourceRefs: [],
        requestedBy: input.actorId,
        requestedAt: input.requestedAt,
        completedBy: null,
        completedAt: null,
        replacesDeploymentId: input.replacesDeploymentId ?? null,
        reason: input.reason,
        requestDigest: digestCanonicalJson(requestPayload),
      };

      state.qualificationRuns.push(run);
      pushEvent(state, {
        type: input.replacesDeploymentId
          ? "REQUALIFICATION_REQUESTED"
          : "QUALIFICATION_REQUESTED",
        actorId: input.actorId,
        subjectId: runId,
        occurredAt: input.requestedAt,
        detail: `candidate=${input.candidateId}; contract=${input.contractId}@${input.contractVersion}; execution=REQUESTED_NOT_RUN`,
      });

      return structuredClone(run);
    });
  }

  private async currentState(): Promise<ProductApplicationState> {
    const assurance = await this.assurance.state();
    await this.repository.transact(state => {
      for (const d of state.deployments) {
        const a = assurance.deployments.find(x => x.deploymentId === d.assuranceDeploymentId);
        if (!a || a.qualificationRunId === d.qualificationRunId) continue;
        const r = state.qualificationRuns.find(x => x.runId === a.qualificationRunId);
        if (!r) continue;
        const next = { ...d, qualificationRunId: r.runId, candidateId: r.candidateId,
          contractId: r.contractId, contractVersion: r.contractVersion, attestationId: null };
        if (!productProofMatches(state, next, a)) continue;
        Object.assign(d, next, { updatedAt: a.updatedAt });
        pushEvent(state, { type: "REASSESSMENT_COMPLETED", actorId: "SYSTEM_RECONCILIATION", subjectId: d.deploymentId, occurredAt: a.updatedAt,
          detail: `qualification=${r.runId}; obsoleteAttestationDetached=true; approvalNotInherited=true` });
      }
    });
    return this.repository.read();
  }

  async currentOperationalScope(deploymentId: string) {
    const state = await this.currentState();
    const d = deploymentById(state, deploymentId);
    const r = runById(state, d.qualificationRunId);
    return { deploymentId: d.deploymentId, qualificationRunId: r.runId, environmentId: r.environmentId, workloadId: r.workloadId };
  }

  async contextMatchesCurrent(deploymentId: string, context: unknown): Promise<boolean> {
    const state = await this.currentState();
    const d = deploymentById(state, deploymentId);
    const a = (await this.assurance.state()).deployments.find(x => x.deploymentId === d.assuranceDeploymentId);
    return !!a && productProofMatches(state, d, a) &&
      digestCanonicalJson(context) === digestCanonicalJson(currentProofContext(a));
  }

  async completeQualification(
    input: {
      runId: string;
      qualificationState: QualificationState;
      blockers: string[];
      exactArtifactBindingProven: boolean;
      evidenceGraphRootDigest: string;
      policyVersion: string | null;
      policyDigest: string | null;
      evaluationSuite: string | null;
      evaluationDigest: string | null;
      sourceRefs: string[];
      actorId: string;
      completedAt: string;
    },
  ): Promise<ProductQualificationRunRecord> {
    canonicalIso(input.completedAt, "completedAt");
    nonEmpty(input.evidenceGraphRootDigest, "evidenceGraphRootDigest");

    if (input.sourceRefs.length === 0) {
      throw new ProductStateError(
        "PRODUCT_QUALIFICATION_EVIDENCE_REQUIRED",
        "Qualification completion requires at least one evidence source reference",
      );
    }

    if (
      input.qualificationState === "QUALIFIED" &&
      input.blockers.length > 0
    ) {
      throw new ProductStateError(
        "PRODUCT_QUALIFICATION_CONTRADICTION",
        "QUALIFIED completion cannot carry blockers",
      );
    }

    if (!this.completionEvidenceResolver) throw new ProductStateError("PRODUCT_TRUSTED_EVIDENCE_REQUIRED", "Qualification completion requires registered content-addressed evidence");
    const before = await this.currentState();
    const requested = runById(before, input.runId);
    const registeredCandidate = candidateById(before, requested.candidateId);
    const registeredContract = contractByKey(before, requested.contractId, requested.contractVersion);
    const evidence = await this.completionEvidenceResolver(requested, registeredCandidate, registeredContract);
    const derived = deriveCompletion(evidence, registeredCandidate, registeredContract);
    if (input.qualificationState !== derived.state || input.exactArtifactBindingProven !== evidence.exactArtifactBindingProven ||
        input.evidenceGraphRootDigest !== evidence.graph.rootDigest || input.policyVersion !== evidence.policy.version ||
        input.policyDigest !== evidence.policy.digest || input.evaluationSuite !== evidence.evaluation.suite ||
        input.evaluationDigest !== evidence.evaluation.digest ||
        digestCanonicalJson([...input.sourceRefs].sort()) !== digestCanonicalJson([...evidence.sourceRefs].sort())) {
      throw new ProductStateError("PRODUCT_COMPLETION_EVIDENCE_MISMATCH", "Asserted completion differs from validated evidence");
    }
    return this.repository.transact((state) => {
      const run = runById(state, input.runId);
      const candidate = candidateById(state, run.candidateId);

      if (
        new Date(input.completedAt).getTime() <
        new Date(run.requestedAt).getTime()
      ) {
        throw new ProductStateError(
          "PRODUCT_QUALIFICATION_TIME_ERROR",
          "Qualification completion cannot predate its request",
        );
      }

      if (
        input.exactArtifactBindingProven &&
        (
          !candidate.revision ||
          !candidate.tokenizerRevision ||
          !candidate.artifactManifestDigest
        )
      ) {
        throw new ProductStateError(
          "PRODUCT_EXACT_BINDING_IDENTITY_INCOMPLETE",
          "Exact binding cannot be asserted without exact candidate revision, tokenizer revision and artifact manifest digest",
        );
      }

      if (
        input.qualificationState === "QUALIFIED" &&
        (
          !input.policyVersion ||
          !input.policyDigest ||
          !input.evaluationSuite ||
          !input.evaluationDigest
        )
      ) {
        throw new ProductStateError(
          "PRODUCT_QUALIFICATION_SCOPE_INCOMPLETE",
          "QUALIFIED completion must bind policy version/digest and evaluation suite/digest",
        );
      }

      if (
        input.qualificationState !== "QUALIFIED" &&
        input.blockers.length === 0
      ) {
        throw new ProductStateError(
          "PRODUCT_BLOCKERS_REQUIRED",
          "Non-qualified completion must preserve at least one blocker or unresolved reason",
        );
      }

      if (run.status !== "REQUESTED") {
        throw new ProductStateError(
          "PRODUCT_QUALIFICATION_ALREADY_FINAL",
          `Qualification run is already ${run.status}`,
        );
      }

      run.completionEvidence = structuredClone(evidence);
      run.status = "COMPLETED";
      run.qualificationState = derived.state;
      run.blockers = [...new Set([...derived.decisiveObligations, ...(!evidence.exactArtifactBindingProven ? ["EXACT_ARTIFACT_BINDING_UNPROVEN"] : [])])].sort();
      run.exactArtifactBindingProven = input.exactArtifactBindingProven;
      run.evidenceGraphRootDigest = input.evidenceGraphRootDigest;
      run.policyVersion = input.policyVersion;
      run.policyDigest = input.policyDigest;
      run.evaluationSuite = input.evaluationSuite;
      run.evaluationDigest = input.evaluationDigest;
      run.sourceRefs = [...new Set(input.sourceRefs)].sort();
      run.completedBy = input.actorId;
      run.completedAt = input.completedAt;

      pushEvent(state, {
        type: "QUALIFICATION_COMPLETED",
        actorId: input.actorId,
        subjectId: input.runId,
        occurredAt: input.completedAt,
        detail: `state=${input.qualificationState}; exactBinding=${input.exactArtifactBindingProven}; evidence=${input.evidenceGraphRootDigest}`,
      });

      return structuredClone(run);
    });
  }

  async createDeployment(input: { deploymentId: string; runId: string; actorId: string; createdAt: string; maxEvidenceAgeMs: number }): Promise<ProductDeploymentRecord> {
    canonicalIso(input.createdAt, "createdAt"); nonEmpty(input.deploymentId, "deploymentId");
    if (typeof input.maxEvidenceAgeMs !== "number" || !Number.isFinite(input.maxEvidenceAgeMs) || input.maxEvidenceAgeMs <= 0) {
      throw new ProductStateError("PRODUCT_MONITORING_POLICY_ERROR", "maxEvidenceAgeMs must be positive and finite");
    }
    const requestDigest = digestCanonicalJson({ deploymentId: input.deploymentId, runId: input.runId, createdAt: input.createdAt, maxEvidenceAgeMs: input.maxEvidenceAgeMs });
    let desired!: AssuranceDeploymentRecord;
    await this.repository.transact(state => {
      const run = runById(state, input.runId);
      if (run.status !== "COMPLETED" || !run.qualificationState || !run.evidenceGraphRootDigest) throw new ProductStateError("PRODUCT_COMPLETED_QUALIFICATION_REQUIRED", "Deployment creation requires a completed qualification run");
      const candidate = candidateById(state, run.candidateId), contract = contractByKey(state, run.contractId, run.contractVersion);
      desired = { deploymentId: input.deploymentId, qualificationRunId: run.runId, qualificationState: run.qualificationState,
        exactArtifactBindingProven: run.exactArtifactBindingProven, identity: assuranceIdentityFor(candidate, contract, run),
        lifecycleState: "CURRENT", activeApprovalId: null, monitoringStatus: "HEALTHY",
        monitoringPolicy: { maxEvidenceAgeMs: input.maxEvidenceAgeMs, failClosedWhenOverdue: true },
        lastSuccessfulCheckAt: input.createdAt, lastCheckAt: input.createdAt, latestInvalidatedNodes: [], createdAt: input.createdAt, updatedAt: input.createdAt };
      const existing = state.deployments.find(d => d.deploymentId === input.deploymentId);
      if (existing) {
        if (existing.qualificationRunId !== run.runId || existing.candidateId !== run.candidateId || existing.contractId !== run.contractId ||
            existing.contractVersion !== run.contractVersion || existing.assuranceDeploymentId !== input.deploymentId || existing.createdAt !== input.createdAt ||
            existing.provisioningRequestDigest && existing.provisioningRequestDigest !== requestDigest) {
          throw new ProductStateError("PRODUCT_DEPLOYMENT_CONFLICT", "Provisioning retry differs from the durable deployment request");
        }
        return;
      }
      state.deployments.push({ deploymentId: input.deploymentId, candidateId: run.candidateId, contractId: run.contractId, contractVersion: run.contractVersion,
        qualificationRunId: run.runId, assuranceDeploymentId: input.deploymentId, status: "PROVISIONING", provisioningRequestDigest: requestDigest,
        createdBy: input.actorId, createdAt: input.createdAt, updatedAt: input.createdAt, provisioningError: null, attestationId: null });
      pushEvent(state, { type: "DEPLOYMENT_PROVISIONING", actorId: input.actorId, subjectId: input.deploymentId, occurredAt: input.createdAt, detail: `qualification=${run.runId}` });
    });
    try {
      const existing = (await this.assurance.state()).deployments.find(a => a.deploymentId === input.deploymentId);
      if (!existing) await this.assurance.registerDeployment({ deployment: desired, occurredAt: input.createdAt });
      else {
        const product = await this.repository.read(), d = deploymentById(product, input.deploymentId);
        if (!productProofMatches(product, d, existing) || existing.createdAt !== desired.createdAt ||
            digestCanonicalJson(existing.monitoringPolicy) !== digestCanonicalJson(desired.monitoringPolicy)) {
          throw new ProductStateError("PRODUCT_PROVISIONING_IDENTITY_CONFLICT", "Existing assurance deployment differs; retry must never reset its authority");
        }
      }
    } catch (error) {
      await this.repository.transact(state => {
        const d = deploymentById(state, input.deploymentId);
        if (d.status === "ACTIVE") return;
        d.status = "ERROR"; d.provisioningError = error instanceof Error ? error.message : String(error);
        pushEvent(state, { type: "DEPLOYMENT_ERROR", actorId: input.actorId, subjectId: d.deploymentId, occurredAt: input.createdAt, detail: d.provisioningError });
      });
      throw error;
    }
    return this.repository.transact(state => {
      const d = deploymentById(state, input.deploymentId);
      if (d.status === "ACTIVE") return structuredClone(d);
      d.status = "ACTIVE"; d.provisioningRequestDigest = requestDigest; d.provisioningError = null; d.updatedAt = input.createdAt;
      pushEvent(state, { type: "DEPLOYMENT_ACTIVE", actorId: input.actorId, subjectId: d.deploymentId, occurredAt: input.createdAt, detail: `qualification=${d.qualificationRunId}; reconciledMatchingProvisioning=true` });
      return structuredClone(d);
    });
  }

  async approveDeployment(
    input: {
      deploymentId: string;
      actorId: string;
      issuedAt: string;
      expiresAt: string | null;
      reason: string;
    },
  ) {
    const state = await this.currentState();
    const deployment = deploymentById(state, input.deploymentId);
    if (deployment.status !== "ACTIVE") {
      throw new ProductStateError(
        "PRODUCT_ACTIVE_DEPLOYMENT_REQUIRED",
        `Deployment status is ${deployment.status}`,
      );
    }
    return this.assurance.approve(input);
  }

  async revokeDeployment(
    input: {
      deploymentId: string;
      actorId: string;
      occurredAt: string;
      reason: string;
    },
  ) {
    const state = await this.currentState();
    const deployment = deploymentById(state, input.deploymentId);
    if (deployment.status !== "ACTIVE") {
      throw new ProductStateError(
        "PRODUCT_ACTIVE_DEPLOYMENT_REQUIRED",
        `Deployment status is ${deployment.status}`,
      );
    }
    return this.assurance.revokeApproval(input);
  }

  async recordMaterialChange(input: { deploymentId:string; checkedAt:string; comparison:WatchComparison; nextIdentity:DeploymentAssuranceIdentity; reason:string; actorId:string }) {
    const state=await this.currentState(), d=deploymentById(state,input.deploymentId);
    const k=contractByKey(state,input.nextIdentity.contractId,input.nextIdentity.contractVersion);
    if (k.digest!==input.nextIdentity.contractDigest || k.environmentId!==input.nextIdentity.environmentId || k.workloadId!==input.nextIdentity.workloadId) throw new ProductStateError("PRODUCT_REASSESSMENT_SCOPE_MISMATCH","Observed replacement must bind a registered contract/environment/workload");
    const result=await this.assurance.recordMaterialChange(input);
    await this.repository.transact(s=>{
      const target=deploymentById(s,d.deploymentId);target.attestationId=null;
      pushEvent(s,{type:"MATERIAL_CHANGE_RECORDED",actorId:input.actorId,subjectId:d.deploymentId,occurredAt:input.checkedAt,detail:`reassessment=${result.reassessment.requestId}; oldProofHistoryPreserved=true`});
    });
    return result;
  }

  async requestRequalification(input: { deploymentId:string; actorId:string; requestedAt:string; reason:string; candidateId?:string }): Promise<ProductQualificationRunRecord> {
    canonicalIso(input.requestedAt,"requestedAt");
    const state=await this.currentState(), d=deploymentById(state,input.deploymentId);
    const observed=(await this.assurance.state()).deployments.find(a=>a.deploymentId===d.assuranceDeploymentId);
    if (!observed) throw new ProductStateError("PRODUCT_ASSURANCE_NOT_FOUND","Deployment assurance record is missing");
    const k=contractByKey(state,observed.identity.contractId,observed.identity.contractVersion);
    const matches=(c:ProductCandidateRecord)=>(c.repositoryOrModelId===observed.identity.candidateRepository && (c.revision??`UNPROVEN:${c.repositoryOrModelId}`)===observed.identity.candidateRevision && (c.tokenizerRevision??"UNPROVEN")===observed.identity.tokenizerRevision && (c.artifactManifestDigest??"UNPROVEN")===observed.identity.artifactManifestDigest);
    const c=input.candidateId?candidateById(state,input.candidateId):state.candidates.find(matches);
    if (!c || !matches(c) || k.digest!==observed.identity.contractDigest || k.environmentId!==observed.identity.environmentId || k.workloadId!==observed.identity.workloadId) throw new ProductStateError("PRODUCT_REPLACEMENT_CANDIDATE_REQUIRED","Register/select the exact observed replacement candidate and scope");
    await this.assurance.requestReassessment({deploymentId:d.assuranceDeploymentId,requestedAt:input.requestedAt,reason:input.reason});
    const run=await this.startQualification({candidateId:c.candidateId,contractId:k.contractId,contractVersion:k.version,actorId:input.actorId,requestedAt:input.requestedAt,reason:input.reason,replacesDeploymentId:d.deploymentId});
    await this.repository.transact(s=>{deploymentById(s,d.deploymentId).attestationId=null;});
    return run;
  }

  async completeReassessment(input: { deploymentId:string; requestId:string; replacementQualificationRunId:string; actorId:string; completedAt:string }) {
    canonicalIso(input.completedAt,"completedAt");
    const state=await this.currentState(), d=deploymentById(state,input.deploymentId);
    const assurance=await this.assurance.state(), a=assurance.deployments.find(a=>a.deploymentId===d.assuranceDeploymentId);
    const pending=assurance.reassessments.find(r=>r.requestId===input.requestId && r.deploymentId===d.assuranceDeploymentId);
    if (!a || !pending) throw new ProductStateError("PRODUCT_REASSESSMENT_NOT_FOUND","A matching deployment reassessment is required");
    if (pending.status==="COMPLETED") {
      if (pending.replacementQualificationRunId!==input.replacementQualificationRunId || d.qualificationRunId!==input.replacementQualificationRunId || !productProofMatches(state,d,a)) throw new ProductStateError("PRODUCT_REASSESSMENT_CONFLICT","Completed reassessment is bound to a different proof");
      return this.deployment(d.deploymentId,input.completedAt);
    }
    const r=runById(state,input.replacementQualificationRunId), c=candidateById(state,r.candidateId), k=contractByKey(state,r.contractId,r.contractVersion);
    if (r.status!=="COMPLETED" || !r.qualificationState || !r.completionEvidence || r.replacesDeploymentId!==d.deploymentId || pending.previousQualificationRunId!==d.qualificationRunId ||
        Date.parse(r.completedAt!)<Date.parse(pending.requestedAt) || Date.parse(input.completedAt)<Date.parse(r.completedAt!)) throw new ProductStateError("PRODUCT_REASSESSMENT_REPLACEMENT_INVALID","A completed, bound replacement qualification after the request is required");
    deriveCompletion(r.completionEvidence,c,k);
    const projected=assuranceIdentityFor(c,k,r), {evidenceGraphRootDigest:ignored,...observed}=a.identity, {evidenceGraphRootDigest:nextRoot,...replacement}=projected;
    if (digestCanonicalJson(observed)!==digestCanonicalJson(replacement)) throw new ProductStateError("PRODUCT_REASSESSMENT_SCOPE_MISMATCH","Replacement differs from the observed intended proof identity");
    await this.assurance.completeReassessment({deploymentId:d.assuranceDeploymentId,requestId:pending.requestId,replacementQualificationRunId:r.runId,
      qualificationState:r.qualificationState,exactArtifactBindingProven:r.exactArtifactBindingProven,evidenceGraphRootDigest:nextRoot,
      completedAt:input.completedAt,expectedIdentityDigest:digestCanonicalJson(a.identity)});
    return this.deployment(d.deploymentId,input.completedAt);
  }

  async recordAttestation(
    input: {
      deploymentId: string;
      attestation: SignedQualificationAttestation;
      actorId: string;
      recordedAt: string;
    },
  ): Promise<ProductAttestationRecord> {
    canonicalIso(input.recordedAt, "recordedAt");
    if (!verifySignedQualificationAttestation(input.attestation, this.trustStore).valid) throw new ProductStateError("PRODUCT_ATTESTATION_INVALID", "Attestation signature/schema is invalid or untrusted");

    const currentState = await this.currentState();
    const currentDeployment = deploymentById(currentState, input.deploymentId);
    const currentRun = runById(currentState, currentDeployment.qualificationRunId);
    const currentCandidate = candidateById(currentState, currentDeployment.candidateId);
    const currentContract = contractByKey(
      currentState,
      currentDeployment.contractId,
      currentDeployment.contractVersion,
    );
    const manifest = input.attestation.statement.predicate.manifest;

    const bindingMismatches: string[] = [];
    const a = (await this.assurance.state()).deployments.find(x => x.deploymentId === currentDeployment.assuranceDeploymentId);
    if (!a || !productProofMatches(currentState, currentDeployment, a) ||
        !attestationMatchesProof({ deploymentId: input.deploymentId, attestation: input.attestation } as ProductAttestationRecord, a)) bindingMismatches.push("CURRENT_OPERATIONAL_PROOF");
    if (manifest.candidate.repository !== currentCandidate.repositoryOrModelId) bindingMismatches.push("CANDIDATE_REPOSITORY");
    if (manifest.candidate.revision !== currentCandidate.revision) bindingMismatches.push("CANDIDATE_REVISION");
    if (manifest.candidate.tokenizerRevision !== currentCandidate.tokenizerRevision) bindingMismatches.push("TOKENIZER_REVISION");
    if (manifest.candidate.artifactManifestDigest !== currentCandidate.artifactManifestDigest) bindingMismatches.push("ARTIFACT_MANIFEST");
    if (manifest.contract.id !== currentContract.contractId) bindingMismatches.push("CONTRACT_ID");
    if (manifest.contract.version !== currentContract.version) bindingMismatches.push("CONTRACT_VERSION");
    if (manifest.contract.digest !== currentContract.digest) bindingMismatches.push("CONTRACT_DIGEST");
    if (manifest.evidenceGraph.rootDigest !== currentRun.evidenceGraphRootDigest) bindingMismatches.push("EVIDENCE_GRAPH_ROOT");
    if (currentRun.policyVersion !== null && manifest.policyPack.version !== currentRun.policyVersion) bindingMismatches.push("POLICY_VERSION");
    if (currentRun.policyDigest !== null && manifest.policyPack.digest !== currentRun.policyDigest) bindingMismatches.push("POLICY_DIGEST");
    if (currentRun.evaluationSuite !== null && manifest.evaluation.suite !== currentRun.evaluationSuite) bindingMismatches.push("EVALUATION_SUITE");
    if (currentRun.evaluationDigest !== null && manifest.evaluation.digest !== currentRun.evaluationDigest) bindingMismatches.push("EVALUATION_DIGEST");
    if (manifest.qualification.state !== currentRun.qualificationState) bindingMismatches.push("QUALIFICATION_STATE");
    if (!currentRun.exactArtifactBindingProven) bindingMismatches.push("EXACT_ARTIFACT_BINDING");

    const decision = await this.assurance.decision(
      currentDeployment.assuranceDeploymentId,
      input.recordedAt,
    );
    if (!decision.allowed) bindingMismatches.push("DEPLOYMENT_NOT_CURRENTLY_ALLOWED");

    if (bindingMismatches.length > 0) {
      throw new ProductStateError(
        "PRODUCT_ATTESTATION_DEPLOYMENT_MISMATCH",
        `Attestation does not bind to current deployment: ${bindingMismatches.join(",")}`,
      );
    }

    return this.repository.transact((state) => {
      const deployment = deploymentById(state, input.deploymentId);
      const attestationId = `attestation-${input.attestation.envelopeDigest.slice(0, 24)}`;
      const existing = state.attestations.find(
        (item) => item.attestationId === attestationId,
      );

      if (existing) {
        if (existing.deploymentId !== input.deploymentId) {
          throw new ProductStateError(
            "PRODUCT_ATTESTATION_CONFLICT",
            "Attestation digest is already attached to another deployment",
          );
        }
        return structuredClone(existing);
      }

      const record: ProductAttestationRecord = {
        attestationId,
        deploymentId: input.deploymentId,
        attestation: structuredClone(input.attestation),
        attestationDigest: input.attestation.envelopeDigest,
        recordedBy: input.actorId,
        recordedAt: input.recordedAt,
      };
      state.attestations.push(record);
      deployment.attestationId = attestationId;
      deployment.updatedAt = input.recordedAt;
      pushEvent(state, {
        type: "ATTESTATION_RECORDED",
        actorId: input.actorId,
        subjectId: input.deploymentId,
        occurredAt: input.recordedAt,
        detail: `attestation=${attestationId}`,
      });
      return structuredClone(record);
    });
  }

  /** The single current-authority decision used by HTTP and deployment CI. */
  async admitCurrentDeployment(deploymentId: string, rawContext: unknown, now = new Date().toISOString()): Promise<CurrentDeploymentAdmissionResponse> {
    canonicalIso(now, "now");
    const context = parseDeploymentVerificationContext(rawContext);
    const product = await this.currentState();
    const deployment = deploymentById(product, deploymentId);
    const assurance = await this.assurance.state();
    const current = assurance.deployments.find(x => x.deploymentId === deployment.assuranceDeploymentId);
    if (!current) throw new ProductStateError("PRODUCT_ASSURANCE_NOT_FOUND", "Current assurance record is missing");
    const eligibility = await this.assurance.decision(current.deploymentId, now);
    const reasons = [...eligibility.reasons];
    if (deployment.status !== "ACTIVE") reasons.push(`DEPLOYMENT_${deployment.status}`);
    if (!productProofMatches(product, deployment, current)) reasons.push("CURRENT_PROOF_IDENTITY_MISMATCH");
    if (digestCanonicalJson(context) !== digestCanonicalJson(currentProofContext(current))) reasons.push("CURRENT_CONTEXT_MISMATCH");
    const record = product.attestations.find(x => x.attestationId === deployment.attestationId);
    let cryptographic = null;
    if (!record) reasons.push("ATTESTATION_NOT_RECORDED");
    else {
      if (!attestationMatchesProof(record, current)) reasons.push("ATTESTATION_CURRENT_PROOF_MISMATCH");
      cryptographic = verifyHistoricalAttestationProof({ attestation: record.attestation, currentContext: context,
        operationalScope: { deploymentId, qualificationRunId: current.qualificationRunId, environmentId: current.identity.environmentId, workloadId: current.identity.workloadId }, trustStore: this.trustStore });
      if (!cryptographic.allowed) reasons.push("HISTORICAL_PROOF_INVALID_OR_SCOPE_MISMATCH");
    }
    // Concurrent updates cannot combine authority/proof snapshots across versions.
    if ((await this.repository.read()).revision !== product.revision || (await this.assurance.state()).revision !== assurance.revision) reasons.push("AUTHORITY_CHANGED_DURING_CHECK");
    const allowed = reasons.length === 0;
    return { schema: "admissary-current-deployment-admission-decision/v1", deploymentId,
      decision: allowed ? "ALLOW" : "DENY", allowed, cryptographic,
      currentAuthority: { allowed, reasons: [...new Set(reasons)], validity: eligibility.lifecycleState === "CURRENT" ? "CURRENT" : "STALE",
        lifecycleState: eligibility.lifecycleState, approvalState: eligibility.approvalState,
        ...(record ? { attestationDigest: record.attestationDigest } : {}) } };
  }

  async getAttestation(
    deploymentId: string,
  ): Promise<ProductAttestationRecord | null> {
    const state = await this.currentState();
    const deployment = deploymentById(state, deploymentId);
    if (!deployment.attestationId) return null;
    const a = (await this.assurance.state()).deployments.find(x => x.deploymentId === deployment.assuranceDeploymentId);
    const record = state.attestations.find(x => x.attestationId === deployment.attestationId);
    if (!a || !record || !productProofMatches(state, deployment, a) || !attestationMatchesProof(record, a)) return null;
    if (!verifyHistoricalAttestationProof({attestation:record.attestation,currentContext:currentProofContext(a),operationalScope:{deploymentId:a.deploymentId,qualificationRunId:a.qualificationRunId,environmentId:a.identity.environmentId,workloadId:a.identity.workloadId},trustStore:this.trustStore}).allowed) return null;
    return structuredClone(
      state.attestations.find(
        (item) => item.attestationId === deployment.attestationId,
      ) ?? null,
    );
  }

  async run(
    runId: string,
  ): Promise<ProductQualificationRunRecord> {
    const state = await this.currentState();
    return structuredClone(runById(state, runId));
  }

  async blockers(
    runId: string,
  ): Promise<string[]> {
    return [...(await this.run(runId)).blockers];
  }

  async select(candidateIds: string[], policy: CandidateSelectionPolicy) {
    if (!Array.isArray(candidateIds) || !candidateIds.length || candidateIds.some(id => typeof id !== "string") || new Set(candidateIds).size !== candidateIds.length) throw new Error("PRODUCT_SELECTION_IDS_REQUIRED");
    const state = await this.currentState();
    const candidates: SelectionCandidate[] = [];
    for (const id of candidateIds) {
      const c = candidateById(state, id);
      const run = state.qualificationRuns.filter(r => r.candidateId === id && r.status === "COMPLETED").at(-1);
      const unknown = { value: null, provenance: "UNKNOWN" as const, sourceRef: null };
      const e = run?.completionEvidence;
      const metric = (field: "p95LatencyMs" | "costPerMillionTokensUsd" | "modelSizeB") => {
        const value = e?.operational?.[field] ?? null;
        return value === null || !e ? unknown : { value, provenance: e.provenance, sourceRef: e.sourceRefs[0]! };
      };
      // Only metrics inside the validated durable evidence acquire provenance.
      candidates.push({ candidateId: id, displayName: c.displayName, qualificationState: run?.qualificationState ?? "INCOMPLETE",
        exactArtifactBindingProven: run?.exactArtifactBindingProven ?? false, blockers: run?.blockers ?? ["NOT_EVALUATED"],
        operational: { provider: c.provider, p95LatencyMs: metric("p95LatencyMs"), costPerMillionTokensUsd: metric("costPerMillionTokensUsd"), modelSizeB: metric("modelSizeB") } });
    }
    return selectCandidates({ candidates, policy });
  }

  async candidates(): Promise<ProductCandidateRecord[]> {
    return structuredClone((await this.currentState()).candidates);
  }

  async contracts(): Promise<ProductContractRecord[]> {
    return structuredClone((await this.currentState()).contracts);
  }

  async state(): Promise<ProductApplicationState> {
    return this.repository.read();
  }

  async deployment(
    deploymentId: string,
    now: string,
  ): Promise<ProductDeploymentView> {
    canonicalIso(now, "now");
    const state = await this.currentState();
    const deployment = structuredClone(deploymentById(state, deploymentId));
    const decision = await this.assurance.decision(
      deployment.assuranceDeploymentId,
      now,
    );
    const a = (await this.assurance.state()).deployments.find(x => x.deploymentId === deployment.assuranceDeploymentId);
    if (!a || !productProofMatches(state, deployment, a)) {
      decision.allowed = false;
      decision.reasons.push("CURRENT_PROOF_IDENTITY_MISMATCH");
    }
    return {
      deployment,
      decision,
      validity: decision.lifecycleState === "CURRENT"
        ? "CURRENT"
        : "STALE",
    };
  }


  async rollbackTargets(
    deploymentId: string,
    now: string,
  ): Promise<ProductRollbackTarget[]> {
    canonicalIso(now, "now");

    const product =
      await this.currentState();

    deploymentById(
      product,
      deploymentId,
    );

    const assurance =
      await this.assurance.state();

    const targets:
      ProductRollbackTarget[] = [];

    for (
      const candidateDeployment of
      product.deployments
    ) {
      if (
        candidateDeployment
          .deploymentId ===
        deploymentId
      ) {
        continue;
      }

      let decision:
        AssuranceDecision;

      try {
        decision =
          await this.assurance.decision(
            candidateDeployment
              .assuranceDeploymentId,
            now,
          );
      } catch {
        continue;
      }

      if (!await this.getAttestation(candidateDeployment.deploymentId)) continue;
      const target =
        rollbackTargetFromState({
          product,
          assurance,
          currentDeploymentId:
            deploymentId,
          targetDeploymentId:
            candidateDeployment
              .deploymentId,
          targetDecision:
            decision,
        });

      if (target) {
        targets.push(
          target,
        );
      }
    }

    return targets.sort(
      (left, right) =>
        right.createdAt
          .localeCompare(
            left.createdAt,
          ) ||
        left.deploymentId
          .localeCompare(
            right.deploymentId,
          ),
    );
  }

  async auditDeployment(
    deploymentId: string,
    now: string,
  ): Promise<ProductDeploymentAudit> {
    canonicalIso(now, "now");

    const product =
      await this.currentState();

    const deployment =
      deploymentById(
        product,
        deploymentId,
      );

    const assurance =
      await this.assurance.state();

    const decision =
      await this.assurance.decision(
        deployment
          .assuranceDeploymentId,
        now,
      );

    const rollbackTargets =
      await this.rollbackTargets(
        deploymentId,
        now,
      );

    return buildDeploymentAudit({
      product,
      assurance,
      deploymentId,
      decision,
      rollbackTargets,
    });
  }

  async deployments(
    now: string,
    validity: "ALL" | "CURRENT" | "STALE" = "ALL",
  ): Promise<ProductDeploymentView[]> {
    canonicalIso(now, "now");
    const state = await this.currentState();
    const views: ProductDeploymentView[] = [];

    for (const deployment of state.deployments) {
      if (deployment.status !== "ACTIVE") continue;
      const { decision } = await this.deployment(deployment.deploymentId, now);
      const derivedValidity = decision.lifecycleState === "CURRENT"
        ? "CURRENT" as const
        : "STALE" as const;
      if (validity !== "ALL" && validity !== derivedValidity) continue;
      views.push({
        deployment: structuredClone(deployment),
        decision,
        validity: derivedValidity,
      });
    }

    return views.sort((a, b) =>
      a.deployment.deploymentId.localeCompare(b.deployment.deploymentId),
    );
  }
}
