import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect, isWorkspaceMember, resolvePackageManager, resolveLinter, resolveTypescript } from './detect.mjs';
import { hasFlatEslintConfig } from './scaffold.mjs';
import { resolveLocation, readRootManifest, manifestLinter, manifestTypescript, resolveOverride } from './manifest.mjs';

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
const LINT_DEPS = ['eslint', 'eslint-plugin-playwright', '@typescript-eslint/parser'];

// The add verb per manager; the dependency list is appended at call time.
const ADD_VERBS = {
  npm: ['npm', 'install'],
  yarn: ['yarn', 'add'],
  pnpm: ['pnpm', 'add'],
  bun: ['bun', 'add'],
};

function defaultRun(command, args, options) {
  execFileSync(command, args, { stdio: 'inherit', ...options });
}

// Install @playwright/test into the self-contained e2e/web sub-package. Paths
// resolve from targetPath and the command runs with cwd set to e2e/web, so no
// caller `cd` is needed. `run` is injectable (mirrors install-browsers.mjs).
export function installPlaywright(targetPath, options = {}) {
  const { packageManager, run = defaultRun, notify = defaultNotify, linter, typescript } = options;
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
  // what shared root config the manager is about to touch, not only after.
  const rootFilesTouched = predictRootFilesTouched(root, key, webDir);
  notify(rootFilesTouched);
  // The lint stack rides along only when the repo lints with ESLint (or has no
  // linter) AND a flat config is present. Gate on the resolved linter too, not
  // the config alone: a Biome repo whose e2e/web already holds an eslint config
  // (an old-plugin scaffold, or hand-authored) would otherwise still get the
  // ESLint deps installed, contradicting "a Biome repo gets no ESLint deps".
  // An explicit choice wins, then the persisted manifest, then detection.
  const resolvedLinter = resolveOverride(linter, manifestLinter(readRootManifest(root)), resolveLinter(detect(root)));
  // Pin e2e/web's own `typescript` to the repo's version — same explicit ->
  // persisted -> detected order as the linter above — so specs typecheck
  // against the same TS the app uses instead of whatever an unpinned
  // `@typescript-eslint/parser` install happens to resolve (#449). Unpinned
  // (bare 'typescript') when the repo declares no version.
  const resolvedTypescript = resolveOverride(typescript, manifestTypescript(readRootManifest(root)), resolveTypescript(detect(root)));
  const tsDep = resolvedTypescript ? `typescript@${resolvedTypescript}` : 'typescript';
  const deps = resolvedLinter !== 'biome' && hasFlatEslintConfig(webAbs) ? [BASE_DEP, tsDep, ...LINT_DEPS] : [BASE_DEP, tsDep];
  const [command, verb] = ADD_VERBS[key];
  run(command, [verb, '-D', ...deps], { cwd: webAbs });
  return { status: 'ok', packageManager: key, webDir, rootFilesTouched };
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
