import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { detect } from '../../e2e-setup/scripts/detect.mjs';
import { BIOME_ASSERTION_MESSAGE, hasBiomeConfig, hasFlatEslintConfig } from '../../e2e-setup/scripts/scaffold.mjs';
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

// The suite's own `typecheck` script, which e2e-setup adds to a TypeScript
// suite beside its tsconfig.json. Playwright strips types without checking
// them, so --list passes a spec with a type error; this is the check that
// fails it. Skipped, with the reason, when the suite has no tsconfig.json or
// no script: a JavaScript suite, or one scaffolded before either existed. A
// suite at the repo root is skipped too: its tsconfig.json and scripts are
// the app's, so the typecheck would check the app.
function typecheckSkipReason(location, locationAbsolute) {
  if (location === '.') return 'the suite is the repo root, so its typecheck would check the app';
  if (!existsSync(join(locationAbsolute, 'tsconfig.json'))) return 'no tsconfig.json in the suite';
  try {
    const pkg = JSON.parse(readFileSync(join(locationAbsolute, 'package.json'), 'utf8'));
    if (pkg.scripts?.typecheck) return null;
  } catch {
    // unreadable or absent package.json: no script to run
  }
  return 'no typecheck script in the suite package.json';
}

const TSC_ERROR = /^(.+?)\(\d+,\d+\): error TS\d+: /;

// tsc prints one `file(line,col): error TSnnnn: message` line per error, and
// indents any continuation lines under it. Returns the errors grouped by file,
// each file's lines joined in the order tsc printed them. Anything else in
// the output (the package manager's banner, a summary line) is dropped.
function tscErrorsByFile(output, cwd) {
  const byFile = new Map();
  let current = null;
  for (const line of output.split('\n')) {
    const match = TSC_ERROR.exec(line);
    if (match) {
      const raw = match[1].trim();
      current = (isAbsolute(raw) ? relative(cwd, raw) : raw).replace(/\\/g, '/').replace(/^\.\//, '');
      byFile.set(current, [...(byFile.get(current) ?? []), line]);
    } else if (current && /^\s+\S/.test(line)) {
      byFile.get(current).push(line);
    } else {
      current = null;
    }
  }
  return new Map([...byFile].map(([file, lines]) => [file, lines.join('\n')]));
}

function typecheckCommand(packageManager) {
  return [['pnpm', 'yarn', 'bun'].includes(packageManager) ? packageManager : 'npm', ['run', 'typecheck']];
}

// Runs the typecheck once over the whole suite and folds its errors into the
// per-spec results: a requested spec with a type error becomes `invalid`, and
// errors in any other file (a page object, a fixture) are listed by file.
function runTypecheck(run, packageManager, location, locationAbsolute, entries, bySpec) {
  const reason = typecheckSkipReason(location, locationAbsolute);
  if (reason) return { status: 'skipped', reason };
  const [command, args] = typecheckCommand(packageManager);
  const { stdout, stderr, ok, spawnFailed } = run(command, args, { cwd: locationAbsolute });
  if (ok) return { status: 'passed' };
  const errors = spawnFailed ? new Map() : tscErrorsByFile(`${stdout}\n${stderr}`, locationAbsolute);
  if (errors.size === 0) return { status: 'error', message: cleanError(`${stderr}\n${stdout}`.trim()) };
  for (const entry of entries) {
    const key = entry.runnerPath.replace(/\\/g, '/').replace(/^\.\//, '');
    const error = errors.get(key);
    if (!error) continue;
    bySpec.set(entry.specPath, { specPath: entry.specPath, result: 'invalid', error });
    errors.delete(key);
  }
  return { status: 'failed', otherFiles: [...errors].map(([file, error]) => ({ file, error })) };
}

// How each package manager runs a binary installed in the suite.
const EXEC_FORMS = {
  npm: (bin) => ['npm', ['exec', '--', bin]],
  pnpm: (bin) => ['pnpm', ['exec', bin]],
  yarn: (bin) => ['yarn', [bin]],
  bun: (bin) => ['bun', ['x', bin]],
};

function execCommand(packageManager, bin, args) {
  const [command, prefix] = (EXEC_FORMS[packageManager] ?? ((name) => ['npx', [name]]))(bin);
  return [command, [...prefix, ...args]];
}

function lintCommand(packageManager, runnerPaths) {
  return execCommand(packageManager, 'eslint', ['--format', 'json', ...runnerPaths]);
}

// Biome prints at most 20 diagnostics unless told otherwise, and a finding cut
// from the report is one the run never routes.
function biomeLintCommand(packageManager, runnerPaths) {
  return execCommand(packageManager, 'biome', ['lint', '--reporter=json', '--max-diagnostics=none', ...runnerPaths]);
}

const TEST_CALL = /^\s*test(?:\.\w+)?\(/;
const ASSERT_CALL = /\.assert\.(\w+)\s*\(/g;
const MATCHER_NAME = /^to[A-Z]/;

// expect-expect reports the test() call that asserts nothing, so the cause is
// read from that test's body: from the reported line up to the next test().
// A call through `.assert.` whose method is not named like a matcher is a
// misnamed Page Object assertion, which the rule would have counted under a
// `to` name. A test with no such call has no assertion at all.
function expectExpectCause(source, line) {
  const lines = source.split('\n');
  const start = line - 1;
  let end = lines.findIndex((text, index) => index > start && TEST_CALL.test(text));
  if (end === -1) end = lines.length;
  const body = lines.slice(start, end).join('\n');
  const methods = [...new Set([...body.matchAll(ASSERT_CALL)].map((match) => match[1]))].filter(
    (name) => !MATCHER_NAME.test(name),
  );
  return methods.length > 0 ? { cause: 'misnamed-assertion', methods } : { cause: 'no-assertion' };
}

// Lints the requested specs with the suite's own linter, so a spec whose Page
// Object assertion is not named like a matcher (`loaded()` instead of
// `toBeLoaded()`) shows up as a missing-assertion finding now rather than on
// the next `npm run lint`. Findings never change a spec's `result`: the
// generate skill decides which ones stop the run. A flat ESLint config picks
// ESLint, and a Biome config picks Biome when there is none. Skipped when the
// suite has neither: ESLint 9 loads no other config.
function runLint(run, packageManager, targetPath, locationAbsolute, entries) {
  if (hasFlatEslintConfig(locationAbsolute)) return runEslint(run, packageManager, targetPath, locationAbsolute, entries);
  if (hasBiomeConfig(locationAbsolute)) return runBiome(run, packageManager, targetPath, locationAbsolute, entries);
  return { status: 'skipped', reason: 'no flat ESLint config or Biome config in the suite' };
}

// A missing-assertion finding carries the cause read from the flagged test.
function withAssertionCause(finding, absolute) {
  return { ...finding, ...expectExpectCause(readFileSync(absolute, 'utf8'), finding.line) };
}

// ESLint exits 1 when any message is an error and still prints its JSON, so
// the exit code is not read.
function runEslint(run, packageManager, targetPath, locationAbsolute, entries) {
  const [command, args] = lintCommand(packageManager, entries.map((entry) => entry.runnerPath));
  const { stdout, stderr } = run(command, args, { cwd: locationAbsolute });
  let files;
  try {
    files = JSON.parse(stdout);
    if (!Array.isArray(files)) throw new Error('not an ESLint JSON report');
  } catch {
    return { status: 'error', message: cleanError(`${stderr}\n${stdout}`.trim()) };
  }
  const findings = files.flatMap((file) => {
    const absolute = isAbsolute(file.filePath) ? file.filePath : join(locationAbsolute, file.filePath);
    return (file.messages ?? []).map((message) => {
      const finding = {
        file: relative(targetPath, absolute).replace(/\\/g, '/'),
        line: message.line,
        ruleId: message.ruleId,
        severity: message.severity === 2 ? 'error' : 'warning',
        message: message.message,
      };
      return message.ruleId === 'playwright/expect-expect' ? withAssertionCause(finding, absolute) : finding;
    });
  });
  return findings.length === 0 ? { status: 'passed' } : { status: 'findings', findings };
}

// Every GritQL plugin reports under the `plugin` category, so the suite's
// expect-assertion.grit is told apart by its message and given a ruleId.
const BIOME_ASSERTION_RULE = 'plugin/expect-assertion';

// Biome exits 1 both for error diagnostics and for a configuration error. The
// first prints the JSON report on stdout, the second prints nothing there, so
// the report is read and the exit code is not.
function runBiome(run, packageManager, targetPath, locationAbsolute, entries) {
  const [command, args] = biomeLintCommand(packageManager, entries.map((entry) => entry.runnerPath));
  const { stdout, stderr } = run(command, args, { cwd: locationAbsolute });
  let diagnostics;
  try {
    diagnostics = JSON.parse(stdout).diagnostics;
    if (!Array.isArray(diagnostics)) throw new Error('not a Biome JSON report');
  } catch {
    return { status: 'error', message: cleanError(`${stderr}\n${stdout}`.trim()) };
  }
  const findings = diagnostics.map((diagnostic) => {
    const path = diagnostic.location?.path;
    const absolute = path && (isAbsolute(path) ? path : join(locationAbsolute, path));
    const assertion = diagnostic.category === 'plugin' && diagnostic.message === BIOME_ASSERTION_MESSAGE;
    const finding = {
      file: absolute ? relative(targetPath, absolute).replace(/\\/g, '/') : null,
      line: diagnostic.location?.start?.line ?? null,
      ruleId: assertion ? BIOME_ASSERTION_RULE : diagnostic.category,
      severity: ['error', 'fatal'].includes(diagnostic.severity) ? 'error' : 'warning',
      message: diagnostic.message,
    };
    return assertion && absolute ? withAssertionCause(finding, absolute) : finding;
  });
  return findings.length === 0 ? { status: 'passed' } : { status: 'findings', findings };
}

// Every matcher call in a spec: `.toX(` or `.not.toX(`, with its first
// argument's text. A Page Object assertion named like a matcher
// (`login.assert.toBeLoaded()`) matches too, and counts as positive, since its
// body is out of sight here.
const MATCHER_CALL = /\.(not\.)?(to[A-Z]\w*)\s*\(\s*([^,)]*)/g;

// Blanks out comments and string contents, so neither a commented-out matcher
// nor matcher-shaped text such as `getByText('x.toBeVisible()')` is read as a
// live call. Code inside a template's `${…}` is kept, since it runs. A
// backslash in code skips the next character, so an escaped slash in a regex
// literal such as `/\/projects\//` never opens a comment.
function maskNonCode(source) {
  const stack = [{ type: 'code', braces: 0 }];
  let out = '';
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    const top = stack.at(-1);
    if (top.type !== 'code') {
      if (char === '\\') {
        out += '  ';
        i += 1;
      } else if (char === top.quote) {
        out += char;
        stack.pop();
      } else if (top.quote === '`' && char === '$' && next === '{') {
        out += '${';
        i += 1;
        stack.push({ type: 'code', braces: 0 });
      } else {
        out += char === '\n' ? '\n' : ' ';
      }
    } else if (char === '\\') {
      out += char + (next ?? '');
      i += 1;
    } else if (char === "'" || char === '"' || char === '`') {
      out += char;
      stack.push({ type: 'string', quote: char });
    } else if (char === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      out += '\n';
    } else if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 1;
      out += ' ';
    } else if (char === '}' && top.braces === 0 && stack.length > 1) {
      out += char;
      stack.pop();
    } else {
      if (char === '{') top.braces += 1;
      if (char === '}') top.braces -= 1;
      out += char;
    }
  }
  return out;
}

function isAbsenceMatcher([, not, name, firstArg]) {
  if (not) return name === 'toBeVisible';
  return name === 'toBeHidden' || (name === 'toHaveCount' && firstArg.trim() === '0');
}

const ABSENCE_ONLY_MESSAGE =
  'Every assertion in this spec checks that something is absent, so it also passes when the locator matches nothing. ' +
  'Add a positive control: the same locator matching in the same spec, usually on a second seeded record that shows it.';

// Warns on a spec whose matchers all assert absence. A spec with no matcher
// is the missing-assertion lint rule's finding, not this one. A warning never
// changes a spec's `result`.
function checkAssertions(targetPath, entries) {
  const warnings = entries.flatMap(({ specPath }) => {
    const matchers = [...maskNonCode(readFileSync(join(targetPath, specPath), 'utf8')).matchAll(MATCHER_CALL)];
    if (matchers.length === 0 || !matchers.every(isAbsenceMatcher)) return [];
    return [{ specPath, rule: 'absence-only', message: ABSENCE_ONLY_MESSAGE }];
  });
  return warnings.length === 0 ? { status: 'passed' } : { status: 'warnings', warnings };
}

export function validateSpecs(targetPath, specPaths, options = {}) {
  const { run = defaultRun, location } = options;

  // Same trap run-specs guards: an empty positional-args list would make
  // Playwright list the repo's whole configured suite.
  if (!Array.isArray(specPaths) || specPaths.length === 0) {
    return { status: 'error', message: 'No spec paths given. Usage: validate-specs.mjs <target path> <spec path>… [--location <rel>]' };
  }

  const { runnable, missing } = selectSpecs(targetPath, specPaths);

  const detected = detect(targetPath, { location });
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
    const typecheck = runTypecheck(run, detected.packageManager, resolved.location, locationAbsolute, entries, bySpec);
    const lint = runLint(run, detected.packageManager, targetPath, locationAbsolute, entries);
    const assertions = checkAssertions(targetPath, entries);
    return { ...base, results: specPaths.map((specPath) => bySpec.get(specPath)), typecheck, lint, assertions };
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
