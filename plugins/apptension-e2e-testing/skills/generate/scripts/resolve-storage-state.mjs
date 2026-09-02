import { existsSync, mkdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveLocation } from '../../e2e-setup/scripts/manifest.mjs';

// A logged-out Playwright storage state. Fixed content, but the write is still
// atomic (below): identical bytes do not make a truncate-then-write atomic.
const EMPTY_STATE = { cookies: [], origins: [] };

// The saved login the `setup` skill writes, in the target repo — at the suite
// location (the persisted manifest's `location`, e2e/web by default), never a
// hardcoded path.
export function targetAuthPath(targetPath, options = {}) {
  return join(targetPath, resolveLocation(targetPath, options), '.auth', 'user.json');
}

// The logged-out fallback, also in the target repo. It must live inside the
// target's roots, not the plugin cache: the Playwright MCP restricts file
// access to the target's roots, so browser_set_storage_state rejects any
// plugin-cache path outright.
export function targetLoggedOutPath(targetPath, options = {}) {
  return join(targetPath, resolveLocation(targetPath, options), '.auth', 'logged-out.json');
}

// Write `contents` to `filePath` inside `targetPath`, atomically and without
// following a symlink out of the repo:
//   - Containment: resolve the real directory after mkdir and refuse if it
//     escapes the real target root (a `.auth` symlinked outside would break
//     the in-root guarantee this resolver exists to provide).
//   - Atomic: write a per-process temp file in the same directory and rename
//     it over the target, so a concurrent reader (another run, or the MCP)
//     always sees a complete file, never a truncated one. Rename replaces a
//     file-level symlink rather than writing through it.
function writeContainedAtomic(targetPath, filePath, contents) {
  const root = realpathSync(targetPath);
  mkdirSync(dirname(filePath), { recursive: true });
  const realDir = realpathSync(dirname(filePath));
  if (realDir !== root && !realDir.startsWith(root + sep)) {
    throw new Error(`refusing to write outside target root: ${realDir} is not within ${root}`);
  }
  const dest = join(realDir, basename(filePath));
  const tmp = join(realDir, `.${basename(filePath)}.${process.pid}.tmp`);
  writeFileSync(tmp, contents);
  renameSync(tmp, dest);
  return dest;
}

// Resolve which storage-state file browser_set_storage_state should restore for
// this run's target. Reads only the given target — never any other repo — so a
// [target path] other than the session workspace can never pick up the
// workspace's own auth. The logged-in path is pure; the logged-out path writes
// the fixed empty state into the target so the MCP has a real, in-root file to
// restore from.
export function resolveStorageState(targetPath, options = {}) {
  const authFrom = targetAuthPath(targetPath, options);
  if (existsSync(authFrom)) {
    return { loaded: true, filename: authFrom };
  }
  const filename = writeContainedAtomic(
    targetPath,
    targetLoggedOutPath(targetPath, options),
    JSON.stringify(EMPTY_STATE),
  );
  return { loaded: false, filename };
}

const isMainModule =
  process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const targetPath = process.argv[2] ?? '.';
  const index = process.argv.indexOf('--location');
  const location = index !== -1 ? process.argv[index + 1] : undefined;
  console.log(JSON.stringify(resolveStorageState(targetPath, { location }), null, 2));
}
