import { isAbsolute, relative, resolve, sep } from 'node:path';

// The default suite location. Kept as the value resolveLocation falls back to,
// so every call site that used to hardcode 'e2e/web' stays behaviour-preserving.
export const WEB_DIR = 'e2e/web';

// Rejects a location that would let join(targetPath, location, ...) write or
// run outside targetPath — an absolute path, or a `..` climb past the root.
// This is a hard failure, not a silent fallback to the default: a traversal
// coming from a malicious --location must never be honoured. Lexical only (no
// realpath): the location need not exist yet (setup creates it), so there is
// nothing on disk to resolve symlinks against — unlike write-specs.mjs's
// isContainedIn, which validates a path under an already-scaffolded directory.
export function assertSafeLocation(targetPath, location) {
  if (isAbsolute(location)) {
    throw new Error(`invalid e2e suite location "${location}": must be a relative path`);
  }
  const root = resolve(targetPath);
  const rel = relative(root, resolve(root, location));
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    throw new Error(`invalid e2e suite location "${location}": escapes the repo root`);
  }
  return location;
}

// The suite location for this run: an explicit option, else the e2e/web default.
export function resolveLocation(targetPath, options = {}) {
  const location = options.location || WEB_DIR;
  return assertSafeLocation(targetPath, location);
}

// Reserved value for --linter/--typescript: clears an override instead of
// setting one, so the resolution re-detects.
export const CLEAR_OVERRIDE = 'auto';

// The explicit -> detected order every override field in this skill resolves
// in. `explicit === CLEAR_OVERRIDE` skips the explicit value, going straight to
// `detected`.
export function resolveOverride(explicit, detected) {
  return explicit === CLEAR_OVERRIDE ? detected : (explicit ?? detected);
}

// The relative path climbing from `location` back to the repo root, e.g.
// 'e2e/web' -> '../..', '.' -> '.', 'apps/web/pw' -> '../../..'. Depth-aware
// so a suite scaffolded somewhere other than the default 2-deep e2e/web still
// gets a webServer.cwd that actually reaches the repo root.
export function rootRelativeCwd(location) {
  const depth = location === '.' ? 0 : location.split('/').filter(Boolean).length;
  return depth === 0 ? '.' : Array(depth).fill('..').join('/');
}
