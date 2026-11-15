import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdir,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";

import {
  buildJudgeView,
} from "../dist/index.js";
import {
  createAdmissaryWebServer,
} from "../scripts/admissary-web-lib.mjs";

function fixtureInput() {
  return {
    generatedAt: "2026-11-14T18:40:00.000Z",
    contract: {
      id: "banking-support-prod",
      version: "1.0.0",
      digest: "contract-digest",
      workload: "customer-support-intent-routing",
      environment: "production",
    },
    candidate: {
      model: "deepseek-ai/DeepSeek-V4.1-Flash",
      provider: "Dolphin",
      providerHost: "lighthouse.dphn.ai",
      bindingScope: "PROVIDER_MODEL_IDENTITY",
      exactArtifactBindingProven: false,
      empiricalFitness: "UNFIT",
      overallQualification: "REVIEW_REQUIRED",
      deployAllowed: false,
    },
    metrics: [
      {
        id: "macro_f1",
        label: "Macro F1",
        observed: 0.891408,
        operator: "gte",
        threshold: 0.82,
        criticality: "MANDATORY",
        state: "PASS",
      },
      {
        id: "critical_intent_recall",
        label: "Critical intent recall",
        observed: 0.825,
        operator: "gte",
        threshold: 0.9,
        criticality: "MANDATORY",
        state: "FAIL",
      },
      {
        id: "schema_validity",
        label: "Schema validity",
        observed: 0.993056,
        operator: "eq",
        threshold: 1,
        criticality: "MANDATORY",
        state: "FAIL",
      },
    ],
    empiricalBlockers: [
      "EVAL_CRITICAL_INTENT_RECALL",
      "EVAL_SCHEMA_VALIDITY",
    ],
    deploymentBlockers: [
      "QUALIFICATION_REVIEW_REQUIRED",
      "AUTHORIZATION_NOT_REQUESTED",
      "EXACT_ARTIFACT_BINDING_UNPROVEN",
    ],
    missingObligations: ["ART_REVISION_IMMUTABLE"],
    requalification: {
      unchanged: { reused: 10, recomputed: 0 },
      policyChange: {
        reused: ["evaluation:workload"],
        recomputed: ["source:policy"],
      },
      artifactChange: {
        reused: ["source:policy"],
        recomputed: ["evaluation:workload"],
      },
    },
    authorization: {
      approvalDeniedForRealRun: true,
      realDeployAllowed: false,
      viewerApprovalDenied: true,
      fixtureApprovedDeployAllowed: true,
      fixtureStaleDeployAllowed: false,
      fixtureStaleAuthorization: "APPROVED",
      fixtureStaleValidity: "STALE",
      fixtureRevokedAuthorization: "REVOKED",
    },
    verifier: {
      valid: "ALLOW",
      tampered: "DENY",
      tamperedReason: "MANIFEST_INTEGRITY_ERROR",
      rehashedRevisionChange: "DENY",
      rehashedRevisionChangeReason: "CANDIDATE_REVISION_MISMATCH",
      stale: "DENY",
      staleReason: "VALIDITY_NOT_CURRENT",
      unapproved: "DENY",
      unapprovedReason: "AUTHORIZATION_NOT_APPROVED",
      contractMismatch: "DENY",
      contractMismatchReason: "CONTRACT_DIGEST_MISMATCH",
      networkCalls: 0,
    },
    integrations: {
      serv: {
        liveArtifactPresent: true,
        artifactFile: "r3.json",
        role: "bounded semantics",
      },
      dolphin: {
        liveArtifactPresent: true,
        artifactFile: "r5.json",
        runDigest: "run-digest",
        cases: 144,
        role: "empirical execution",
      },
    },
    artifacts: [],
    candidates: [],
  };
}

test("judge view converts real blocking evidence into a memorable blocked state", () => {
  const view = buildJudgeView(fixtureInput());

  assert.equal(view.headlineState, "BLOCKED");
  assert.match(view.judgeSummary, /2 mandatory production gates failed/);
  assert.match(view.thesis, /exact model/);
  assert.match(view.punchline, /proof expires/);
});

test("judge view never averages mandatory failures into deployable", () => {
  const input = fixtureInput();
  input.metrics[0].observed = 0.99;
  input.metrics[0].state = "PASS";

  const view = buildJudgeView(input);
  assert.equal(view.headlineState, "BLOCKED");
  assert.equal(view.candidate.empiricalFitness, "UNFIT");
});

test("web server exposes sealed judge data and deterministic verifier scenarios", async () => {
  const server=createAdmissaryWebServer();await new Promise(r=>server.listen(0,"127.0.0.1",r));const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const health=await fetch(`${base}/health`).then(r=>r.json());assert.equal(health.status,"ok");assert.equal(health.providerCalls,0);
    const judge=await fetch(`${base}/api/judge`).then(r=>r.json());assert.equal(judge.schema,"admissary-judge-view/v1");assert.equal(judge.headlineState,"BLOCKED");
    const valid=await fetch(`${base}/api/verify-demo?scenario=valid`).then(r=>r.json());assert.equal(valid.result.allowed,true);
    const revision=await fetch(`${base}/api/verify-demo?scenario=revision`).then(r=>r.json());assert.equal(revision.result.allowed,false);assert.ok(revision.result.reasons.some(r=>r.code==="CANDIDATE_REVISION_MISMATCH"));
    const root=await fetch(base).then(r=>r.text());assert.match(root,/A model name is not a deployment decision/i);assert.match(root,/viewport/);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test("local snapshot requires verified digest and trusted sealed binding", async()=>{
  const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const dir=await mkdtemp(join(tmpdir(),'admissary-web-')),path=join(dir,'snapshot.json');
  const value=JSON.parse(await readFile('web/demo-snapshot.json','utf8'));value.candidate.model='corrupt/model';await writeFile(path,JSON.stringify(value));
  const server=createAdmissaryWebServer({snapshotPath:path});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try {const base=`http://127.0.0.1:${server.address().port}`;assert.equal((await fetch(`${base}/ready`)).status,500);assert.equal((await fetch(`${base}/api/judge`)).status,500);}
  finally{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});

test("standard web launcher validates the sealed snapshot and serves the redesigned workspace", async()=>{
  const {spawn}=await import('node:child_process');
  const child=spawn(process.execPath,['scripts/admissary-web.mjs','0'],{
    env:{...process.env,HOST:'127.0.0.1',PORT:'0',ADMISSARY_MODE:'judge-demo',ADMISSARY_SNAPSHOT_PATH:'web/demo-snapshot.json'},
    stdio:['ignore','pipe','pipe'],
  });
  let output='',errors='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>errors+=chunk);
  try{
    const url=await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Launcher readiness timeout: '+errors)),15000);
      child.on('error',error=>{clearTimeout(timeout);reject(error);});
      child.on('exit',code=>{clearTimeout(timeout);reject(new Error('Launcher exited '+code+': '+errors));});
      child.stdout.on('data',()=>{const match=/ADMISSARY_WEB_URL=(http:\/\/127\.0\.0\.1:\d+)/.exec(output);if(match){clearTimeout(timeout);resolve(match[1]);}});
    });
    const health=await fetch(url+'/health').then(r=>r.json());assert.equal(health.providerCalls,0);
    const html=await fetch(url).then(r=>r.text());assert.match(html,/id="workspace"/);assert.match(html,/Model Qualification Compiler/);
    const judge=await fetch(url+'/v1/product/judge-view').then(r=>r.json());assert.equal(judge.candidate.deployAllowed,false);
  }finally{
    child.kill();await new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)resolve();else child.once('exit',resolve);});
  }
});
