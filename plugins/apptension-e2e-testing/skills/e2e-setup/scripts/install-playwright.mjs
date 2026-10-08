import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  detect,
  isWorkspaceMember,
  reachesBiomePlaywrightMin,
  readPackageJson,
  resolveBiome,
  resolveEslint,
  resolvePackageManager,
  resolveLinter,
  resolveTypescript,
} from './detect.mjs';
import { hasBiomeConfig, hasFlatEslintConfig, renderStandaloneTsconfig } from './scaffold.mjs';
import { resolveLocation, resolveOverride } from './manifest.mjs';

// Root files each manager is known to create or rewrite when it installs a
// dependency into a workspace member — the lockfile and (pnpm) the workspace
// manifest, where pnpm 10 stores build-script approval. The install is scoped
// to the e2e/web sub-package, but when e2e/web is a member of the repo's
// workspace the manager resolves up to the workspace root and touches these.
const ROOT_FILES_BY_MANAGER = {
  npm: ['package-lock.json'],
  yarn: ['yarn.lock'],
  pnpm: ['pnpm-lock.yaml', 'pnpm-workspace.yaml'],
  bun: ['bun.lockb', 'bun.lock'],
};

// Predict which files OUTSIDE e2e/web the install may create or change, so
// setup can report its blast radius honestly instead of only listing what it
// wrote under e2e/web. The install reaches the repo root only when e2e/web is
// an actual member of the workspace the manager reads (its patterns match
// e2e/web); a standalone sub-package keeps its own lockfile and never touches
// root. NOT filtered to existing files: a root lockfile the install *creates*
// in a workspace (none there before) is the exact silent edit this is meant to
// surface, so filtering by existence would hide it.
export function predictRootFilesTouched(root, packageManager, webDir = 'e2e/web') {
  const key = ROOT_FILES_BY_MANAGER[packageManager] ? packageManager : 'npm';
  if (!isWorkspaceMember(root, webDir, key)) return [];
  return ROOT_FILES_BY_MANAGER[key];
}

// pnpm walks up to the nearest pnpm-workspace.yaml and writes an importer for
// the suite into that root's lockfile even when the workspace globs exclude the
// suite. --ignore-workspace keeps a non-member suite standalone, with its own
// pnpm-lock.yaml, on pnpm 9 and 10 alike. A suite-local pnpm-workspace.yaml
// with `packages: []` would do the same on pnpm 10, but pnpm 9 refuses to add
// to it without -w (ERR_PNPM_ADDING_TO_ROOT).
function workspaceFlags(root, key, webDir) {
  return key === 'pnpm' && !isWorkspaceMember(root, webDir, key) ? ['--ignore-workspace'] : [];
}

// A content hash per root file, or null for an absent one, so a file the
// install creates reads as changed the same way an edited one does.
function hashRootFiles(root, files) {
  return files.map((file) => {
    const abs = join(root, file);
    return existsSync(abs) ? createHash('sha256').update(readFileSync(abs)).digest('hex') : null;
  });
}

function defaultNotify(rootFilesTouched) {
  if (rootFilesTouched.length === 0) return;
  console.error(
    `Heads up: outside e2e/web, this install may create or change these root files: ${rootFilesTouched.join(', ')}`,
  );
}

// Add @playwright/test as a plain devDependency. NOT Playwright's interactive
// `create`/`init` initializer — that scaffolds a competing config + example
// spec + optional CI workflow, which scaffold.mjs already owns. devDependency
// matches the section scaffold.mjs pins the version into.
const BASE_DEP = '@playwright/test';

// The lint stack rides in the same add — but only when a flat eslint config is
// present in e2e/web (scaffold writes ours before this runs). A sub-package left
// on a legacy .eslintrc must NOT get ESLint 9 installed locally: it would
// shadow the older/parent ESLint that config relies on and break their lint.
// `eslint-plugin-playwright` carries the timing/await rules;
// `@typescript-eslint/parser` lets eslint parse the specs.
//
// `eslint` is pinned to the repo's declared version, and to defaultEslint() when
// the repo declares none, because an unpinned add takes the latest ESLint major
// and the parser it pairs with may not support it: ESLint 10 with parser 7.x
// crashes on `scopeManager.addGlobals` (#613). The parser is pinned to
// PARSER_RANGE, whose peer range is ESLint `^8.57.0 || ^9.0.0 || ^10.0.0`, so
// a 7.x left in a workspace lockfile is not reused. defaultEslint picks the
// newest major that range covers and the running Node supports; move them
// together.
const PARSER_RANGE = '^8';
function lintDeps(eslintVersion, nodeVersion) {
  const eslint = eslintVersion && reachesParserFloor(eslintVersion) ? eslintVersion : defaultEslint(nodeVersion);
  return [`eslint@${eslint}`, 'eslint-plugin-playwright', `@typescript-eslint/parser@${PARSER_RANGE}`];
}

// The ESLint range used when the repo's own cannot be pinned. ESLint 10 needs
// Node `^20.19.0 || ^22.13.0 || >=24`, and the lint run uses the Node running
// setup, so an older runtime gets ESLint 9 rather than a lint run that crashes.
export function defaultEslint(nodeVersion = process.versions.node) {
  const [major, minor] = nodeVersion.split('.').map(Number);
  const runsEslint10 = (major === 20 && minor >= 19) || (major === 22 && minor >= 13) || major >= 24;
  return runsEslint10 ? '^10' : '^9';
}

// True when a declared ESLint range can resolve to 8.57 or newer, the floor of
// PARSER_RANGE's peer range. Only a single `X.Y.Z`, `^X.Y.Z` or `~X.Y.Z` is
// read. Anything else falls back to defaultEslint: a range held below 8.57
// (`8.56.0`, `~8.50.0`, `^7`) cannot install beside parser 8, a compound range
// (`>=8 <8.57`, `^8 || ^9`) would need a full semver evaluator to judge, and a
// protocol such as `catalog:` does not parse. The default already satisfies
// an open `>=8` range, and the suite is its own package, so the fallback still
// lints.
function reachesParserFloor(range) {
  const match = /^\s*(\^|~)?v?(\d+)(?:\.(\d+))?(?:\.\d+)?\s*$/.exec(range);
  if (!match) return false;
  const [, op, major, minor = '0'] = match;
  if (Number(major) !== 8) return Number(major) > 8;
  return op === '^' || Number(minor) >= 57;
}

// The exit code for lint findings, which a re-run over existing specs can have.
// Every other failure fails setup: ESLint's exit 2 (a crash or a config error),
// and a lint run that never started, where execFileSync sets `status` to null.
const LINT_FINDINGS_EXIT = 1;
// Biome exits 1 for findings and for a configuration error alike, so a lint
// script that runs Biome counts as findings only when its output carries this
// line, which Biome prints after reporting diagnostics and not when it stops on
// its config. A suite that kept a lint script of its own running another tool
// keeps that tool's exit-code meaning.
const BIOME_FINDINGS_LINE = 'Some errors were emitted while running checks';
// How much of a crashed lint run's output the error message keeps: ESLint's
// diagnostic and its first stack frames, not the package manager's preamble.
const LINT_DETAIL_LINES = 15;

// The add verb per manager; the dependency list is appended at call time.
const ADD_VERBS = {
  npm: ['npm', 'install'],
  yarn: ['yarn', 'add'],
  pnpm: ['pnpm', 'add'],
  bun: ['bun', 'add'],
};

// The child's stdout goes to stderr: stdout carries only this script's JSON
// result, and the human still sees the progress in the terminal. A caller that
// pipes stdout gets the child's output back instead.
function defaultRun(command, args, options) {
  return execFileSync(command, args, { stdio: ['inherit', process.stderr, 'inherit'], ...options });
}

// The add skips the repo's lifecycle scripts: setup adds Playwright and
// nothing else, and a root `postinstall` or `prepare` can build, install git
// hooks or reach the network (#715). Playwright's browsers come from
// install-browsers.mjs, not from a postinstall. Yarn Berry's `add` rejects
// --ignore-scripts, and its enableScripts setting skips third-party scripts
// but still runs a workspace's own, so Yarn 3 and later get --mode=skip-build,
// which skips the whole build step. Yarn 2 has no --mode, so it gets
// YARN_ENABLE_SCRIPTS=0, which is the most that version offers. The yarn
// binary in the suite directory is the one that runs the add, so its own
// version says which Yarn this is. Only stdout is piped, so a Corepack
// download prompt on this first yarn call still reaches the human.
function skipScripts(key, run, webAbs) {
  if (key !== 'yarn') return { flags: ['--ignore-scripts'], env: null };
  const version = run('yarn', ['--version'], { cwd: webAbs, stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' });
  const major = Number(String(version ?? '').trim().split('.')[0]);
  if (major >= 3) return { flags: ['--mode=skip-build'], env: null };
  if (major === 2) return { flags: [], env: { ...process.env, YARN_ENABLE_SCRIPTS: '0' } };
  return { flags: ['--ignore-scripts'], env: null };
}

// The version of the TypeScript the suite's tsc resolves, or null when there
// is none to read. Node's lookup order from the suite directory, so a copy a
// workspace install hoisted to an ancestor node_modules counts. The candidate
// directories are checked by hand, not through require.resolve, so a package
// `exports` map that hides package.json cannot hide the version.
function installedTypescript(webAbs) {
  const dirs = createRequire(join(webAbs, 'package.json')).resolve.paths('typescript') ?? [];
  for (const dir of dirs) {
    try {
      return JSON.parse(readFileSync(join(dir, 'typescript/package.json'), 'utf8')).version ?? null;
    } catch {
      // not installed here, or unreadable: try the next directory up
    }
  }
  return null;
}

// The scaffold writes the standalone suite tsconfig.json with NodeNext before
// any TypeScript is installed, and NodeNext needs 4.7. Once the install has
// run, the installed version is known, so an older one gets the legacy module
// pair. Only a file still exactly as the scaffold wrote it is rewritten.
// Returns what changed, or null when nothing did.
function fitTsconfigToTypescript(webAbs) {
  const path = join(webAbs, 'tsconfig.json');
  if (!existsSync(path) || readFileSync(path, 'utf8') !== renderStandaloneTsconfig()) return null;
  const version = installedTypescript(webAbs);
  const [major, minor] = (version ?? '').split('.').map(Number);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || major > 4 || (major === 4 && minor >= 7)) return null;
  writeFileSync(path, renderStandaloneTsconfig({ legacy: true }));
  return { typescript: version, moduleResolution: 'Node' };
}

// Install @playwright/test into the self-contained e2e/web sub-package. Paths
// resolve from targetPath and the command runs with cwd set to e2e/web, so no
// caller `cd` is needed. `run` is injectable (mirrors install-browsers.mjs).
export function installPlaywright(targetPath, options = {}) {
  const { packageManager, run = defaultRun, notify = defaultNotify, linter, typescript, nodeVersion } = options;
  // Resolve to absolute so the install runs against the suite location
  // regardless of the caller's cwd (the SKILL invites a relative target like
  // `webapp`).
  const root = resolve(targetPath);
  const webDir = resolveLocation(root, options);
  const webAbs = join(root, webDir);
  mkdirSync(webAbs, { recursive: true });
  // Write a minimal manifest first. Without a package.json in e2e/web, the
  // package manager walks up to the target repo's root package.json and installs
  // there instead of into the sub-package. scaffold.mjs later merges its scripts
  // and pin into this same file.
  const pkgPath = join(webAbs, 'package.json');
  if (!existsSync(pkgPath)) {
    writeFileSync(pkgPath, `${JSON.stringify({ name: 'e2e-web', private: true, version: '0.0.0' }, null, 2)}\n`);
  }
  const key = ADD_VERBS[packageManager] ? packageManager : 'npm';
  if (key === 'yarn') {
    // Yarn Berry otherwise treats e2e/web as part of the parent project and
    // refuses to add there (walking up to the repo root). An empty yarn.lock
    // marks e2e/web as its own standalone project, and node-modules linker gives
    // a resolvable node_modules — Berry defaults to PnP, which the createRequire
    // in install-browsers.mjs / list-devices.mjs can't load from. Both are
    // harmless under Yarn Classic and are tracked files that define the package.
    const lockPath = join(webAbs, 'yarn.lock');
    if (!existsSync(lockPath)) writeFileSync(lockPath, '');
    const yarnrcPath = join(webAbs, '.yarnrc.yml');
    if (!existsSync(yarnrcPath)) writeFileSync(yarnrcPath, 'nodeLinker: node-modules\n');
  }
  // Report the blast radius outside e2e/web BEFORE installing, so the user sees
  // what shared root config the manager is about to touch, not only after. The
  // notice carries the prediction. The result carries the manager's root files
  // the install actually created or changed, hashed before and after whatever
  // the prediction said, so an install that reaches root unpredicted still
  // shows up.
  notify(predictRootFilesTouched(root, key, webDir));
  const rootFiles = ROOT_FILES_BY_MANAGER[key];
  const hashesBefore = hashRootFiles(root, rootFiles);
  // The lint stack rides along only when the repo lints with ESLint (or has no
  // linter) AND a flat config is present. Gate on the resolved linter too, not
  // the config alone: a Biome repo whose e2e/web already holds an eslint config
  // (an old-plugin scaffold, or hand-authored) would otherwise still get the
  // ESLint deps installed, contradicting "a Biome repo gets no ESLint deps".
  // An explicit choice wins, else detection.
  const resolvedLinter = resolveOverride(linter, resolveLinter(detect(root)));
  // Pin e2e/web's own `typescript` to the repo's version — same explicit ->
  // detected order as the linter above — so specs typecheck against the same
  // TS the app uses instead of whatever an unpinned `@typescript-eslint/parser`
  // install happens to resolve (#449). Unpinned (bare 'typescript') when the
  // repo declares no version.
  const resolvedTypescript = resolveOverride(typescript, resolveTypescript(detect(root)));
  const tsDep = resolvedTypescript ? `typescript@${resolvedTypescript}` : 'typescript';
  // A TypeScript suite also gets `@types/node`: the scaffolded fixtures/base.ts
  // imports `node:fs` and reads `process.env`, and a workspace package gets no
  // types from the root. Pinned to the root's declared version the same way as
  // `typescript`, unpinned when the repo declares none. A JavaScript suite is
  // never type-checked, so it gets none.
  const report = detect(root, options);
  const typesNodeDeps = report.language === 'ts' ? [report.typesNode ? `@types/node@${report.typesNode}` : '@types/node'] : [];
  const withLint = resolvedLinter !== 'biome' && hasFlatEslintConfig(webAbs);
  // A Biome suite gets its own @biomejs/biome, pinned to the root's version so
  // the suite lints with the Biome the repo runs, and only where scaffold wrote
  // or found a suite Biome config and that Biome carries the Playwright rules.
  const biomeVersion = resolveBiome(report);
  const withBiome = resolvedLinter === 'biome' && hasBiomeConfig(webAbs) && reachesBiomePlaywrightMin(biomeVersion);
  const deps = [
    BASE_DEP,
    tsDep,
    ...typesNodeDeps,
    ...(withLint ? lintDeps(resolveEslint(detect(root)), nodeVersion) : []),
    ...(withBiome ? [`@biomejs/biome@${biomeVersion}`] : []),
  ];
  const [command, verb] = ADD_VERBS[key];
  const { flags, env } = skipScripts(key, run, webAbs);
  run(command, [verb, '-D', ...flags, ...workspaceFlags(root, key, webDir), ...deps], {
    cwd: webAbs,
    ...(env ? { env } : {}),
  });
  const hashesAfter = hashRootFiles(root, rootFiles);
  const rootFilesTouched = rootFiles.filter((_, i) => hashesBefore[i] !== hashesAfter[i]);
  const tsconfigRewritten = fitTsconfigToTypescript(webAbs);
  const result = { status: 'ok', packageManager: key, webDir, rootFilesTouched, ...(tsconfigRewritten ? { tsconfigRewritten } : {}) };
  if (!withLint && !withBiome) return result;
  // Lint the suite once, so a lint stack that installs but cannot run is caught
  // here instead of on the first spec the generate skill writes. Output is
  // captured rather than inherited, so a crash message can carry the linter's
  // own diagnostic instead of execFileSync's generic "Command failed".
  try {
    run(command, ['run', 'lint'], { cwd: webAbs, stdio: 'pipe', encoding: 'utf8' });
    return { ...result, lint: 'passed' };
  } catch (err) {
    const output = [err.stdout, err.stderr].filter(Boolean).join('\n').trim();
    const runsBiome = /\bbiome\b/.test(readPackageJson(webAbs).scripts?.lint ?? '');
    const findings = err.status === LINT_FINDINGS_EXIT && (!runsBiome || output.includes(BIOME_FINDINGS_LINE));
    if (findings) return { ...result, lint: 'findings' };
    const detail = output ? output.split('\n').slice(-LINT_DETAIL_LINES).join('\n') : err.message;
    return { ...result, status: 'error', lint: 'crashed', message: `\`${command} run lint\` in ${webDir} crashed after install:\n${detail}` };
  }
}

const isMainModule = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const targetPath = process.argv[2] ?? '.';
    const flag = (name) => {
      const i = process.argv.indexOf(name);
      return i !== -1 ? process.argv[i + 1] : undefined;
    };
    const packageManager = flag('--pm') ?? resolvePackageManager(detect(targetPath));
    const location = flag('--location');
    const linter = flag('--linter');
    const typescript = flag('--typescript');
    console.log(JSON.stringify(installPlaywright(targetPath, { packageManager, location, linter, typescript }), null, 2));
  } catch (err) {
    console.log(JSON.stringify({ status: 'error', message: err.message }, null, 2));
    process.exitCode = 0;
  }
}
