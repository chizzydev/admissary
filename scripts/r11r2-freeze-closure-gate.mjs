import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { digestCanonicalJson } from '../dist/index.js';
import { verifyFreshSource } from './verify-fresh-source.mjs';

const child=process.argv.includes('--internal-fresh-child');
assert.ok(process.argv.slice(2).every(x=>x==='--internal-fresh-child'),'Unknown gate argument');
await mkdir('results/r11r2',{recursive:true});
const run=spawnSync(process.execPath,['--test','--test-reporter=tap','tests/freeze-closure.test.mjs','tests/post-audit.test.mjs'],{encoding:'utf8',timeout:180000,maxBuffer:16*1024*1024,env:{...process.env,ADMISSARY_R11R2_EVIDENCE:resolve('results/r11r2/evidence')}});
await writeFile('results/r11r2/REGRESSION_OUTPUT.tap',run.stdout+run.stderr);
assert.equal(run.error,undefined);assert.equal(run.status,0,run.stdout+run.stderr);assert.doesNotMatch(run.stdout,/^not ok |^# (?:skipped|cancelled) [1-9]/m);
for(let i=1;i<=6;i++)assert.match(run.stdout,new RegExp(`^ok \\d+ - NEW-0${i} `,'m'));
const prior=spawnSync(process.execPath,['scripts/r11r1-post-audit-remediation-gate.mjs'],{encoding:'utf8',timeout:180000,maxBuffer:16*1024*1024});
await writeFile('results/r11r2/FIRST_REMEDIATION_NON_REGRESSION.txt',prior.stdout+prior.stderr);assert.equal(prior.status,0,prior.stdout+prior.stderr);
const old=JSON.parse(await readFile('results/ADMISSARY_R11R1_POST_AUDIT_REMEDIATION_PROOF.json','utf8'));assert.equal(old.matrix.length,26);assert.ok(old.matrix.every(x=>x.state==='PASS'));
const checks=['CURRENT_AUTHORITY_CI_ALIGNMENT','REVOKED_HISTORICAL_PROOF_CI_DENY','REASSESSMENT_PRODUCT_API_END_TO_END','WORKFLOW_TRUST_INPUT_COVERAGE','AUDIT_AUTHORITATIVE_CHRONOLOGY','PARTIAL_PROVISIONING_RECOVERY'];
const evidence=JSON.parse(await readFile('results/r11r2/evidence/current-authority-ci.json','utf8'));
assert.equal(evidence.find(x=>x.scenario==='CURRENT').report.decision,'ALLOW');assert.ok(evidence.filter(x=>x.scenario!=='CURRENT').every(x=>x.exit!==0&&x.report.decision==='DENY'));
for(const line of ['HISTORICAL_PROOF_AFTER_REVOCATION=VALID','CURRENT_PRODUCT_AUTHORITY_AFTER_REVOCATION=DENY','CI_DEPLOYMENT_ADMISSION_AFTER_REVOCATION=DENY','CI_EXIT_AFTER_REVOCATION=NONZERO','CI_VALID_CURRENT_DEPLOYMENT=ALLOW'])console.log(line);
for(const check of checks)console.log(check+'=PASS');
if(child){console.log('R11R2_CHILD_AUTHORITY_CHECKS=PASS');process.exit(0);}
const fresh=await verifyFreshSource();assert.equal(fresh.fullSuite,'PASS');
console.log('FRESH_EXTRACTION_TEST_REPRODUCIBILITY=PASS');
const proof={schema:'admissary-r11r2-independent-freeze-closure/v2',generatedAt:new Date().toISOString(),checks:[...checks,'FRESH_EXTRACTION_TEST_REPRODUCIBILITY'].map(name=>({name,status:'PASS'})),newFindings:Array.from({length:6},(_,i)=>({id:`NEW-0${i+1}`,status:'CLOSED'})),originalFindings:old.matrix,canonicalTruth:old.canonicalTruth,freshExtraction:fresh,servCalls:0,dolphinCalls:0};
proof.proofDigest=digestCanonicalJson(proof);await writeFile('results/ADMISSARY_R11R2_FREEZE_CLOSURE_PROOF.json',JSON.stringify(proof,null,2)+'\n');
console.log('R11R2_INDEPENDENT_FREEZE_CLOSURE=PASS');
