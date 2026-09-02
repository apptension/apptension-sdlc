import { existsSync, readFileSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { detect } from '../../e2e-setup/scripts/detect.mjs';

export function selectSpecs(targetPath, specPaths) {
  const runnable = [];
  const missing = [];
  for (const specPath of specPaths) {
    if (existsSync(join(targetPath, specPath))) runnable.push(specPath);
    else missing.push(specPath);
  }
  return { runnable, missing };
}

// Root ('.') is a prefix of every spec path, so a repo-root install still
// wins when the specs don't live under any workspace. Deepest match wins.
function prefixesPath(locationPath, specPath) {
  if (locationPath === '.') return true;
  return specPath === locationPath || specPath.startsWith(`${locationPath}/`);
}

export function resolveLocation(detected, specPaths, location) {
  const withPlaywright = detected.locations.filter((entry) => entry.playwright?.installed);

  if (location) {
    const target = withPlaywright.find((entry) => entry.path === location);
    return target ? { status: 'resolved', location: target.path } : { status: 'no-playwright' };
  }

  if (withPlaywright.length === 0) return { status: 'no-playwright' };
  if (withPlaywright.length === 1) return { status: 'resolved', location: withPlaywright[0].path };

  // Every spec has to be under the location, or the positional filters the
  // runner is handed would point outside its own root.
  const nested = withPlaywright
    .filter((entry) => specPaths.every((specPath) => prefixesPath(entry.path, specPath)))
    .sort((a, b) => b.path.length - a.path.length);
  if (nested.length > 0) return { status: 'resolved', location: nested[0].path };

  return { status: 'ambiguous', candidates: withPlaywright.map((entry) => entry.path) };
}

const EXEC_FORMS = {
  npm: ['npm', ['exec', '--', 'playwright', 'test']],
  pnpm: ['pnpm', ['exec', 'playwright', 'test']],
  yarn: ['yarn', ['playwright', 'test']],
  bun: ['bun', ['x', 'playwright', 'test']],
};

// The two re-run/scope flags Playwright ships. `lastFailed` re-runs only the
// previous run's failures (reads <outputDir>/.last-run.json). `onlyChanged` is
// tri-state: false is off, true restricts to uncommitted changes, and a string
// restricts to files changed between HEAD and that git ref
// (`--only-changed=<ref>`). Both narrow the positional spec set further, they
// never widen it.
export function runnerFlags({ lastFailed = false, onlyChanged = false } = {}) {
  const flags = [];
  if (lastFailed) flags.push('--last-failed');
  if (onlyChanged === true) flags.push('--only-changed');
  else if (typeof onlyChanged === 'string' && onlyChanged.length > 0) flags.push(`--only-changed=${onlyChanged}`);
  return flags;
}

// No --retries: whatever the target repo's config has in effect is what applies.
// json,html not json: a CLI --reporter *replaces* the config's reporters, so a
// bare json would suppress the HTML report the scaffold configures. json feeds
// this script; html stays for the human.
export function runnerCommand(packageManager, specPaths, flags = {}) {
  const [command, prefix] = EXEC_FORMS[packageManager] ?? ['npx', ['playwright', 'test']];
  return [command, [...prefix, ...specPaths, ...runnerFlags(flags), '--reporter=json,html']];
}

// --list loads and compiles the spec modules without running them or touching
// the app. A syntax error or bad import surfaces here as a non-zero exit with
// the error on stderr, so validate-specs can gate on it before the app-driving
// run below is ever reached. No reporter override: --list forces Playwright's
// list reporter regardless, and a JSON reporter would be ignored.
export function listCommand(packageManager, specPaths) {
  const [command, prefix] = EXEC_FORMS[packageManager] ?? ['npx', ['playwright', 'test']];
  return [command, [...prefix, ...specPaths, '--list']];
}

// Playwright nests one `suites` level per describe block, and a nested spec may
// omit `file` — so the enclosing suite's file is carried down.
function collectSpecs(suite, out, inheritedFile) {
  const file = suite.file ?? inheritedFile;
  for (const spec of suite.specs ?? []) out.push({ ...spec, file: spec.file ?? file });
  for (const child of suite.suites ?? []) collectSpecs(child, out, file);
}

export function flattenSpecs(jsonReport) {
  const out = [];
  for (const suite of jsonReport.suites ?? []) collectSpecs(suite, out, undefined);
  return out;
}

const STATUS_OUTCOMES = { expected: 'passed', flaky: 'flaky', unexpected: 'failed', skipped: 'skipped' };

// `test.status` is the documented outcome and stays correct even when
// expectedStatus is inverted by test.fail(). The derivation is a fallback for
// an older Playwright pinned in the target repo that omits the field.
export function testOutcome(test) {
  const mapped = STATUS_OUTCOMES[test.status];
  if (mapped) return mapped;

  const results = test.results ?? [];
  if (results.length === 0 || results.every((result) => result.status === 'skipped')) return 'skipped';
  if (results.at(-1).status === 'passed') return results.length > 1 ? 'flaky' : 'passed';
  return 'failed';
}

// A hard failure dominates; flakiness next; a partially-skipped case did not
// fully verify, so it outranks passed rather than reading as clean.
const PRECEDENCE = ['failed', 'flaky', 'skipped', 'passed'];

function rollUp(outcomes, fallback = 'not-run') {
  return PRECEDENCE.find((value) => outcomes.includes(value)) ?? fallback;
}

const ANSI_PATTERN = /\[[0-9;]*m/g;
const ERROR_LIMIT = 2000;

export function cleanError(message) {
  const stripped = message.replace(ANSI_PATTERN, '');
  if (stripped.length <= ERROR_LIMIT) return stripped;
  return `${stripped.slice(0, ERROR_LIMIT)}\n… [truncated]`;
}

// For a flaky test the last attempt passed, so the error lives on an earlier
// one — scan for the first attempt that actually recorded an error.
function firstError(results) {
  const withError = results.find((result) => (result.errors ?? []).length > 0);
  const message = withError?.errors?.[0]?.message ?? null;
  return message ? cleanError(message) : null;
}

// The scaffolded fixture attaches this by name on a failing case (see
// scaffold.mjs FIXTURES_BASE): the >=400 responses seen while the case ran.
// It is read back onto the result below, so it is consumed here rather than
// listed among the generic artifacts.
const NETWORK_FAILURES_ATTACHMENT = 'network-failures';
const CONSUMED_ATTACHMENTS = new Set([NETWORK_FAILURES_ATTACHMENT]);

// Cap so a pathological run can't bloat the result: the newest entries win,
// since the tail is what sits closest to the failure.
const MAX_NETWORK_FAILURES = 50;

// Playwright already wrote the trace/screenshot/video into test-results/ and
// names each under a result's `attachments`. Collect them across every attempt
// (deduped by path), skipping ones with no on-disk path (e.g. stdout captures)
// and the one the fixture adds for run-specs to consume, so a failing case
// hands over the evidence instead of leaving it on disk.
function collectArtifacts(test) {
  const seen = new Set();
  const out = [];
  for (const result of test.results ?? []) {
    for (const attachment of result.attachments ?? []) {
      if (!attachment?.path || seen.has(attachment.path) || CONSUMED_ATTACHMENTS.has(attachment.name)) continue;
      seen.add(attachment.path);
      out.push({ name: attachment.name, path: attachment.path });
    }
  }
  return out;
}

// Reads the body of the first attachment named `name` across a test's attempts.
// The fixture attaches via `{ body }`, which Playwright's JSON reporter
// serializes as a base64 `attachment.body` with no `path` — so the body is
// decoded first, and the on-disk `path` is only a fallback (for an older fixture
// that attached a file). An absent or unreadable attachment yields null: the
// signal is best-effort evidence, never a reason to lose the rest of the result.
function readAttachment(test, name) {
  for (const result of test.results ?? []) {
    for (const attachment of result.attachments ?? []) {
      if (attachment?.name !== name) continue;
      if (typeof attachment.body === 'string') return Buffer.from(attachment.body, 'base64').toString('utf8');
      if (attachment.path) {
        try {
          return readFileSync(attachment.path, 'utf8');
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function collectNetworkFailures(test) {
  const body = readAttachment(test, NETWORK_FAILURES_ATTACHMENT);
  if (body === null) return null;
  try {
    const parsed = JSON.parse(body);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed.slice(-MAX_NETWORK_FAILURES);
  } catch {
    return null;
  }
}

function describeFailure(specs, result) {
  for (const spec of specs) {
    for (const test of spec.tests ?? []) {
      if (testOutcome(test) !== result) continue;
      const artifacts = collectArtifacts(test);
      const networkFailures = collectNetworkFailures(test);
      return {
        failingTest: { title: spec.title, location: `${spec.file}:${spec.line}` },
        error: firstError(test.results ?? []),
        ...(artifacts.length > 0 ? { artifacts } : {}),
        ...(networkFailures ? { networkFailures } : {}),
      };
    }
  }
  return null;
}

// Report paths are relative to Playwright's rootDir; runner paths to the
// Playwright location. Neither is guaranteed to be at least as long as the
// other — a rootDir shorter than the location (e.g. rootDir: 'e2e') reports
// files with fewer segments than the runner path, while a monorepo can do
// the opposite. So the match is direction-agnostic: compare trailing
// segments up to the length of whichever side is shorter, and return that
// count — flow directories mean a bare basename is ambiguous
// (auth/login.spec.ts vs admin/login.spec.ts), and a wrong-case result
// reads exactly like a correct one.
export function matchesRunnerPath(reportFile, runnerPath) {
  const reportSegments = String(reportFile ?? '').split(/[\\/]/).filter(Boolean);
  const runnerSegments = String(runnerPath ?? '').split(/[\\/]/).filter(Boolean);
  const length = Math.min(reportSegments.length, runnerSegments.length);
  if (length === 0) return 0;

  for (let index = 1; index <= length; index += 1) {
    if (reportSegments[reportSegments.length - index] !== runnerSegments[runnerSegments.length - index]) return 0;
  }
  return length;
}

// Resolves, for each runnerPath, the best-scoring candidate file(s) among
// `items` (via `getPath`) — same "longest trailing match wins" rule as a
// single lookup. But a low-confidence match (e.g. a bare basename, from a
// rootDir pointing inside one flow directory) can score equally well
// against two DIFFERENT runnerPaths that merely share a basename. A file
// claimed as the best match by more than one runnerPath is ambiguous:
// attributing it to any one of them would silently borrow another
// requested path's result. Every runnerPath gets exactly one resolved path
// back, or none — never a set with more than one, and never a path also
// claimed elsewhere. Exported so validate-specs.mjs's --list and stderr
// matching share the same exclusivity rule instead of a second, divergent
// implementation.
export function resolveExclusiveMatches(items, getPath, runnerPaths) {
  const perPath = runnerPaths.map((runnerPath) => {
    let best = 0;
    const paths = new Set();
    for (const item of items) {
      const score = matchesRunnerPath(getPath(item), runnerPath);
      if (score === 0 || score < best) continue;
      if (score > best) {
        best = score;
        paths.clear();
      }
      paths.add(getPath(item));
    }
    return paths;
  });

  const claimCount = new Map();
  for (const paths of perPath) {
    for (const path of paths) claimCount.set(path, (claimCount.get(path) ?? 0) + 1);
  }

  return perPath.map((paths) => {
    const exclusive = [...paths].filter((path) => (claimCount.get(path) ?? 0) <= 1);
    return exclusive.length === 1 ? exclusive[0] : null;
  });
}

// `filtering` says a re-run/scope flag was handed to Playwright, which omits
// the specs it excluded — so a spec the report never mentions was skipped on
// purpose, not lost to a config or file-load error, and it reports as
// `filtered` instead of `not-run` so a selective re-run isn't gated on it.
// The exception is a report carrying top-level errors: that is positive
// evidence something failed to load, so the absence is no longer attributable
// to the filter and every unmentioned spec stays `not-run`. Without the
// carve-out a broken import under `--last-failed` would read as an intentional
// skip and pass the gate.
export function parseReport(jsonReport, entries, { filtering = false } = {}) {
  const reported = flattenSpecs(jsonReport);
  const resolvedFiles = resolveExclusiveMatches(reported, (spec) => spec.file, entries.map((entry) => entry.runnerPath));
  const unreported = filtering && (jsonReport.errors ?? []).length === 0 ? 'filtered' : 'not-run';

  return entries.map((entry, index) => {
    const resolvedFile = resolvedFiles[index];
    const specs = resolvedFile === null ? [] : reported.filter((spec) => spec.file === resolvedFile);

    const tests = specs.flatMap((spec) => spec.tests ?? []);
    const result = rollUp(tests.map(testOutcome), unreported);
    const attempts = Math.max(0, ...tests.map((test) => (test.results ?? []).length));

    const base = { specPath: entry.specPath, result, attempts };
    if (result === 'passed' || result === 'not-run' || result === 'filtered') return base;
    return { ...base, ...(describeFailure(specs, result) ?? { failingTest: null, error: null }) };
  });
}

// A wall-clock ceiling for the whole runner subprocess (all specs, retries and
// startup together), so a wedged run — or the dev-server-blocks-on-Ctrl-C case
// noted at the run() call below — surfaces instead of hanging until Playwright's
// own internals give up. Ten minutes; override per repo/suite with
// E2E_RUN_SPECS_TIMEOUT_MS.
export const DEFAULT_TIMEOUT_MS = 600000;

export function resolveTimeoutMs(env = process.env) {
  const raw = Number(env.E2E_RUN_SPECS_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

// On timeout execFileSync kills the child and throws an error whose `code` is
// `ETIMEDOUT` (with `signal` SIGTERM and `status` null, but NOT `killed`, which
// stays undefined). A normal Playwright failure throws with a numeric `status`
// and no `code`; a spawn failure carries `ENOENT`. The `ETIMEDOUT` code is the
// only reliable marker separating a wedge from a failed assertion.
export function isTimeout(err) {
  return err?.code === 'ETIMEDOUT';
}

// Node's default execFileSync maxBuffer is 1 MB. A big suite or many failures
// overflow the child's stderr, and it dies with ENOBUFS — whose `code` is not
// `ETIMEDOUT`, so isTimeout() misses it, the JSON report lands half-written,
// and the run reports `report-unreadable` instead of its real result. 64 MB
// sits far above any realistic combined output; the runner writes its JSON to a
// file regardless, so raising the ceiling costs nothing at runtime.
export const MAX_BUFFER = 64 * 1024 * 1024;

// Playwright exits non-zero whenever a test fails — that is the case this script
// exists to report, so a non-zero exit is captured, not thrown.
export function defaultRun(command, args, options) {
  try {
    execFileSync(command, args, { encoding: 'utf8', maxBuffer: MAX_BUFFER, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    return { stderr: '' };
  } catch (err) {
    // A real test failure populates err.stderr. A spawn-level failure (e.g. the
    // package manager binary missing from PATH) leaves it empty, so fall back
    // to err.message rather than losing that diagnosis entirely.
    const stderr = err.stderr || err.message || '';
    if (isTimeout(err)) return { stderr, timedOut: true };
    return { stderr };
  }
}

export function tail(text, lines = 20) {
  return text.split('\n').filter((line) => line.length > 0).slice(-lines);
}

// Playwright's positional filters are matched against paths relative to its own
// cwd, while spec paths are relative to the target repo root.
export function toRunnerPath(targetPath, locationAbsolute, specPath) {
  return relative(locationAbsolute, join(targetPath, specPath)).split(sep).join('/');
}

function missingResult(specPath) {
  return { specPath, result: 'missing', attempts: 0 };
}

export function runSpecs(targetPath, specPaths, options = {}) {
  const { run = defaultRun, location, lastFailed = false, onlyChanged = false } = options;

  // An empty positional-args list would make Playwright run its whole
  // configured suite instead of erroring — exactly what must never happen.
  // This is what the removed `no-specs` status used to guard.
  if (!Array.isArray(specPaths) || specPaths.length === 0) {
    return { status: 'error', message: 'No spec paths given. Usage: run-specs.mjs <target path> <spec path>… [--location <rel>]' };
  }

  const { runnable, missing } = selectSpecs(targetPath, specPaths);

  const detected = detect(targetPath);
  const resolved = resolveLocation(detected, specPaths, location);
  if (resolved.status !== 'resolved') return { ...resolved, specPaths };

  const locationAbsolute = resolved.location === '.' ? targetPath : join(targetPath, resolved.location);
  const base = { location: resolved.location };

  if (runnable.length === 0) {
    return { status: 'ran', ...base, results: missing.map(missingResult) };
  }

  const entries = runnable.map((specPath) => ({
    specPath,
    runnerPath: toRunnerPath(targetPath, locationAbsolute, specPath),
  }));
  const [command, args] = runnerCommand(detected.packageManager, entries.map((entry) => entry.runnerPath), {
    lastFailed,
    onlyChanged,
  });
  // Read off runnerFlags rather than re-tested here, so the two can't drift:
  // an `onlyChanged` of '' sends no flag, so it is not a filter either.
  const filtering = runnerFlags({ lastFailed, onlyChanged }).length > 0;

  const reportDir = mkdtempSync(join(tmpdir(), 'e2e-run-specs-'));
  const reportPath = join(reportDir, 'report.json');
  // Pin the html output dir, don't read it: the reporter honours an inherited
  // PLAYWRIGHT_HTML_OUTPUT_DIR, so forcing a known one is what keeps the path
  // reported below in step with where the report actually lands.
  const htmlReport = join(locationAbsolute, 'playwright-report');
  const timeoutMs = resolveTimeoutMs();
  try {
    const { stderr, timedOut } = run(command, args, {
      cwd: locationAbsolute,
      // Time-box the whole run: a wedged spec or a dev server that never
      // returns gets killed and reported, rather than hanging silently.
      timeout: timeoutMs,
      // A file, not stdout: the app under test shares that stream.
      // PLAYWRIGHT_HTML_OPEN=never: the html reporter defaults to
      // open:'on-failure', which on a local failing run starts the report
      // server and blocks on Ctrl-C — execFileSync would never return, and
      // app cleanup would never run. Opening is left to `show-report`.
      env: {
        ...process.env,
        PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath,
        PLAYWRIGHT_HTML_OPEN: 'never',
        PLAYWRIGHT_HTML_OUTPUT_DIR: htmlReport,
      },
    });

    // A wedged run has no usable report — report the timeout as its own status
    // so the caller and the human can tell it from a failed assertion.
    if (timedOut) {
      return {
        status: 'timed-out',
        ...base,
        timeoutMs,
        message: `Test run exceeded the ${timeoutMs}ms timeout and was terminated (likely a wedged run or dev server).`,
        stderrTail: tail(stderr),
      };
    }

    let jsonReport = null;
    if (existsSync(reportPath)) {
      try {
        jsonReport = JSON.parse(readFileSync(reportPath, 'utf8'));
      } catch {
        jsonReport = null;
      }
    }
    // An unparseable report is not a passing run — surface it instead of
    // returning an empty results array that reads like nothing was wrong.
    if (jsonReport === null) {
      return { status: 'report-unreadable', ...base, stderrTail: tail(stderr) };
    }

    const parsed = new Map(parseReport(jsonReport, entries, { filtering }).map((entry) => [entry.specPath, entry]));
    const results = specPaths.map((specPath) => parsed.get(specPath) ?? missingResult(specPath));

    // A case comes back `not-run` when Playwright never reported any test for its
    // file at all — the same symptom a config or file-load error produces. Surface
    // the report's own top-level errors and the runner's stderr so that case isn't
    // a diagnostic dead end.
    const reportErrors = (jsonReport.errors ?? [])
      .map((entry) => entry?.message)
      .filter((message) => typeof message === 'string' && message.length > 0)
      .map(cleanError);
    const diagnostics =
      results.some((entry) => entry.result === 'not-run') && (reportErrors.length > 0 || stderr)
        ? { reportErrors, stderrTail: tail(stderr) }
        : {};

    // htmlReport (pinned above) is named on every real run so the human can
    // open it after a failure.
    return { status: 'ran', ...base, htmlReport, results, ...diagnostics };
  } finally {
    rmSync(reportDir, { recursive: true, force: true });
  }
}

// The CLI's argv shape. `--location <rel>` takes a following value; the two
// re-run/scope flags are recognised without one. `--only-changed` alone means
// uncommitted changes; `--only-changed=<ref>` scopes to a git ref — the `=`
// form is the only one accepted so the ref can never be mistaken for a spec
// path. Positional args are the spec paths, and every `--`-prefixed token
// (both flag forms of --only-changed included) is filtered out of them, so a
// flag can never leak into the runner's positional filter.
const ONLY_CHANGED_PREFIX = '--only-changed=';

export function parseRunSpecsArgs(args) {
  const locationIndex = args.indexOf('--location');
  const location = locationIndex !== -1 ? args[locationIndex + 1] : undefined;
  const lastFailed = args.includes('--last-failed');
  const onlyChangedArg = args.find((arg) => arg === '--only-changed' || arg.startsWith(ONLY_CHANGED_PREFIX));
  const onlyChanged =
    onlyChangedArg === undefined ? false : onlyChangedArg === '--only-changed' ? true : onlyChangedArg.slice(ONLY_CHANGED_PREFIX.length);
  const specPaths = args.filter(
    (arg, index) => !arg.startsWith('--') && !(locationIndex !== -1 && index === locationIndex + 1),
  );
  return { location, lastFailed, onlyChanged, specPaths };
}

const isMainModule = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const targetPath = process.argv[2] ?? '.';
  const { location, lastFailed, onlyChanged, specPaths } = parseRunSpecsArgs(process.argv.slice(3));

  try {
    console.log(JSON.stringify(runSpecs(targetPath, specPaths, { location, lastFailed, onlyChanged }), null, 2));
  } catch (err) {
    console.log(JSON.stringify({ status: 'error', message: err.message }, null, 2));
    process.exitCode = 0;
  }
}
