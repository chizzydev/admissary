import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
const read=async p=>JSON.parse(await readFile(p,'utf8'));
function matches(pattern,path) {
  let out='^';
  for(let i=0;i<pattern.length;i++){
    const c=pattern[i];
    if(c==='*'&&pattern[i+1]==='*'){i++;if(pattern[i+1]==='/'){i++;out+='(?:.*/)?';}else out+='.*';}
    else if(c==='*')out+='[^/]*';
    else out+=c.replace(/[.+?^${}()|[\]\\]/g,'\\$&');
  }
  return new RegExp(out+'$').test(path);
}
async function files(dir) {
  const result=[];for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())result.push(...await files(path));else result.push(path.replaceAll('\\','/'));}return result;
}
export async function workflowTrustCoverage() {
  const yaml=await readFile('.github/workflows/admissary-admission.yml','utf8');
  const patterns=[...yaml.matchAll(/^\s+- "([^"]+)"\s*$/gm)].map(m=>m[1]);
  const index=await read('data/accepted-artifacts.json');
  const inputs=[...(await files('data')).filter(p=>p.endsWith('.json')),
    ...Object.values(index.artifacts).map(x=>'results/'+x.file),
    ...(await files('results')).filter(p=>/\.(json|pem)$/.test(p)),
    ...(await files('web')).filter(p=>p.endsWith('.json')),
    ...(await files('deploy')).filter(p=>p.endsWith('.json')),
    ...(await files('src')),...(await files('scripts')),...(await files('tests')),
    'action.yml','package.json','tsconfig.json','.github/workflows/admissary-admission.yml'];
  const coverage=[...new Set(inputs)].sort().map(path=>({path,patterns:patterns.filter(p=>matches(p,path))}));
  return {schema:'admissary-workflow-trust-input-coverage/v2',patterns,inputs:coverage,uncovered:coverage.filter(x=>!x.patterns.length).map(x=>x.path),
    currentFixtureGenerated:yaml.includes('node scripts/ci-fixture.mjs results/ci-current-fixture'),currentInputsConfigured:['product-state','assurance-state','trust-store','deployment-id','context'].every(k=>yaml.includes(`          ${k}:`))};
}
