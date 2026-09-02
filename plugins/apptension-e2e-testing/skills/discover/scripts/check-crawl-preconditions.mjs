import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from '../../e2e-setup/scripts/web-server.mjs';
import { defaultProbe, normalizeUrl } from '../../generate/scripts/resolve-app-url.mjs';
import { targetAuthPath } from '../../generate/scripts/resolve-storage-state.mjs';
import { resolveLocation } from '../../e2e-setup/scripts/manifest.mjs';
import { resolveBlocklist } from './crawl-blocklist.mjs';

// Same source and same normalization as resolve-app-url's own read, so the
// crawl and the spec runs agree on what the app's URL is. A copy of the env
// is loaded into, never the caller's object: loadEnvFile mutates what it is
// given, and a check has no business writing the caller's environment.
async function checkBaseUrl(root, env, probe, webDir) {
  const merged = loadEnvFile(join(root, webDir), { ...env });
  const raw = merged.E2E_BASE_URL?.trim();
  if (!raw) {
    return {
      url: null,
      check: {
        id: 'base-url',
        ok: false,
        detail: `E2E_BASE_URL is not set — checked the environment and ${webDir}/.env`,
      },
    };
  }

  // The protocol check is not belt-and-braces: new URL('localhost:3000')
  // parses happily, with "localhost:" as the scheme and "3000" as the path.
  // A dropped http:// is the ordinary way this value is written wrong, and
  // without this it would reach the browser as a URL it cannot open.
  let url;
  try {
    url = normalizeUrl(raw);
    if (!/^https?:$/.test(new URL(url).protocol)) throw new Error('not http(s)');
  } catch {
    return {
      url: null,
      check: {
        id: 'base-url',
        ok: false,
        detail: `E2E_BASE_URL is not a usable http(s) URL: "${raw}"`,
      },
    };
  }

  // A parseable URL is not a running app. This step runs before step 4 boots
  // one, so a configured-but-stopped app must not read as ready: the crawl
  // sub-agent would otherwise be dispatched to navigate against a dead URL
  // for no result. Same probe resolve-app-url uses to detect an
  // already-running app.
  if (!(await probe(url))) {
    return {
      url: null,
      check: {
        id: 'base-url',
        ok: false,
        detail: `no app answered at ${url} — start it, or let step 4 boot it first`,
      },
    };
  }

  return { url, check: { id: 'base-url', ok: true, detail: `E2E_BASE_URL=${url}` } };
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

// A cookie Playwright can actually restore needs a name, a value, and a
// scope to attach to — either "url", or "domain" plus "path". Without a
// scope browser_set_storage_state has nowhere to put the cookie, so
// name/value alone are not enough even though they look like a cookie.
// Every other field (expires, httpOnly, secure, sameSite, ...) is something
// Playwright itself always writes, so a hand-truncated or corrupted file is
// still caught without re-implementing its full cookie schema here.
function isRestorableCookie(cookie) {
  if (cookie === null || typeof cookie !== 'object') return false;
  if (!nonEmptyString(cookie.name) || typeof cookie.value !== 'string') return false;
  return nonEmptyString(cookie.url) || (nonEmptyString(cookie.domain) && nonEmptyString(cookie.path));
}

function isRestorableLocalStorageEntry(entry) {
  return (
    entry !== null &&
    typeof entry === 'object' &&
    typeof entry.name === 'string' &&
    typeof entry.value === 'string'
  );
}

function isRestorableOrigin(origin) {
  return (
    origin !== null &&
    typeof origin === 'object' &&
    typeof origin.origin === 'string' &&
    Array.isArray(origin.localStorage) &&
    origin.localStorage.every(isRestorableLocalStorageEntry)
  );
}

// The saved login #285 already starts the MCP session from. Absent, this is a
// refusal rather than the logged-out fallback verification accepts: an
// unauthenticated crawl of an authenticated app produces one candidate, the
// login page, which is worse than no crawl because it looks like a result.
//
// existsSync alone is not enough: it is true for a directory, and for a file
// containing garbage or unrelated JSON. browser_set_storage_state cannot load
// any of those, so this validates the file is actually a Playwright storage
// state — cookies and origins with the fields Playwright needs to restore
// them — before reporting ready. It also refuses an empty-but-valid state
// ({"cookies":[],"origins":[]}, the same shape as the bundled logged-out
// fallback): a first-time auth.setup.ts run whose login silently failed
// produces exactly that shape, and running the crawl against it is the
// logged-out failure this precondition exists to catch. This is a shape
// check, not a full replay: it does not open a browser to confirm the
// session is still valid server-side, since that would duplicate what the
// crawl sub-agent's own first navigation already verifies.
function checkAuthState(root, webDir) {
  const authPath = targetAuthPath(root, { location: webDir });
  const relativePath = relative(root, authPath);
  const refuse = (reason) => ({
    id: 'auth-state',
    ok: false,
    detail: `${relativePath} ${reason} — run the setup skill's auth.setup.ts first`,
  });

  if (!existsSync(authPath)) return refuse('does not exist');
  if (!statSync(authPath).isFile()) return refuse('is not a file');

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(authPath, 'utf8'));
  } catch {
    return refuse('is not valid JSON');
  }
  if (!Array.isArray(parsed?.cookies) || !Array.isArray(parsed?.origins)) {
    return refuse('is not a Playwright storage state (missing "cookies"/"origins")');
  }
  if (!parsed.cookies.every(isRestorableCookie)) {
    return refuse('has a cookie missing "name"/"value" or a "url"/"domain"+"path" scope');
  }
  if (!parsed.origins.every(isRestorableOrigin)) {
    return refuse('has an origin missing "origin"/"localStorage"');
  }
  if (parsed.cookies.length === 0 && parsed.origins.length === 0) {
    return refuse('has no cookies or origin storage — looks logged out, not signed in');
  }

  return { id: 'auth-state', ok: true, detail: relativePath };
}

function checkBlocklist(root, webDir) {
  const resolved = resolveBlocklist(root, { location: webDir });
  if (resolved.status !== 'ok') {
    return {
      patterns: [],
      check: { id: 'blocklist', ok: false, detail: `${relative(root, resolved.path)}: ${resolved.error}` },
    };
  }
  const detail =
    resolved.added > 0
      ? `${resolved.patterns.length} patterns (${resolved.bundled} bundled, ${resolved.added} from ${relative(root, resolved.source)})`
      : `${resolved.bundled} bundled patterns`;
  return { patterns: resolved.patterns, check: { id: 'blocklist', ok: true, detail } };
}

// The three preconditions a machine can check. The fourth — a human
// confirming this environment is safe to click through — is reported here and
// never satisfied here: humanConfirmation.inferable is false for every URL
// this ever resolves, localhost and staging included, because people do run
// staging against production data. machineReady means the three checks pass
// and the human gate is still open. It never means go.
export async function checkCrawlPreconditions(targetPath, options = {}) {
  const { env = process.env, probe = defaultProbe } = options;
  const root = resolve(targetPath);
  // The suite location — where the suite's .env and .auth live — never an app
  // --location: this function has no app-selection concern of its own.
  const webDir = resolveLocation(root, {});

  const baseUrl = await checkBaseUrl(root, env, probe, webDir);
  const authState = checkAuthState(root, webDir);
  const blocklist = checkBlocklist(root, webDir);

  const checks = [baseUrl.check, authState, blocklist.check];

  return {
    machineReady: checks.every((entry) => entry.ok),
    baseUrl: baseUrl.url,
    checks,
    humanConfirmation: { required: true, inferable: false },
    blocklist: blocklist.patterns,
  };
}

const isMainModule =
  process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const targetPath = process.argv[2] ?? '.';
  checkCrawlPreconditions(targetPath).then((result) => {
    console.log(JSON.stringify(result, null, 2));
  });
}
