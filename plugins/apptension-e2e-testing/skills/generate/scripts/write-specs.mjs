import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync, lstatSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect } from '../../e2e-setup/scripts/detect.mjs';
import { WEB_DIR, MANIFEST_NAME, manifestSpecsDir, manifestPagesDir } from '../../e2e-setup/scripts/scaffold.mjs';
import { readRootManifest } from '../../e2e-setup/scripts/manifest.mjs';
import { JIRA_KEY_PATTERN } from './classify-argument.mjs';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(slug) {
  return typeof slug === 'string' && SLUG_PATTERN.test(slug);
}

// The whole-path/granular split is filename-only (see e2e-setup's
// SMOKE_SPEC_PATTERN), so this infix decides which Playwright project a spec
// runs in. It is a literal here, never a caller-supplied string: passing it
// inside `slug` would need a dot, and a dot is the first character a
// path-traversal component needs — which is exactly what isValidSlug exists
// to refuse.
//
// Strictly `true`, not truthy: a caller sending "true" or 1 would otherwise
// get a granular spec reported as `created`, and never learn the file landed
// in the wrong project.
function smokeInfix(smoke) {
  return smoke === true ? '.smoke' : '';
}

function isValidSmokeFlag(smoke) {
  return smoke === undefined || typeof smoke === 'boolean';
}

// realpathSync requires the path to exist, but the case being written is
// usually new — its flowId directory, or the spec file itself, doesn't
// exist yet. Resolves symlinks on whatever prefix of the path already
// exists, then rejoins the not-yet-existing suffix lexically. Safe to do
// lexically: every suffix segment this module ever appends (flowId, slug)
// is already validated as a single kebab-case component, so it carries no
// '..' for a lexical join to mishandle.
//
// Climbs using lstatSync, not existsSync: existsSync follows the final
// symlink and reports a *dangling* one (target doesn't exist yet) as
// missing, which would make this climb past it as if it were free to
// create — exactly what a planted dangling symlink at the spec path itself
// relies on. lstatSync sees the link itself regardless of whether its
// target exists, so a symlink anywhere along the path — dangling or not —
// is caught here and reported as escaping containment (`null`), instead of
// being resolved (a live one) or thrown on (a dangling one, since
// realpathSync requires the target to exist).
function realpathPermittingMissing(path) {
  let current = resolve(path);
  const suffix = [];
  for (;;) {
    let stat;
    try {
      stat = lstatSync(current);
    } catch {
      const parent = dirname(current);
      if (parent === current) break;
      suffix.unshift(current.slice(parent.length + 1));
      current = parent;
      continue;
    }
    if (stat.isSymbolicLink()) return null;
    break;
  }
  const real = realpathSync(current);
  return suffix.length ? join(real, ...suffix) : real;
}

// Defense-in-depth: even a validated slug should never resolve outside the
// spec directory. Confirms the resolved absolute path is still contained
// within the resolved spec directory before anything is written.
//
// realpathPermittingMissing, not resolve(): a lexical resolve() never
// follows a symlink, so a directory already on disk under a validated
// name — e.g. a flowId existingFlows() offered as a match candidate — could
// be a symlink pointing anywhere, and the write would follow it right past
// a purely lexical containment check. Resolving both sides the same way
// keeps the comparison meaningful even when the spec dir itself sits behind
// a symlink (e.g. macOS's /var -> /private/var), since that resolves away
// on both operands identically.
function isContainedIn(absolutePath, containerDir) {
  const resolvedPath = realpathPermittingMissing(absolutePath);
  const resolvedContainer = realpathPermittingMissing(containerDir);
  // null means realpathPermittingMissing hit a symlink (dangling or not)
  // somewhere along that path — never safe, whichever side it's on.
  if (resolvedPath === null || resolvedContainer === null) return false;
  return resolvedPath === resolvedContainer || resolvedPath.startsWith(resolvedContainer + sep);
}

// Where a Playwright setup can live, relative to the repo root. WEB_DIR first:
// it is this plugin's own convention, so when both it and a root-level setup
// exist, the sub-package is the one holding the specs this script writes. Both
// lookups below walk the same list, so the two rungs cannot disagree about
// where they looked.
const SETUP_CANDIDATE_DIRS = [WEB_DIR, '.', 'e2e', 'tests', 'test', 'playwright'];

// A usable scaffold manifest is a plain JSON object with a dirs object — not
// null, not an array, not a bare primitive. Anything else can still parse as
// valid JSON but has no scaffold shape: writing pom onto null throws, onto an
// array is silently dropped by JSON.stringify, and onto a shapeless {} would
// disagree with the resolvers, which need dirs. This is the same shape the
// resolvers require, so a writer and the readers agree on which manifest counts.
function isScaffoldManifest(manifest) {
  return (
    manifest !== null &&
    typeof manifest === 'object' &&
    !Array.isArray(manifest) &&
    manifest.dirs !== null &&
    typeof manifest.dirs === 'object' &&
    !Array.isArray(manifest.dirs)
  );
}

// The path of the first candidate holding a scaffold-shaped manifest. Skips a
// malformed or shapeless manifest and keeps searching, so a writer (persist-pom)
// targets the same manifest the resolvers below read — never a broken or
// shapeless higher-priority file.
export function findParsedManifestPath(targetPath) {
  if (readRootManifest(targetPath)) return join(targetPath, MANIFEST_NAME);
  for (const candidate of SETUP_CANDIDATE_DIRS) {
    const manifestPath = join(targetPath, candidate, MANIFEST_NAME);
    if (!existsSync(manifestPath)) continue;
    try {
      if (isScaffoldManifest(JSON.parse(readFileSync(manifestPath, 'utf8')))) return manifestPath;
    } catch {
      // Malformed JSON — skip and try the next candidate.
    }
  }
  return null;
}

// Walks the candidate dirs and returns the first repo-root-relative dir the
// extractor yields a value from. Skips a manifest that is missing, malformed,
// or that the extractor draws nothing from (e.g. no dirs.specs) and keeps
// searching — so neither a broken nor an unrelated higher-priority manifest
// hides a valid lower-priority one. dirs.specs/dirs.pages are relative to the
// manifest's own directory, so the candidate is joined back on.
function resolveFromManifest(targetPath, extract) {
  for (const candidate of SETUP_CANDIDATE_DIRS) {
    const manifestPath = join(targetPath, candidate, MANIFEST_NAME);
    if (!existsSync(manifestPath)) continue;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      continue;
    }
    const value = extract(manifest);
    if (value) return join(candidate, value);
  }
  return null;
}

function specsDirFromScaffoldManifest(targetPath) {
  return resolveFromManifest(targetPath, manifestSpecsDir);
}

// Page objects only exist in a scaffolded repo, so the pages dir comes only
// from the manifest — no playwright.config fallback. Returns a repo-root-
// relative dir, or null when no manifest declares a pages dir.
export function resolvePagesDir(targetPath) {
  const root = readRootManifest(targetPath);
  if (root) {
    const pages = manifestPagesDir(root);
    if (pages) return join(root.location, pages);
  }
  return resolveFromManifest(targetPath, manifestPagesDir);
}

// The house-style split: one file per responsibility, named <flowId>.<role>.
// A fixed allowlist, never caller-supplied free text, so the role can never
// carry a path component.
const PAGE_OBJECT_ROLES = new Set(['selectors', 'page', 'assertion']);

// Writes house-style page objects into the manifest's pages dir under the same
// containment and refuse-exists rules as specs. Content lands verbatim: unlike
// a spec, a page object carries no provenance comment.
function writePageObjects(targetPath, pageObjects, ext) {
  if (!Array.isArray(pageObjects) || pageObjects.length === 0) return [];
  const pagesDir = resolvePagesDir(targetPath);
  const pagesDirAbsolute = pagesDir ? join(targetPath, pagesDir) : null;
  const results = [];
  for (const { flowId, role, content } of pageObjects) {
    if (!pagesDir) {
      results.push({ flowId, role, path: null, result: 'refused-no-pages-dir' });
      continue;
    }
    if (!isValidSlug(flowId)) {
      results.push({ flowId, role, path: null, result: 'refused-invalid-flow' });
      continue;
    }
    if (!PAGE_OBJECT_ROLES.has(role)) {
      results.push({ flowId, role, path: null, result: 'refused-invalid-role' });
      continue;
    }
    const relPath = join(pagesDir, `${flowId}.${role}.${ext}`);
    const absolutePath = join(targetPath, relPath);
    if (!isContainedIn(absolutePath, pagesDirAbsolute)) {
      results.push({ flowId, role, path: null, result: 'refused-invalid-flow' });
      continue;
    }
    if (existsSync(absolutePath)) {
      results.push({ flowId, role, path: relPath, result: 'refused-exists' });
      continue;
    }
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
    results.push({ flowId, role, path: relPath, result: 'created' });
  }
  return results;
}

const PLAYWRIGHT_CONFIG_NAMES = [
  'playwright.config.ts',
  'playwright.config.js',
  'playwright.config.mjs',
  'playwright.config.cjs',
];

// Locates the target repo's Playwright config, if any, walking the same
// candidate directories and filenames resolveSpecDir reads testDir from.
// Exported so a caller that needs the config file itself — discover's
// smoke-split check, below — doesn't have to re-walk this search order and
// risk disagreeing with it about where configs live.
//
// Skips past a config that exists but whose testDir this regex can't read,
// rather than stopping there: a repo can have an unrelated or partial
// config earlier in the search order (e2e/web is checked first) and a real,
// working one later. Stopping at the first existing file regardless of
// whether it resolves would make that later, valid config unreachable —
// exactly the config resolveSpecDir itself would have found by continuing.
export function findPlaywrightConfig(targetPath) {
  // The persisted root manifest's location first: a suite scaffolded at a
  // custom location (e.g. 'services/e2e') is not among the fixed candidates
  // below, so without this it is invisible to this search — the config is
  // right there on disk but never checked.
  const rootLocation = readRootManifest(targetPath)?.location;
  const candidates = rootLocation ? [rootLocation, ...SETUP_CANDIDATE_DIRS] : SETUP_CANDIDATE_DIRS;
  for (const candidate of candidates) {
    for (const name of PLAYWRIGHT_CONFIG_NAMES) {
      const path = join(targetPath, candidate, name);
      if (!existsSync(path)) continue;
      if (readFileSync(path, 'utf8').match(/testDir:\s*['"]\.?\/?([^'"]*)['"]/)) return path;
    }
  }
  return null;
}

// testDir is relative to the config that declares it, which is what makes the
// scaffolded `testDir: '.'` mean e2e/web rather than the repo root.
function specsDirFromPlaywrightConfig(targetPath) {
  const configPath = findPlaywrightConfig(targetPath);
  if (!configPath) return null;

  const match = readFileSync(configPath, 'utf8').match(/testDir:\s*['"]\.?\/?([^'"]*)['"]/);
  const candidate = dirname(relative(targetPath, configPath));
  return join(candidate, match[1]);
}

const WEB_DIR_SEGMENTS = WEB_DIR.split('/');

// Every spec dir this script resolves is relative to the repo root, so a target
// path that is itself the scaffolded sub-package doubles the prefix and writes
// to e2e/web/e2e/web/specs/. Only the full e2e/web pair counts: 'apps/web' is an
// ordinary monorepo package root and must still be accepted.
export function isWebDirTarget(targetPath) {
  const segments = resolve(targetPath).split(sep).filter(Boolean);
  const offset = segments.length - WEB_DIR_SEGMENTS.length;
  if (offset < 0) return false;
  return WEB_DIR_SEGMENTS.every((segment, index) => segments[offset + index] === segment);
}

export function resolveSpecDir(targetPath, options = {}) {
  if (options.specDir) return options.specDir;

  // The repo-root manifest records the suite location; dirs are relative to it.
  const root = readRootManifest(targetPath);
  if (root) {
    const specs = manifestSpecsDir(root);
    if (specs) return join(root.location, specs);
  }

  const fromScaffold = specsDirFromScaffoldManifest(targetPath);
  if (fromScaffold) return fromScaffold;

  const fromConfig = specsDirFromPlaywrightConfig(targetPath);
  if (fromConfig) return fromConfig;

  return 'e2e/specs';
}

// The one origin value there is. An allowlist rather than a free string
// because this lands verbatim on the first line of a written file, and a
// caller-supplied value there is caller-supplied content in the repo.
const DISCOVER_ORIGIN = 'discover';

// The committed record of which run produced this file. It replaces the
// ledger: a comment survives a formatter, and no automation reads it back.
//
// Two sources, because two skills write specs: `generate` always has a ticket,
// while a bare `discover` scan has none at all — that is the whole point of
// scanning an app with no tickets. Dropping the line on that path would make a
// generated smoke spec indistinguishable from a hand-authored one.
function provenanceLine({ ticket, origin }) {
  return origin ? `// ${origin}` : `// issue:${ticket}`;
}

function injectProvenanceComment(content, payload) {
  const line = provenanceLine(payload);
  if (content.split('\n', 1)[0].trim() === line) return content;
  return `${line}\n${content}`;
}

// specDir is the already-resolved write target (resolveSpecDir), passed
// through so detectLanguage can fall back to it when nothing is persisted
// for a suite that was never onboarded via e2e-setup — an explicit
// --spec-dir, or one of resolveSpecDir's own fallbacks, can point somewhere
// resolveLocation's own guess never would (#436 review).
function fileExtension(targetPath, specDir) {
  return detect(targetPath, { specDir }).language === 'ts' ? 'ts' : 'js';
}

// A self-identifying tracker string: a positive integer (or its numeric
// string) is a GitHub issue number, an uppercase `ABC-123` key is a Jira
// ticket. Both are accepted, matching how gather-context.mjs and the tests
// hand one in, and both land verbatim in the provenance line above.
function isValidTicket(ticket) {
  if (typeof ticket === 'number') return Number.isInteger(ticket) && ticket > 0;
  if (typeof ticket === 'string') return /^[1-9]\d*$/.test(ticket) || JIRA_KEY_PATTERN.test(ticket);
  return false;
}

// Exactly one of the two, never both and never neither: the provenance line is
// the only record of which run produced a spec, so an ambiguous payload has no
// safe default. A missing one would silently commit `// issue:undefined`.
function provenanceError({ ticket, origin }) {
  const hasTicket = ticket !== undefined;
  const hasOrigin = origin !== undefined;

  if (hasTicket && hasOrigin) {
    return 'payload carries both ticket and origin; give exactly one';
  }
  if (!hasTicket && !hasOrigin) {
    return `payload.ticket or payload.origin ("${DISCOVER_ORIGIN}") is required`;
  }
  if (hasOrigin && origin !== DISCOVER_ORIGIN) {
    return `payload.origin must be "${DISCOVER_ORIGIN}"`;
  }
  if (hasTicket && !isValidTicket(ticket)) {
    return 'payload.ticket must be a positive integer or a Jira key';
  }
  return null;
}

export function writeSpecs(targetPath, payload, options = {}) {
  const { specDir: specDirOption } = options;
  const { ticket, origin, cases } = payload;

  const provenanceProblem = provenanceError(payload);
  if (provenanceProblem) {
    return { status: 'error', message: provenanceProblem };
  }

  if (isWebDirTarget(targetPath)) {
    throw new Error(
      `Target path must be the repo root, not the ${WEB_DIR} sub-package: ${targetPath}. ` +
        `Spec paths are resolved relative to the repo root, so passing ${WEB_DIR} writes to ${WEB_DIR}/${WEB_DIR}/.`,
    );
  }

  const specDir = resolveSpecDir(targetPath, { specDir: specDirOption });
  const specDirAbsolute = join(targetPath, specDir);
  const ext = fileExtension(targetPath, specDir);

  // Page objects first, so a spec that imports one is written after the file
  // it depends on already exists.
  const pageObjectResults = writePageObjects(targetPath, payload.pageObjects, ext);

  const results = [];

  for (const { flowId, slug, smoke, content } of cases) {
    if (!isValidSmokeFlag(smoke)) {
      results.push({ flowId, slug, specPath: null, result: 'refused-invalid-smoke' });
      continue;
    }

    // discover's whole contract is that no file gets the .smoke. infix
    // without a human having picked its path — enforced by discover's own
    // approval gate, which this script cannot see. Requiring smoke === true
    // on every discover-origin case is the backstop: without it, an omitted
    // or false flag would silently write a granular, non-merge-blocking
    // spec and still report it as `created`.
    if (origin === DISCOVER_ORIGIN && smoke !== true) {
      results.push({ flowId, slug, specPath: null, result: 'refused-invalid-smoke' });
      continue;
    }

    // Untrusted input: both components are agent-authored from case titles
    // that trace back to GitHub issue text. Reject anything that isn't a
    // plain kebab-case component before it touches a path — a flowId like
    // "../../../outside" would otherwise escape the spec directory.
    if (!isValidSlug(flowId) || !isValidSlug(slug)) {
      results.push({ flowId, slug, specPath: null, result: 'refused-invalid-slug' });
      continue;
    }

    const specPath = join(specDir, flowId, `${slug}${smokeInfix(smoke)}.spec.${ext}`);
    const absolutePath = join(targetPath, specPath);

    // Belt and suspenders: confirm the resolved path is still under the spec
    // directory even after two valid-looking components.
    if (!isContainedIn(absolutePath, specDirAbsolute)) {
      results.push({ flowId, slug, specPath: null, result: 'refused-invalid-slug' });
      continue;
    }

    // One decision, and it is terminal. There is no --force: a collision is
    // rare, and the human resolves it outside this script by deleting the
    // file or choosing another slug.
    if (existsSync(absolutePath)) {
      results.push({ flowId, slug, specPath, result: 'refused-exists' });
      continue;
    }

    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, injectProvenanceComment(content, payload));
    results.push({ flowId, slug, specPath, result: 'created' });
  }

  return { ...(origin ? { origin } : { ticket }), specDir, results, pageObjectResults };
}

const isMainModule = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const targetPath = process.argv[2] ?? '.';
  const args = process.argv.slice(3);
  const specDirIndex = args.indexOf('--spec-dir');
  const specDir = specDirIndex !== -1 ? args[specDirIndex + 1] : undefined;

  const handleError = (err) => {
    console.log(JSON.stringify({ status: 'error', message: err.message }, null, 2));
    process.exitCode = 0;
  };

  const chunks = [];
  process.stdin.on('data', (chunk) => chunks.push(chunk));
  process.stdin.on('end', () => {
    try {
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      console.log(JSON.stringify(writeSpecs(targetPath, payload, { specDir }), null, 2));
    } catch (err) {
      handleError(err);
    }
  });
  process.stdin.on('error', handleError);
}
