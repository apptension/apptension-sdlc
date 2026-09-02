import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect, resolvePackageManager, STANDALONE_WEB_DIR } from './detect.mjs';
import { WEB_DIR, resolveLocation, rootRelativeCwd } from './manifest.mjs';

// Playwright resolves a relative webServer.cwd against the config's own
// directory. `suiteLocation` is where that config actually lives (default
// e2e/web) — a repo-root-relative app location has to climb back out of the
// suite location before descending again, and the climb's depth depends on
// how deep the suite itself is nested.
export function configRelativeCwd(locationPath, suiteLocation = WEB_DIR) {
  const depth = rootRelativeCwd(suiteLocation);
  if (locationPath === '.') return depth;
  return depth === '.' ? locationPath : `${depth}/${locationPath}`;
}

// All four supported managers accept `<pm> run <script>` (both yarn classic and
// berry do), so one form covers them rather than a per-manager table.
export function runScriptCommand(packageManager, script) {
  return `${packageManager ?? 'npm'} run ${script}`;
}

const ENV_LINE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

// Fill `env` from a sibling .env, skipping any key already present, so an
// exported shell var or a CI secret always wins over the file. The generated
// playwright.config.ts carries an equivalent inline snippet — it is emitted as
// source text into a repo this plugin doesn't control at runtime, so it cannot
// import this. scaffold.test.ts pins that text so the two stay deliberate.
export function loadEnvFile(dir, env = process.env) {
  const path = join(dir, '.env');
  if (!existsSync(path)) return env;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.trim().match(ENV_LINE);
    if (match && !(match[1] in env)) env[match[1]] = match[2];
  }
  return env;
}

function selectLocation(report, location) {
  if (location) {
    const target = report.locations.find((entry) => entry.path === location);
    return target ? [target] : [];
  }
  return report.locations;
}

// Two different strengths, and the difference is the point.
//
// `mobile` is a veto: an Expo/React Native package does not serve the browser
// under test, so it is dropped outright — booting Metro because it happened to
// be the only sibling with a `start` script is the failure this exists to stop.
// A repo whose only runnable package is mobile therefore reports
// no-start-command, which is honest: there is no web app here to boot.
//
// `web` is only a preference: among what survives the veto, entries carrying a
// web signal win when there are any, and otherwise the list is returned whole.
// Vetoing on a missing web signal instead would break a repo whose stack this
// heuristic does not recognise, and one whose web package has no dev script of
// its own while the root does.
function preferWebLocations(entries) {
  const notMobile = entries.filter((entry) => !entry.mobile);
  const web = notMobile.filter((entry) => entry.web);
  return web.length > 0 ? web : notMobile;
}

// Narrowing for the boot question, which has to look past the runnable set to
// get right. The start-script filter runs first — a location that cannot start
// cannot be the webServer — and that filter can drop the web app itself, at
// which point preferring "web among what is left" prefers among the wrong
// candidates: with a script-less `apps/web` and an `apps/api` that answers
// `start`, it resolves the backend, so the suite boots an API while the specs
// were written against the frontend.
//
// So when the repo declares a web location and none of the runnable ones is it,
// only the repo root may stand in. The root plausibly orchestrates the web
// app's dev server (`turbo dev`, a root `dev` script); a sibling app
// definitively does not. With no root script either, no-start-command is the
// answer, and it is the right one — there is nothing here that boots the app.
function bootableWebLocations(runnable, allLocations) {
  const notMobile = runnable.filter((entry) => !entry.mobile);
  const web = notMobile.filter((entry) => entry.web);
  if (web.length > 0) return web;
  if (!allLocations.some((entry) => entry.web)) return notMobile;
  return notMobile.filter((entry) => entry.path === '.');
}

// Which location starts the app under test, rendered as the two values the
// webServer block needs. Filtering on startCommand after selectLocation means an
// explicit --location naming a package with no start script reports
// no-start-command rather than resolving to an undefined script.
export function resolveWebServer(report, options = {}) {
  const { location, suiteLocation = WEB_DIR } = options;
  const selected = selectLocation(report, location).filter((entry) => entry.startCommand);
  // An explicit --location is the human's call and outranks the classification,
  // so a deliberate `--location apps/mobile` still resolves.
  const runnable = location ? selected : bootableWebLocations(selected, report.locations);

  if (runnable.length === 0) return { status: 'no-start-command' };
  if (runnable.length > 1) {
    return { status: 'ambiguous', candidates: runnable.map((entry) => entry.path) };
  }

  const target = runnable[0];
  const packageManager = resolvePackageManager(report) ?? 'npm';
  return {
    status: 'resolved',
    location: target.path,
    command: runScriptCommand(packageManager, target.startCommand),
    cwd: configRelativeCwd(target.path, suiteLocation),
    // Carried through from detect(), so env resolution can build a base URL
    // without running detection a second time. null when nothing answered.
    port: target.port ?? null,
    // Whether that port is authoritative (an explicit flag / vite preview) or a
    // framework default, and whether the framework reads an exported PORT — the
    // two facts deriveBaseUrl needs to rank an exported PORT correctly.
    portFromCommand: target.portFromCommand ?? false,
    portFromConfig: target.portFromConfig ?? false,
    consumesPort: target.consumesPort ?? false,
    packageManager,
  };
}

// Which directory holds the app to *read*, as distinct from how to boot it.
//
// Reading an app's routes needs a directory and nothing else: no dev script, no
// running server. So this deliberately does not filter on `startCommand`, and
// that is the whole reason it is a second resolver rather than a call to
// resolveWebServer. Gating a code scan on a bootable webServer would stop two
// repos this plugin fully supports — one booted by a custom
// E2E_WEB_SERVER_COMMAND, which declares no dev/start/serve script of its own,
// and one whose app is already running when the scan starts.
//
// The candidate narrowing is otherwise the same as resolveWebServer's, so the
// two agree on which directory is the app wherever both can answer.
// detect() probes the repo root unconditionally, so it is always a candidate.
// In a monorepo it is usually a metadata-only orchestrator rather than an app,
// and it has no classification to rule it out: a root holding prettier and a
// release script looks exactly like a root holding an unrecognised web app.
//
// So it stands down as soon as any *other* location is classified — that is the
// evidence that this repo's apps live in subdirectories. Without it, an
// Expo-only monorepo resolves the repo root and a discover run scans it, which
// is how a React Native screen became a proposed user path to begin with. It
// stays when nothing else is classified, which covers the single-app repo and
// the repo whose stack these signals do not recognise.
function dropOrchestratorRoot(entries) {
  const classifiedSibling = entries.some((entry) => entry.path !== '.' && (entry.web || entry.mobile));
  return classifiedSibling ? entries.filter((entry) => entry.path !== '.') : entries;
}

export function resolveScanLocation(report, options = {}) {
  const { location, suiteLocation = WEB_DIR } = options;
  // The persisted suite location is exactly as much a non-app package as the
  // default e2e/web — a custom suite at e.g. services/e2e must not become a
  // scan candidate any more than e2e/web does, or a repo with one real app
  // reports ambiguous between the app and its own test suite. Discovery
  // (run/validate) still has to find that suite; only app *selection* excludes it.
  const known = report.locations.filter(
    (entry) => entry.path !== STANDALONE_WEB_DIR && entry.path !== suiteLocation,
  );

  if (location) {
    // An explicit location is the human's answer to exactly this question, so
    // it needs no start script and outranks the classification. It still has to
    // name a directory detection actually found — a typo must not resolve.
    return known.some((entry) => entry.path === location)
      ? { status: 'resolved', location }
      : { status: 'unknown-location', candidates: known.map((entry) => entry.path) };
  }

  // resolveWebServer excludes the scaffolded e2e/web package incidentally,
  // because it only ever holds test:e2e scripts. With no start-script filter
  // here, this resolver has to exclude it outright — hence `known` above.
  const candidates = preferWebLocations(dropOrchestratorRoot(known));
  if (candidates.length === 0) return { status: 'no-web-app' };
  if (candidates.length > 1) {
    return { status: 'ambiguous', candidates: candidates.map((entry) => entry.path) };
  }
  return { status: 'resolved', location: candidates[0].path };
}

const isMainModule = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const targetPath = process.argv[2] ?? '.';
    const index = process.argv.indexOf('--location');
    const location = index !== -1 ? process.argv[index + 1] : undefined;
    const resolve = process.argv.includes('--scan-location') ? resolveScanLocation : resolveWebServer;
    const options = { location, suiteLocation: resolveLocation(targetPath, {}) };
    console.log(JSON.stringify(resolve(detect(targetPath), options), null, 2));
  } catch (err) {
    // detect() is called bare here, so a malformed package.json anywhere in the
    // workspace throws. Match detect.mjs's own main: an error envelope on
    // stdout, exit 0 — never a raw stack.
    console.log(JSON.stringify({ status: 'error', message: err.message }, null, 2));
    process.exitCode = 0;
  }
}
