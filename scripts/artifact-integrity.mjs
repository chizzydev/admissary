import { readFile, readdir } from 'node:fs/promises';
import { digestCanonicalJson, sha256Hex } from '../dist/index.js';

export async function acceptedHistorical(prefix) {
  const index = JSON.parse(await readFile('data/accepted-artifacts.json', 'utf8'));
  const binding = index.artifacts[prefix];
  if (index.schema !== 'admissary-accepted-historical-artifacts/v1' || !binding) throw new Error(`Unregistered historical artifact prefix: ${prefix}`);
  // R2/R3 are closed historical summary sets. No new provider executions are
  // accepted by filename; an explicit reviewed index update is required.
  if (/ADMISSARY_R[23]_/.test(prefix)) {
    for (const name of await readdir('results')) if (name.startsWith(prefix) && name.endsWith('.json') && name > binding.file) throw new Error(`Unregistered upstream evidence: ${name}`);
  }
  const path = `results/${binding.file}`;
  const bytes = await readFile(path);
  const value = JSON.parse(bytes);
  if (sha256Hex(bytes) !== binding.sha256 || value.schema !== binding.schema) throw new Error(`Historical artifact integrity failure: ${path}`);
  return path;
}
export function verifyProof(value, key, schema) {
  const { [key]: expected, ...payload } = value;
  if (value.schema !== schema || typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected) || /^0+$/.test(expected) || digestCanonicalJson(payload) !== expected) throw new Error(`Upstream ${key} integrity failure (${schema})`);
  return value;
}
export async function readProof(path, key, schema) {
  return verifyProof(JSON.parse(await readFile(path, 'utf8')), key, schema);
}
