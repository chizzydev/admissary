// CURRENT authority only. Historical verification has a separate CLI.
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { JsonProductRepository, JsonAssuranceRepository, ContinuousAssuranceService,
  ProductApplicationService, digestCanonicalJson } from '../dist/index.js';
const args=new Map();
let report;
try {
  for(let i=2;i<process.argv.length;i+=2){
    const flag=process.argv[i],value=process.argv[i+1];
    if(!flag?.startsWith('--')||!value||args.has(flag))throw new Error('Invalid or duplicate CLI argument');
    args.set(flag,value);
  }
  const required=['--product-state','--assurance-state','--trust-store','--deployment-id','--context'];
  const allowed=new Set([...required,'--report']);
  if([...args.keys()].some(k=>!allowed.has(k))||required.some(k=>!args.get(k)))throw new Error('Current admission requires --product-state --assurance-state --trust-store --deployment-id --context [--report]. Manifest-only verification is historical, never current admission.');
  const trust=JSON.parse(await readFile(args.get('--trust-store'),'utf8'));
  if(!trust||typeof trust!=='object'||Array.isArray(trust)||!Object.values(trust).every(v=>typeof v==='string'))throw new Error('Invalid public trust store');
  const context=JSON.parse(await readFile(args.get('--context'),'utf8'));
  const service=new ProductApplicationService(new JsonProductRepository(args.get('--product-state')),
    new ContinuousAssuranceService(new JsonAssuranceRepository(args.get('--assurance-state'))),undefined,trust);
  const result=await service.admitCurrentDeployment(args.get('--deployment-id'),context,new Date().toISOString());
  report={...result,schema:'admissary-ci-current-admission/v2',authorityScope:'CURRENT_DEPLOYMENT_AUTHORITY',
    reasonCodes:result.currentAuthority.reasons,contextDigest:digestCanonicalJson(context),
    manifestDigest:result.cryptographic?.deploymentVerification.manifestDigest??null};
  process.exitCode=result.allowed?0:1;
}catch(error){
  report={schema:'admissary-ci-current-admission/v2',authorityScope:'CURRENT_DEPLOYMENT_AUTHORITY',decision:'DENY',allowed:false,
    reasonCodes:['INPUT_OR_AUTHORITY_ERROR'],reasons:[{code:'INPUT_OR_AUTHORITY_ERROR',detail:error instanceof Error?error.message:String(error)}],manifestDigest:null,contextDigest:null};
  process.exitCode=2;
}
console.log(`ADMISSARY_CI_DECISION=${report.decision}`);
console.log(`ADMISSARY_CI_REASON_CODES=${report.reasonCodes.join(',')||'NONE'}`);
console.log(`ADMISSARY_CI_AUTHORITY_SCOPE=${report.authorityScope}`);
const reportPath=args.get('--report')??'admissary-current-admission-report.json';
try{
  await mkdir(dirname(reportPath),{recursive:true});await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
  if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,
    `decision=${report.decision}\nreason_codes=${report.reasonCodes.join(',')||'NONE'}\nmanifest_digest=${report.manifestDigest??''}\ncontext_digest=${report.contextDigest??''}\n`);
  if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`## Admissary current deployment admission\n\n**Decision:** ${report.decision}\n\n**Authority:** CURRENT_DEPLOYMENT_AUTHORITY\n`);
}catch(error){console.error(`ADMISSARY_CI_REPORT_WRITE_ERROR=${error?.code??'IO_ERROR'}`);process.exitCode=2;}
