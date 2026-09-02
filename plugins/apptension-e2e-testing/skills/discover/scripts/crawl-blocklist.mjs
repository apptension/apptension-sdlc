import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveLocation, WEB_DIR } from '../../e2e-setup/scripts/manifest.mjs';

// The blocklist's filename, at the suite location (the persisted manifest's
// `location`, e2e/web by default) — never a hardcoded path, so a suite
// scaffolded somewhere other than e2e/web still gets its blocklist read.
export const BLOCKLIST_FILENAME = 'crawl-blocklist.json';

// Kept for callers (and fixtures) that still want the default-location path.
// Target-relative, and deliberately not under .e2e-testing/: step 3 appends
// that directory's entries to the target's .gitignore, and a blocklist is
// configuration a repo commits, not per-run state.
export const BLOCKLIST_FILE = join(WEB_DIR, BLOCKLIST_FILENAME);

// The irreversible set an exploring agent has no other reason to avoid.
// Broad on purpose: a false skip costs one unexplored control, a false click
// costs a row in someone's database.
export const DEFAULT_BLOCKLIST = [
  'delete',
  'remove',
  'deactivate',
  'cancel subscription',
  'cancel plan',
  'downgrade',
  'transfer ownership',
  'send invite',
  'invite',
  'unsubscribe',
  'revoke',
  'reset',
];

function normalize(value) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

// Reads the target's file if there is one. Repo patterns are added to the
// bundled set and never replace it, so no target repo can turn the blocklist
// off by writing a file. A malformed file is an error rather than a silent
// fall back to the defaults: the repo tried to say which controls are
// dangerous here, and ignoring that would run the crawl under a list its
// owner does not think is in force.
export function resolveBlocklist(targetPath, options = {}) {
  const location = resolveLocation(targetPath, options);
  const path = join(targetPath, location, BLOCKLIST_FILENAME);
  const bundled = DEFAULT_BLOCKLIST.length;

  if (!existsSync(path)) {
    return { status: 'ok', patterns: [...DEFAULT_BLOCKLIST], bundled, added: 0, source: null };
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return { status: 'invalid', error: `not valid JSON: ${error.message}`, path };
  }

  const blocked = parsed?.blocked;
  if (!Array.isArray(blocked)) {
    return { status: 'invalid', error: '"blocked" must be an array of strings', path };
  }
  if (blocked.some((entry) => typeof entry !== 'string' || normalize(entry) === '')) {
    return { status: 'invalid', error: 'every "blocked" entry must be a non-empty string', path };
  }

  // Dedupe on coverage rather than on the literal string, using the same
  // matcher the crawl uses: "Delete account" is already blocked by "delete",
  // so adding it widens nothing. That keeps `added` an honest count of how
  // much the repo's file actually extends the list.
  const patterns = [...DEFAULT_BLOCKLIST];
  for (const entry of blocked.map(normalize)) {
    if (!matchBlocklist(entry, patterns)) patterns.push(entry);
  }

  return { status: 'ok', patterns, bundled, added: patterns.length - bundled, source: path };
}

// Substring match on the normalized accessible name. Accessible names come
// off the page with whatever case and spacing the app uses, so both sides are
// normalized before comparing. An unnamed control never matches — the crawl's
// structural rules, not this list, are what keep it away from those.
export function matchBlocklist(name, patterns) {
  if (typeof name !== 'string') return null;
  const candidate = normalize(name);
  if (candidate === '') return null;
  return patterns.find((pattern) => candidate.includes(normalize(pattern))) ?? null;
}

const isMainModule =
  process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const targetPath = process.argv[2] ?? '.';
  console.log(JSON.stringify(resolveBlocklist(targetPath), null, 2));
}
