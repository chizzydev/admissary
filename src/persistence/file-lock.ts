import { pid } from "node:process";
import { open, mkdir, unlink } from "node:fs/promises";
import { dirname } from "node:path";

/** Cross-process exclusive writer lock. Never steal a live or abandoned lock:
 * after a crash an operator must quiesce writers and remove the .lock file.
 * A conflict is visible, never a silent overwrite. */
export async function lockStateFile(path: string): Promise<() => Promise<void>> {
  await mkdir(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  let handle;
  try { handle = await open(lockPath, "wx"); }
  catch (cause) { throw Object.assign(new Error(`STATE_WRITE_CONFLICT: ${lockPath}; retry after writer completes; abandoned locks require exclusive maintenance`), { code: "STATE_WRITE_CONFLICT", cause }); }
  try { await handle.writeFile(JSON.stringify({ schema: "admissary-local-writer-lock/v1", pid, createdAt: new Date().toISOString() }) + "\n"); await handle.sync(); }
  catch (error) { await handle.close(); await unlink(lockPath); throw error; }
  return async () => { await handle.close(); await unlink(lockPath); };
}
