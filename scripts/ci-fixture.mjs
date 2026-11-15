// Explicit local acceptance fixture, never real model evidence. Private signing
// material remains in this process; only the public trust store is persisted.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';
import * as a from '../dist/index.js';
import { fixtureEvidence, completionInput } from './remediation-fixtures.mjs';

export async function createCIFixture(dir, {deploymentId='ci-acceptance-current'}={}) {
  await mkdir(dir,{recursive:true});
  const productPath=join(dir,'product.json'),assurancePath=join(dir,'assurance.json'),trustPath=join(dir,'public-trust.json'),contextPath=join(dir,'context.json'),manifestPath=join(dir,'historical-manifest.json');
  const keys=generateKeyPairSync('ed25519'),keyId='ci-explicit-fixture';
  const trust={[keyId]:keys.publicKey.export({type:'spki',format:'pem'}).toString()};
  await writeFile(trustPath,JSON.stringify(trust,null,2)+'\n');
  const repository=new a.JsonProductRepository(productPath),assuranceRepository=new a.JsonAssuranceRepository(assurancePath);
  const assurance=new a.ContinuousAssuranceService(assuranceRepository);
  const resolver=async(r,c,k)=>fixtureEvidence(c,k);
  const service=new a.ProductApplicationService(repository,assurance,resolver,trust);
  const base=Date.now()-10000,at=n=>new Date(base+n).toISOString();
  const candidate={candidateId:'ci-fixture-candidate',displayName:'Explicit current-authority acceptance fixture',provider:'FIXTURE',repositoryOrModelId:'admissary-fixture/current-authority',revision:'a'.repeat(40),tokenizerRevision:'b'.repeat(40),artifactManifestDigest:a.digestCanonicalJson({fixture:'artifact'})};
  const contract={contractId:'ci-fixture-contract',version:'1',digest:a.digestCanonicalJson({fixture:'contract'}),environmentId:'fixture-environment',workloadId:'fixture-workload'};
  await service.registerCandidate({...candidate,actorId:'FIXTURE_SYSTEM',occurredAt:at(0)});
  await service.registerContract({...contract,actorId:'FIXTURE_SYSTEM',occurredAt:at(1)});
  const run=await service.startQualification({candidateId:candidate.candidateId,contractId:contract.contractId,contractVersion:contract.version,actorId:'FIXTURE_SYSTEM',requestedAt:at(2),reason:'Explicit fixture; no provider calls'});
  const evidence=fixtureEvidence(candidate,contract);
  await service.completeQualification({runId:run.runId,...completionInput(evidence),actorId:'FIXTURE_SYSTEM',completedAt:at(3)});
  const createInput={deploymentId,runId:run.runId,actorId:'FIXTURE_OPERATOR',createdAt:at(4),maxEvidenceAgeMs:86400000};
  await service.createDeployment(createInput);
  await service.approveDeployment({deploymentId,actorId:'FIXTURE_APPROVER',issuedAt:at(5),expiresAt:null,reason:'Explicit fixture approval'});
  async function signCurrent() {
    const current=(await assurance.state()).deployments.find(d=>d.deploymentId===deploymentId);
    const context=a.currentProofContext(current),{schema:ignored,...scope}=context;
    const manifest=a.buildQualificationManifest({schema:'qualification-manifest/v1',...scope,qualification:{state:'QUALIFIED'},authorization:{state:'APPROVED'},validity:{state:'CURRENT'}});
    const statement=a.buildQualificationAttestationStatement({manifest,deploymentContext:context,exactArtifactBindingProven:true,keyId,issuedAt:new Date().toISOString(),operationalScope:{deploymentId,qualificationRunId:current.qualificationRunId,environmentId:current.identity.environmentId,workloadId:current.identity.workloadId}});
    const attestation=a.signQualificationAttestation({statement,keyId,privateKeyPem:keys.privateKey.export({type:'pkcs8',format:'pem'}).toString()});
    await writeFile(contextPath,JSON.stringify(context,null,2)+'\n');await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
    return {context,manifest,attestation};
  }
  const proof=await signCurrent();
  await service.recordAttestation({deploymentId,attestation:proof.attestation,actorId:'FIXTURE_SYSTEM',recordedAt:new Date().toISOString()});
  return {dir,productPath,assurancePath,trustPath,contextPath,manifestPath,deploymentId,repository,assuranceRepository,assurance,service,resolver,trust,run,candidate,contract,createInput,signCurrent,...proof};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const dir=process.argv[2]??'results/ci-current-fixture';
  const fixture=await createCIFixture(dir);
  const result=await fixture.service.admitCurrentDeployment(fixture.deploymentId,fixture.context);
  if(!result.allowed)throw new Error('Current fixture did not reach verified admission');
  console.log('CI_FIXTURE_PROVENANCE=EXPLICIT_ACCEPTANCE_FIXTURE');
  console.log(`CI_FIXTURE_DEPLOYMENT_ID=${fixture.deploymentId}`);
}
