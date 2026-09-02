import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const MANIFEST_NAME = '.e2e-scaffold.json';

// The default suite location. Kept as the value resolveLocation falls back to,
// so every call site that used to hardcode 'e2e/web' stays behaviour-preserving.
export const WEB_DIR = 'e2e/web';

// The repo-root manifest, or null. A root manifest is the one that records where
// the suite lives: a plain JSON object carrying a non-empty string `location`.
// A legacy in-suite manifest (no `location`) is deliberately not returned here —
// it is handled by the existing candidate walk in write-specs.mjs.
export function readRootManifest(targetPath) {
  try {
    const parsed = JSON.parse(readFileSync(join(targetPath, MANIFEST_NAME), 'utf8'));
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      typeof parsed.location === 'string' &&
      parsed.location
    ) {
      return parsed;
    }
  } catch {
    // absent or malformed — treat as no root manifest
  }
  return null;
}

// Rejects a location that would let join(targetPath, location, ...) write or
// run outside targetPath — an absolute path, or a `..` climb past the root.
// This is a hard failure, not a silent fallback to the default: a traversal
// coming from a persisted manifest or a malicious --location must never be
// honoured. Lexical only (no realpath): the location need not exist yet
// (setup creates it), so there is nothing on disk to resolve symlinks
// against — unlike write-specs.mjs's isContainedIn, which validates a path
// under an already-scaffolded directory.
function assertSafeLocation(targetPath, location) {
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

// The suite location for this run: an explicit option, then the persisted
// location, then the e2e/web default.
export function resolveLocation(targetPath, options = {}) {
  const location = options.location || readRootManifest(targetPath)?.location || WEB_DIR;
  return assertSafeLocation(targetPath, location);
}

export function manifestSpecsDir(manifest) {
  return manifest?.dirs?.specs ?? null;
}

export function manifestPagesDir(manifest) {
  return manifest?.dirs?.pages ?? null;
}

// Three-valued: undefined when the key is absent (convention not chosen yet),
// true for Page Objects, false for self-contained specs.
export function manifestPom(manifest) {
  return manifest?.pom;
}

export function manifestAuthScheme(manifest) {
  return manifest?.authScheme;
}

// The persisted linter choice, or undefined when the key is absent (never
// recorded — the caller re-detects). 'eslint' | 'biome' | 'none' once set.
export function manifestLinter(manifest) {
  return manifest?.linter;
}

// The persisted TypeScript version override, or undefined when the key is
// absent (never overridden — the caller re-detects from the repo root).
export function manifestTypescript(manifest) {
  return manifest?.typescript;
}

// Reserved value for --linter/--auth/--typescript: clears a persisted
// override instead of setting one, so the next resolution re-detects (or,
// for authScheme, which nothing detects, returns to undecided).
export const CLEAR_OVERRIDE = 'auto';

// The explicit -> persisted -> detected order every override field in this
// skill resolves in. `explicit === CLEAR_OVERRIDE` skips both the explicit
// value and whatever is persisted, going straight to `detected` — which is
// `undefined` for authScheme, since nothing detects it.
export function resolveOverride(explicit, persisted, detected) {
  return explicit === CLEAR_OVERRIDE ? detected : (explicit ?? persisted ?? detected);
}

// The relative path climbing from `location` back to the repo root, e.g.
// 'e2e/web' -> '../..', '.' -> '.', 'apps/web/pw' -> '../../..'. Depth-aware
// so a suite scaffolded somewhere other than the default 2-deep e2e/web still
// gets a webServer.cwd that actually reaches the repo root.
export function rootRelativeCwd(location) {
  const depth = location === '.' ? 0 : location.split('/').filter(Boolean).length;
  return depth === 0 ? '.' : Array(depth).fill('..').join('/');
}
