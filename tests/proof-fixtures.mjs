import { generateKeyPairSync } from 'node:crypto';
import { buildQualificationManifest, buildQualificationAttestationStatement, signQualificationAttestation } from '../dist/index.js';
const keys = generateKeyPairSync('ed25519');
export const testTrust = { fixture: keys.publicKey.export({type:'spki',format:'pem'}).toString() };
export function signProductDeployment(state, deploymentId) {
  const d=state.deployments.find(x=>x.deploymentId===deploymentId);
  const r=state.qualificationRuns.find(x=>x.runId===d.qualificationRunId);
  const c=state.candidates.find(x=>x.candidateId===d.candidateId);
  const k=state.contracts.find(x=>x.contractId===d.contractId && x.version===d.contractVersion);
  const payload={candidate:{repository:c.repositoryOrModelId,revision:c.revision,tokenizerRevision:c.tokenizerRevision,artifactManifestDigest:c.artifactManifestDigest},contract:{id:k.contractId,version:k.version,digest:k.digest},policyPack:{version:r.policyVersion,digest:r.policyDigest},evaluation:{suite:r.evaluationSuite,digest:r.evaluationDigest},evidenceGraph:{rootDigest:r.evidenceGraphRootDigest}};
  const manifest=buildQualificationManifest({schema:'qualification-manifest/v1',...payload,qualification:{state:'QUALIFIED'},authorization:{state:'APPROVED'},validity:{state:'CURRENT'}});
  return signQualificationAttestation({statement:buildQualificationAttestationStatement({manifest,deploymentContext:{schema:'admissary-deployment-context/v1',...payload},exactArtifactBindingProven:true,issuedAt:'2026-11-14T20:00:00.000Z',keyId:'fixture',operationalScope:{deploymentId,qualificationRunId:r.runId,environmentId:r.environmentId,workloadId:r.workloadId}}),privateKeyPem:keys.privateKey.export({type:'pkcs8',format:'pem'}).toString(),keyId:'fixture'});
}
