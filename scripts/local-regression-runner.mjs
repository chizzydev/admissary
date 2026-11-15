import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

export async function runLocalRegressions(name, pattern, minimum) {
  const run=spawnSync(process.execPath,['--test','--test-reporter=tap',`--test-name-pattern=${pattern}`,'tests/post-audit.test.mjs'],{encoding:'utf8',timeout:120000});
  await mkdir('results/post-audit-regressions',{recursive:true});
  await writeFile(`results/post-audit-regressions/${name}.tap`,run.stdout+run.stderr);
  assert.equal(run.error,undefined);assert.equal(run.status,0,run.stdout+run.stderr);
  const count=Number(/^# pass (\d+)$/m.exec(run.stdout)?.[1]);
  assert.ok(count>=minimum,`${name} did not execute its required negative regressions`);
  console.log(`${name.toUpperCase()}_POST_AUDIT_REGRESSIONS=${count}_PASS`);
}
