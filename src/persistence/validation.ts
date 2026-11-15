import { deriveCompletion } from "../product/completion.js";
import { verifySignedQualificationAttestation } from "../attestations/qualification-attestation.js";
import { digestCanonicalJson } from "../qualification/canonical.js";
import { canonicalJson } from "../qualification/canonical.js";

type Row = Record<string, any>;
const Q = "QUALIFIED|UNFIT|DISQUALIFIED|REVIEW_REQUIRED|INCOMPLETE|ERROR";
const A = "NOT_REQUESTED|PENDING|APPROVED|REVOKED";
const V = "CURRENT|STALE";
const schemas: Record<string, Record<string, string>> = {
  product: {
    candidates: 'candidateId:s displayName:s provider:s repositoryOrModelId:s revision:?s tokenizerRevision:?s artifactManifestDigest:?s registeredBy:s registeredAt:t',
    contracts: 'contractId:s version:s digest:s workloadId:s environmentId:s registeredBy:s registeredAt:t updatedAt:t',
    qualificationRuns: `runId:s candidateId:s contractId:s contractVersion:s environmentId:s workloadId:s status:REQUESTED|COMPLETED|FAILED qualificationState:?${Q} blockers:a exactArtifactBindingProven:b evidenceGraphRootDigest:?s policyVersion:?s policyDigest:?s evaluationSuite:?s evaluationDigest:?s sourceRefs:a requestedBy:s requestedAt:t completedBy:?s completedAt:?t replacesDeploymentId:?s reason:s requestDigest:s completionEvidence:~o`,
    deployments: 'deploymentId:s candidateId:s contractId:s contractVersion:s qualificationRunId:s assuranceDeploymentId:s status:PROVISIONING|ACTIVE|ERROR provisioningRequestDigest:~s createdBy:s createdAt:t updatedAt:t provisioningError:?s attestationId:?s',
    attestations: 'attestationId:s deploymentId:s attestation:o attestationDigest:s recordedBy:s recordedAt:t',
    events: 'eventId:s occurredAt:t actorId:s type:CANDIDATE_REGISTERED|CONTRACT_REGISTERED|QUALIFICATION_REQUESTED|QUALIFICATION_COMPLETED|DEPLOYMENT_PROVISIONING|DEPLOYMENT_ACTIVE|DEPLOYMENT_ERROR|REQUALIFICATION_REQUESTED|ATTESTATION_RECORDED|MATERIAL_CHANGE_RECORDED|REASSESSMENT_COMPLETED subjectId:s detail:s recordedAt:~t appendSequence:~n',
  },
  assurance: {
    deployments: `deploymentId:s qualificationRunId:s qualificationState:${Q} exactArtifactBindingProven:b identity:o lifecycleState:CURRENT|REASSESSMENT_REQUIRED|EXPIRED|REVOKED activeApprovalId:?s monitoringStatus:HEALTHY|DEGRADED monitoringPolicy:o lastSuccessfulCheckAt:?t lastCheckAt:?t latestInvalidatedNodes:a createdAt:t updatedAt:t`,
    approvals: 'approvalId:s scope:o state:APPROVED|REVOKED|EXPIRED actorId:s issuedAt:t expiresAt:?t stateChangedAt:t reason:s',
    watchChecks: 'checkId:s deploymentId:s source:HUGGING_FACE outcome:UNCHANGED|MATERIAL_CHANGE|CHECK_ERROR checkedAt:t previousSnapshotDigest:?s currentSnapshotDigest:?s changes:a invalidatedNodes:a errorCode:?s errorDetail:?s',
    reassessments: 'requestId:s deploymentId:s previousQualificationRunId:s requestedAt:t reason:s invalidatedNodes:a status:REQUESTED|COMPLETED completedAt:?t replacementQualificationRunId:?s',
    events: 'eventId:s deploymentId:s occurredAt:t type:DEPLOYMENT_REGISTERED|APPROVAL_GRANTED|APPROVAL_REVOKED|APPROVAL_EXPIRED|WATCH_UNCHANGED|WATCH_ERROR|MATERIAL_CHANGE_DETECTED|REASSESSMENT_REQUESTED|REASSESSMENT_COMPLETED detail:s recordedAt:~t appendSequence:~n',
  },
  registry: {
    organizations: 'id:s name:s',
    environments: 'id:s organizationId:s name:s tier:DEVELOPMENT|STAGING|PRODUCTION region:~s',
    workloads: 'id:s packId:s packVersion:s packDigest:s name:s',
    candidates: 'id:s organizationId:s displayName:s source:HUGGING_FACE|DOLPHIN|OTHER repositoryOrModelId:s accountableOwner:s createdAt:t',
    artifactRevisions: 'id:s candidateId:s immutableRevision:?s tokenizerRevision:?s artifactDigest:?s runtimeBindingScope:PROVIDER_MODEL_IDENTITY|EXACT_ARTIFACT exactArtifactBindingProven:b createdAt:t',
    deployments: `id:s organizationId:s environmentId:s workloadId:s contractId:s contractVersion:s candidateId:s artifactRevisionId:s qualificationState:${Q} authorizationState:${A} validityState:${V} activeBlockers:a latestQualificationRunId:?s latestAttestationDigest:?s nextReassessmentAt:?t updatedAt:t`,
    events: 'id:s type:ORGANIZATION_REGISTERED|ENVIRONMENT_REGISTERED|WORKLOAD_REGISTERED|CANDIDATE_REGISTERED|ARTIFACT_REGISTERED|DEPLOYMENT_REGISTERED|DEPLOYMENT_DECISION_UPDATED entityId:s occurredAt:t detail:s',
  },
  legacy: {
    qualificationRuns: `runId:s contractId:s contractVersion:s contractDigest:s candidateIdentity:s qualificationState:${Q} graphRootDigest:s exactArtifactBindingProven:b finalizedAt:t sourceArtifactDigest:s`,
    authorizationEvents: `id:s runId:s state:${A} actorId:s actorRoles:a occurredAt:t reason:s`,
    validityEvents: `id:s runId:s state:${V} actorId:s occurredAt:t reason:s`,
    auditEvents: 'id:s type:QUALIFICATION_FINALIZED|AUTHORIZATION_APPROVED|AUTHORIZATION_REVOKED|VALIDITY_STALE runId:s actorId:s occurredAt:t detail:s',
  },
};

function check(ok: unknown, label: string): asserts ok { if (!ok) throw Object.assign(new Error(`Invalid durable authority state: ${label}`), { code: 'STATE_VALIDATION_ERROR' }); }
function object(v: any): v is Row { return !!v && typeof v === 'object' && !Array.isArray(v); }
function record(r: Row, spec: string) {
  check(object(r), 'record');
  const fields = spec.split(' ').map(x => x.split(':'));
  check(Object.keys(r).every(k => fields.some(x => x[0] === k)), 'unexpected record field');
  for (const [key, rule0] of fields) {
    let rule = rule0!; const v = r[key!];
    if (rule.startsWith('~') && v === undefined) continue;
    rule = rule.replace(/^~/, '');
    if (rule.startsWith('?') && v === null) continue;
    rule = rule.replace(/^\?/, '');
    const valid = rule === 's' ? typeof v === 'string' && !!v.trim() :
      rule === 't' ? typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v :
      rule === 'n' ? Number.isSafeInteger(v) && v > 0 : rule === 'b' ? typeof v === 'boolean' : rule === 'a' ? Array.isArray(v) && v.every(x => typeof x === 'string' && !!x.trim()) :
      rule === 'o' ? object(v) : rule.split('|').includes(v);
    check(valid, key!);
  }
}
export function validateMonitoringPolicy(p: any) {
  check(object(p) && Object.keys(p).sort().join(',') === 'failClosedWhenOverdue,maxEvidenceAgeMs', 'monitoring policy');
  check(typeof p.maxEvidenceAgeMs === 'number' && Number.isFinite(p.maxEvidenceAgeMs) && p.maxEvidenceAgeMs > 0 && p.failClosedWhenOverdue === true, 'monitoring policy age/fail-closed');
}
export function validateAuthorityState(s: any, kind: keyof typeof schemas) {
  check(object(s), 'root'); canonicalJson(s);
  check(Number.isSafeInteger(s.revision) && s.revision >= 0, 'revision');
  const tables = schemas[kind]!;
  check(Object.keys(s).sort().join(',') === ['schema','revision',...Object.keys(tables)].sort().join(','), 'root fields');
  for (const [name, spec] of Object.entries(tables)) {
    check(Array.isArray(s[name]), name);
    const ids = new Set();
    for (const r of s[name]) {
      record(r, spec);
      const primary = spec.split(' ')[0]!.split(':')[0]!;
      const id = name === 'contracts' ? `${r.contractId}@${r.version}` : r[primary];
      check(!ids.has(id), `duplicate ${name}`); ids.add(id);
    }
  }
  if (kind === 'product' || kind === 'assurance') {
    let previousTime = 0;
    for (const [index, event] of s.events.entries()) {
      check((event.recordedAt === undefined) === (event.appendSequence === undefined), 'event recording metadata pair');
      if (event.recordedAt !== undefined) {
        check(event.appendSequence === index + 1 && Date.parse(event.recordedAt) > previousTime, 'authoritative event order');
        previousTime = Date.parse(event.recordedAt);
      }
    }
  }
  const ref = (table: string, key: string, value: any) => check(s[table].some((x: Row) => x[key] === value), `${table} reference ${value}`);
  if (kind === 'product') {
    for (const r of s.qualificationRuns) {
      ref('candidates', 'candidateId', r.candidateId);
      check(s.contracts.some((k: Row) => k.contractId === r.contractId && k.version === r.contractVersion && k.environmentId === r.environmentId && k.workloadId === r.workloadId), 'run contract scope');
      if (r.status === 'COMPLETED') check(r.qualificationState && r.evidenceGraphRootDigest && r.completedAt && r.completedBy && r.sourceRefs.length && Date.parse(r.completedAt) >= Date.parse(r.requestedAt), 'completion');
      if (r.status === 'REQUESTED') check(r.qualificationState === null && r.completedAt === null && r.completedBy === null && !r.exactArtifactBindingProven, 'pending run');
      if (r.qualificationState === 'QUALIFIED') check(!r.blockers.length && r.completionEvidence, 'qualified evidence/blockers');
      if (r.completionEvidence) {
        const c=s.candidates.find((c: Row)=>c.candidateId===r.candidateId), k=s.contracts.find((k: Row)=>k.contractId===r.contractId && k.version===r.contractVersion);
        const derived=deriveCompletion(r.completionEvidence,c,k);
        check(derived.state===r.qualificationState && r.exactArtifactBindingProven===r.completionEvidence.exactArtifactBindingProven && r.evidenceGraphRootDigest===r.completionEvidence.graph.rootDigest && r.policyVersion===r.completionEvidence.policy.version && r.policyDigest===r.completionEvidence.policy.digest && r.evaluationSuite===r.completionEvidence.evaluation.suite && r.evaluationDigest===r.completionEvidence.evaluation.digest && digestCanonicalJson(r.sourceRefs)===digestCanonicalJson(r.completionEvidence.sourceRefs), 'completed evidence relationships');
      }
    }
    for (const d of s.deployments) {
      const r = s.qualificationRuns.find((r: Row) => r.runId === d.qualificationRunId);
      check(r && r.status === 'COMPLETED' && r.candidateId === d.candidateId && r.contractId === d.contractId && r.contractVersion === d.contractVersion, 'deployment proof');
      if (d.attestationId) check(s.attestations.some((a: Row) => a.attestationId === d.attestationId && a.deploymentId === d.deploymentId), 'active attestation');
    }
    for (const a of s.attestations) {
      ref('deployments', 'deploymentId', a.deploymentId);
      const v=verifySignedQualificationAttestation(a.attestation,{});
      check(v.reasons.every(x=>x==='ATTESTATION_UNTRUSTED_KEY') && a.attestationDigest===a.attestation.envelopeDigest, 'attestation structure/integrity');
    }
  }
  if (kind === 'assurance') {
    for (const d of s.deployments) {
      validateMonitoringPolicy(d.monitoringPolicy);
      record(d.identity, 'candidateRepository:s candidateRevision:s tokenizerRevision:s artifactManifestDigest:s contractId:s contractVersion:s contractDigest:s policyVersion:s policyDigest:s evaluationSuite:s evaluationDigest:s evidenceGraphRootDigest:s environmentId:s workloadId:s');
      if (d.activeApprovalId) {
        ref('approvals','approvalId',d.activeApprovalId);
        const a=s.approvals.find((a: Row)=>a.approvalId===d.activeApprovalId);
        check(a.scope.deploymentId===d.deploymentId, 'active approval owner');
        if (d.lifecycleState==='CURRENT' && a.state==='APPROVED') {
          const i=d.identity;
          const scope={deploymentId:d.deploymentId,qualificationRunId:d.qualificationRunId,environmentId:i.environmentId,workloadId:i.workloadId,candidateIdentityDigest:digestCanonicalJson({repository:i.candidateRepository,revision:i.candidateRevision,tokenizerRevision:i.tokenizerRevision,artifactManifestDigest:i.artifactManifestDigest}),contractDigest:i.contractDigest,policyDigest:i.policyDigest,evaluationDigest:i.evaluationDigest,evidenceGraphRootDigest:i.evidenceGraphRootDigest,fullIdentityDigest:digestCanonicalJson(i)};
          check(digestCanonicalJson(a.scope)===digestCanonicalJson(scope), 'active approval scope');
        }
      }
    }
    for (const a of s.approvals) {
      record(a.scope, 'deploymentId:s qualificationRunId:s environmentId:s workloadId:s candidateIdentityDigest:s contractDigest:s policyDigest:s evaluationDigest:s evidenceGraphRootDigest:s fullIdentityDigest:s');
      ref('deployments','deploymentId',a.scope.deploymentId);
      check(!a.expiresAt || Date.parse(a.expiresAt) > Date.parse(a.issuedAt), 'approval interval');
    }
    for (const name of ['watchChecks','reassessments','events']) for (const r of s[name]) ref('deployments','deploymentId',r.deploymentId);
  }
  if (kind === 'legacy') for (const name of ['authorizationEvents','validityEvents','auditEvents']) for (const r of s[name]) {
    ref('qualificationRuns','runId',r.runId);
    if (r.actorRoles) check(r.actorRoles.every((x: string) => ['VIEWER','APPROVER','ADMIN','SYSTEM'].includes(x)), 'actor roles');
  }
  if (kind === 'registry') {
    for (const r of [...s.environments, ...s.candidates, ...s.deployments]) ref('organizations','id',r.organizationId);
    for (const r of s.artifactRevisions) ref('candidates','id',r.candidateId);
    for (const d of s.deployments) {
      ref('environments','id',d.environmentId); ref('workloads','id',d.workloadId); ref('candidates','id',d.candidateId);
      check(s.artifactRevisions.some((a: Row) => a.id === d.artifactRevisionId && a.candidateId === d.candidateId), 'artifact relationship');
    }
  }
}
