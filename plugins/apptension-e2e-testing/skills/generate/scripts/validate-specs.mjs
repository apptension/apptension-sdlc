import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { detect } from '../../e2e-setup/scripts/detect.mjs';
import {
  selectSpecs,
  resolveLocation,
  listCommand,
  toRunnerPath,
  resolveExclusiveMatches,
  cleanError,
  tail,
} from './run-specs.mjs';

// --list exits non-zero on a load error and writes the failure to stderr; a
// clean listing exits zero and names every loaded file on stdout, which is read
// back to confirm each requested spec actually made it into the run.
function defaultRun(command, args, options) {
  try {
    const stdout = execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
    return { stdout, stderr: '', ok: true, spawnFailed: false };
  } catch (err) {
    // A process that ran and exited non-zero sets err.status to the exit code; a
    // spawn-level failure (the package-manager binary missing) leaves status
    // non-numeric and puts the reason on err.message. The first is a spec load
    // error to attribute; the second is infrastructure, not a broken spec.
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || err.message || '',
      ok: false,
      spawnFailed: typeof err.status !== 'number',
    };
  }
}

// Each --list test line is `[project] › file:line:col › title…`, so only the
// `file:line:col` location counts — a title mentioning a filename must not
// pass a spec that was never listed. Paths, not basenames: flow directories
// make a basename ambiguous.
function listedPaths(stdout) {
  const paths = new Set();
  const line = /(?:›\s+|^\s+)([^›\n]+?):\d+:\d+(?=\s+›)/gm;
  let match;
  while ((match = line.exec(stdout)) !== null) paths.add(match[1].trim());
  return [...paths];
}

// --list prints paths relative to Playwright's rootDir (typically the
// configured testDir), which can strip a leading segment (e.g. "e2e/") that
// runnerPath — relative to the cwd the runner was invoked from — still
// carries, or add one in a monorepo. A bare basename (rootDir pointing
// inside one flow directory) can equally satisfy two different requested
// paths sharing that basename, so listings are resolved exclusively across
// every entry at once — the same rule parseReport uses — rather than each
// entry independently asking "was any of this listed for me."
function resolveListed(paths, entries) {
  const resolved = resolveExclusiveMatches(
    paths.map((path) => ({ path })),
    (item) => item.path,
    entries.map((entry) => entry.runnerPath),
  );
  return new Map(entries.map((entry, index) => [entry.specPath, resolved[index] !== null]));
}

// Playwright writes one stderr block per failing file (onError → blank-line
// separated), and a block can name a file with the same shorter/longer
// ambiguity as --list output. Resolve every entry's best-matching block
// exclusively across the whole set — a bare-basename block must never
// attribute to two different entries sharing that basename.
function attributeErrors(stderr, entries) {
  const blocks = stderr.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  const candidates = blocks.flatMap((block) => listedPathsInBlock(block).map((path) => ({ block, path })));
  const resolvedPaths = resolveExclusiveMatches(
    candidates,
    (candidate) => candidate.path,
    entries.map((entry) => entry.runnerPath),
  );

  const bySpec = new Map();
  entries.forEach((entry, index) => {
    const resolvedPath = resolvedPaths[index];
    if (resolvedPath === null) return;
    const matchedBlocks = [...new Set(candidates.filter((c) => c.path === resolvedPath).map((c) => c.block))];
    bySpec.set(entry.specPath, cleanError(matchedBlocks.join('\n\n')));
  });
  return bySpec;
}

// A stderr block names its file as a bare path, not as a --list location, so
// pull out every path-shaped token and let resolveExclusiveMatches judge them.
function listedPathsInBlock(block) {
  return block.match(/[\w./\\-]+\.spec\.[a-z]+/g) ?? [];
}

export function validateSpecs(targetPath, specPaths, options = {}) {
  const { run = defaultRun, location } = options;

  // Same trap run-specs guards: an empty positional-args list would make
  // Playwright list the repo's whole configured suite.
  if (!Array.isArray(specPaths) || specPaths.length === 0) {
    return { status: 'error', message: 'No spec paths given. Usage: validate-specs.mjs <target path> <spec path>… [--location <rel>]' };
  }

  const { runnable, missing } = selectSpecs(targetPath, specPaths);

  const detected = detect(targetPath);
  const resolved = resolveLocation(detected, specPaths, location);
  if (resolved.status !== 'resolved') return { ...resolved, specPaths };

  const locationAbsolute = resolved.location === '.' ? targetPath : join(targetPath, resolved.location);
  const base = { status: 'validated', location: resolved.location };

  const bySpec = new Map();
  for (const specPath of missing) bySpec.set(specPath, { specPath, result: 'missing' });

  if (runnable.length === 0) {
    return { ...base, results: specPaths.map((specPath) => bySpec.get(specPath)) };
  }

  const entries = runnable.map((specPath) => ({
    specPath,
    runnerPath: toRunnerPath(targetPath, locationAbsolute, specPath),
  }));
  const [command, args] = listCommand(detected.packageManager, entries.map((entry) => entry.runnerPath));
  const { stdout, stderr, ok, spawnFailed } = run(command, args, { cwd: locationAbsolute });

  if (spawnFailed) {
    return { status: 'error', location: resolved.location, message: cleanError(stderr) };
  }

  if (ok) {
    const listed = resolveListed(listedPaths(stdout), entries);
    for (const entry of entries) {
      bySpec.set(entry.specPath, {
        specPath: entry.specPath,
        result: listed.get(entry.specPath) ? 'valid' : 'not-listed',
      });
    }
    return { ...base, results: specPaths.map((specPath) => bySpec.get(specPath)) };
  }

  const errorsBySpec = attributeErrors(stderr, entries);
  const anyAttributed = errorsBySpec.size > 0;
  for (const entry of entries) {
    const error = errorsBySpec.get(entry.specPath);
    if (error) bySpec.set(entry.specPath, { specPath: entry.specPath, result: 'invalid', error });
    else if (anyAttributed) bySpec.set(entry.specPath, { specPath: entry.specPath, result: 'valid' });
    else bySpec.set(entry.specPath, { specPath: entry.specPath, result: 'invalid', error: cleanError(stderr) });
  }

  return { ...base, results: specPaths.map((specPath) => bySpec.get(specPath)), stderrTail: tail(stderr) };
}

const isMainModule = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const targetPath = process.argv[2] ?? '.';
  const args = process.argv.slice(3);
  const locationIndex = args.indexOf('--location');
  const location = locationIndex !== -1 ? args[locationIndex + 1] : undefined;
  const specPaths = args.filter(
    (arg, index) => !arg.startsWith('--') && !(locationIndex !== -1 && index === locationIndex + 1),
  );

  try {
    console.log(JSON.stringify(validateSpecs(targetPath, specPaths, { location }), null, 2));
  } catch (err) {
    console.log(JSON.stringify({ status: 'error', message: err.message }, null, 2));
    process.exitCode = 0;
  }
}
