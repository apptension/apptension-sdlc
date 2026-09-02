import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRootManifest, resolveLocation } from './manifest.mjs';

const LOCKFILE_MANAGERS = {
  'package-lock.json': 'npm',
  'yarn.lock': 'yarn',
  'pnpm-lock.yaml': 'pnpm',
  'bun.lockb': 'bun',
  'bun.lock': 'bun',
};

const PLAYWRIGHT_CONFIG_NAMES = [
  'playwright.config.ts',
  'playwright.config.js',
  'playwright.config.mjs',
  'playwright.config.cjs',
];

export function readPackageJson(dir) {
  const path = join(dir, 'package.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
}

function detectPackageManager(repoRoot) {
  for (const [file, manager] of Object.entries(LOCKFILE_MANAGERS)) {
    if (existsSync(join(repoRoot, file))) return manager;
  }
  return null;
}

const KNOWN_MANAGERS = ['npm', 'yarn', 'pnpm', 'bun'];

// Resolve the manager to install with, from a detect() report. A committed
// lockfile is the strongest signal; fall back to the Corepack `packageManager`
// field (e.g. "yarn@4.0.2" or "pnpm@9.0.0+sha512...") so a repo that pins its
// manager but hasn't committed a lockfile still installs with its own manager
// instead of a surprise npm island in e2e/web. Returns null when neither
// signal is present — the caller defaults that to npm.
export function resolvePackageManager(report) {
  if (report.packageManager) return report.packageManager;
  const name = report.packageManagerField?.split('@')[0];
  return KNOWN_MANAGERS.includes(name) ? name : null;
}

const SPEC_EXTENSION_PATTERN = /\.spec\.(ts|js)$/;
// node_modules: e2e/web is its own sub-package, so it can have a real
// (potentially huge) install of its own. dist/build/coverage/out mirror
// TESTID_SCAN_IGNORE_DIRS below; playwright-report/test-results are
// Playwright's own output dirs, which accumulate files across local runs
// and aren't gitignored out of a filesystem walk the way they are out of git.
const SUITE_SCAN_IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'out', 'playwright-report', 'test-results']);
const SUITE_SCAN_MAX_DEPTH = 6;
const SUITE_SCAN_FILE_CAP = 500;

// The extension of a *.spec.ts/*.spec.js file found under the suite dir, or
// null when none exists yet. A Playwright config's own extension does not
// decide it — a TS suite can keep playwright.config.js while its specs are
// .spec.ts (Playwright transpiles TS regardless of the config file's own
// extension) — so this reads the specs themselves, the thing detectLanguage
// is actually deciding the extension for. Bounded like detectTestIdAttribute's
// scan below: a suite dir is small, so the cap is generous headroom, not a
// real limit in practice.
//
// ts wins over js whenever both exist (a mid-migration suite, or a leftover
// from an earlier, buggier version of this function) — deliberately, not by
// whichever readdirSync happens to list first, which isn't guaranteed
// alphabetical and would otherwise make the answer depend on filesystem
// order rather than repo content. sawTs short-circuits the walk the moment
// it's true; js has to wait for the whole (bounded) walk to finish, since an
// as-yet-unvisited .ts file could still turn up later.
function detectSuiteSpecExtension(suiteDir) {
  let sawTs = false;
  let sawJs = false;
  let scanned = 0;
  const walk = (dir, depth) => {
    if (sawTs || depth > SUITE_SCAN_MAX_DEPTH || scanned >= SUITE_SCAN_FILE_CAP) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (sawTs || scanned >= SUITE_SCAN_FILE_CAP) return;
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || SUITE_SCAN_IGNORE_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name), depth + 1);
      } else {
        scanned += 1;
        const match = SPEC_EXTENSION_PATTERN.exec(entry.name)?.[1];
        if (match === 'ts') sawTs = true;
        else if (match === 'js') sawJs = true;
      }
    }
  };
  walk(suiteDir, 0);
  return sawTs ? 'ts' : sawJs ? 'js' : null;
}

// The e2e package's own state decides the language once one exists (#436) —
// a suite relocated or configured independently of the repo root may not
// share the root's language. The package dir comes from resolveLocation
// (persisted answer, else e2e/web), never a hardcoded path.
//
// A local tsconfig.json is decisive where present. Otherwise fall back to
// what the suite's own specs are already written in: scaffold.mjs never
// writes a tsconfig.json into the package it creates, TS or JS, so an
// already-scaffolded TS suite has no local tsconfig.json to find, and its
// existing specs are the only local signal of its language.
//
// options.specDir is write-specs.mjs's already-resolved write target —
// which can diverge from resolveLocation's guess (an explicit --spec-dir,
// or one of resolveSpecDir's own manifest/config fallbacks) when nothing
// is persisted for a suite that was never onboarded via e2e-setup. Checked
// only after the resolveLocation-based suiteDir comes up empty, so an
// onboarded suite's own answer still wins.
//
// The root tsconfig.json check applies only once every local signal is
// empty — no local tsconfig.json and no specs written anywhere yet, e.g.
// scaffold's first run, which calls detect() before the package exists.
function detectLanguage(repoRoot, options = {}) {
  const suiteDir = join(repoRoot, resolveLocation(repoRoot, {}));
  if (existsSync(join(suiteDir, 'tsconfig.json'))) return 'ts';
  const specExtension = detectSuiteSpecExtension(suiteDir);
  if (specExtension) return specExtension;
  if (options.specDir) {
    const specDirExtension = detectSuiteSpecExtension(join(repoRoot, options.specDir));
    if (specDirExtension) return specDirExtension;
  }
  return existsSync(join(repoRoot, 'tsconfig.json')) ? 'ts' : 'js';
}

// The repo's declared TypeScript version, read from the ROOT package.json only
// — mirroring detectLinter's root-only scope — or null when the repo declares
// none. install-playwright.mjs pins e2e/web's own `typescript` dependency to
// this, so specs typecheck against the same TS the app uses instead of
// whatever an unpinned `@typescript-eslint/parser` install happens to resolve.
// ponytail: reads the declared range only, not the lockfile's resolved
// version; a repo pinning via `overrides`/`resolutions` reads as undetected
// here and the human confirms the version at setup's approval gate.
function detectTypeScript(repoRoot) {
  const pkg = readPackageJson(repoRoot);
  return pkg.dependencies?.typescript ?? pkg.devDependencies?.typescript ?? null;
}

// Resolve the TypeScript version to pin, from a detect() report. Falls back to
// null (no pin — let the install step add current) when detection found
// nothing, mirroring resolveTestIdAttribute's null-handling.
export function resolveTypescript(report) {
  return report.typescript ?? null;
}

function detectPinningStyle(pkg) {
  const versions = Object.values({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }).filter(
    (value) => typeof value === 'string',
  );
  if (versions.length === 0) return '^';
  const counts = { '^': 0, '~': 0, exact: 0 };
  for (const version of versions) {
    if (version.startsWith('^')) counts['^'] += 1;
    else if (version.startsWith('~')) counts['~'] += 1;
    else counts.exact += 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function detectPlaywright(dir) {
  const pkg = readPackageJson(dir);
  const version = pkg.dependencies?.['@playwright/test'] ?? pkg.devDependencies?.['@playwright/test'];
  const configPath = PLAYWRIGHT_CONFIG_NAMES.map((name) => join(dir, name)).find(existsSync) ?? null;
  if (!version && !configPath) return null;
  return { installed: Boolean(version), version: version ?? null, configPath };
}

function detectStartCommand(pkg) {
  const scripts = pkg.scripts ?? {};
  for (const name of ['dev', 'start', 'serve']) {
    if (scripts[name]) return name;
  }
  return null;
}

// Each framework's own documented dev-server default, keyed on the dependency
// that names the framework. Ordered, because the signals overlap: Nuxt and
// SvelteKit both build on Vite and may declare it, so the framework-specific
// entry has to be found before the bundler's.
//
// `@remix-run/react` is deliberately absent — classic Remix serves 3000 and
// Remix-on-Vite 5173, and a URL that is wrong is worse than one left blank for
// a human to fill. A Remix-on-Vite app still resolves through its own `vite`.
const FRAMEWORK_PORTS = [
  ['next', 3000],
  ['nuxt', 3000],
  ['@angular/core', 4200],
  ['@sveltejs/kit', 5173],
  ['react-scripts', 3000],
  ['vite', 5173],
  ['webpack-dev-server', 8080],
];

// An explicit CLI flag the framework's own parser reads — `--port 4000`,
// `--port=4000`, `-p 4000`. This binds whatever the environment says, so it is
// authoritative for every framework. Two to five digits, so a version number in
// the command is not mistaken for a port.
const FLAG_PORT = /(?:--port[= ]|-p[= ])(\d{2,5})\b/;

// An inline `PORT=4000` the script exports before the command (the cross-env
// shape a CRA or Next repo uses). This is an environment assignment, not a flag:
// only a framework that reads the generic PORT binds it, and an explicit --port
// flag overrides it — so it is classified separately from FLAG_PORT and gated
// by consumesPort below. A prefixed name (`APP_PORT=`, `MY_PORT=`) is accepted
// too, since `\b` alone missed it — `_` is a word character, so there is no
// boundary before `PORT`. The leading separator and the `PREFIX_` shape keep a
// variable that merely ends in PORT (`EXPORT=`, `SUPPORT=`) from matching.
const INLINE_PORT = /(?:^|[\s;&])(?:[A-Z0-9]+_)?PORT=(\d{2,5})\b/;

function matchPort(re, script) {
  const match = script ? re.exec(script) : null;
  return match ? Number(match[1]) : null;
}

function frameworkPort(deps) {
  const entry = FRAMEWORK_PORTS.find(([dep]) => deps.includes(dep));
  return entry ? entry[1] : null;
}

// `vite preview` serves a build on 4173, not the dev server's 5173, so the
// subcommand — not the framework dependency — decides the port. This catches a
// Vite or SvelteKit repo whose start script is `vite preview` (both preview on
// 4173); a framework with its own preview command and a different default
// (`nuxt preview` is still 3000) does not match, so it falls through to the
// table below.
const VITE_PREVIEW = /\bvite\s+preview\b/;

// Config-file names whose server block pins the dev-server port. Vite and
// anything on Vite (SvelteKit) keep it in vite.config.*; Angular keeps it in
// angular.json. Next has no config-file port field — its port comes from
// --port / PORT, already handled above — so it is deliberately absent.
// Ordered exactly as Vite resolves them (DEFAULT_CONFIG_FILES: js, mjs, ts,
// cjs, mts, cts), so when a repo has more than one, the first found here is the
// one Vite actually loads — not a config it ignores.
const VITE_CONFIG_NAMES = ['vite.config.js', 'vite.config.mjs', 'vite.config.ts', 'vite.config.cjs', 'vite.config.mts', 'vite.config.cts'];

// Strip /* */ and // comments before reading a port, so a commented-out
// `// port: 4000` is not mistaken for a pinned one. The `[^:]` guard leaves a
// proxy target's `http://…` intact — only a `//` that does not follow a colon
// is a comment.
// ponytail: regex strip, not a real lexer; a `//` inside a string literal that
// is not preceded by `:` is over-stripped, which at worst drops a match and
// falls to the probe — never a false positive.
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// The `port` scalar a named Vite config block pins (`server` for the dev
// server, `preview` for `vite preview`), or null. It walks the block's braces
// so a `port` after a nested object — `server: { proxy: { … }, port: N }`, a
// common shape — is still read, while a port inside a nested block (proxy/hmr)
// or in a sibling block is not. A miss returns null and detectPort falls to the
// framework default, where #404's probe takes over.
// ponytail: hand-scans braces rather than parsing JS; string/regex literals
// holding a stray brace could throw the depth off, which at worst drops the
// match and falls to the probe — never a false positive.
function viteBlockPort(text, block) {
  const src = stripComments(text);
  const open = new RegExp(`\\b${block}\\s*:\\s*\\{`).exec(src);
  if (!open) return null;
  let depth = 1;
  let top = '';
  for (let i = open.index + open[0].length; i < src.length && depth > 0; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (depth === 1) top += c; // only the block's own direct children
  }
  const match = /\bport\s*:\s*(\d{2,5})/.exec(top);
  return match ? Number(match[1]) : null;
}

function readViteConfig(appDir) {
  for (const name of VITE_CONFIG_NAMES) {
    const path = join(appDir, name);
    if (existsSync(path)) return readFileSync(path, 'utf8');
  }
  return null;
}

function viteConfigPort(appDir) {
  const text = readViteConfig(appDir);
  return text ? viteBlockPort(text, 'server') : null;
}

// The project name in `ng serve <project>`, so a multi-project workspace reads
// the served project's port, not the first one listed. `(?!-)` skips a leading
// flag (`ng serve --port 4000` names no project).
const NG_SERVE_PROJECT = /\bng\s+serve\s+(?!-)(\S+)/;
// The configuration `ng serve` runs — `--configuration <name>` / `-c <name>`,
// either space- or `=`-separated. A serve configuration can override the base
// options' port, so detection must apply it or it reports a port the run does
// not bind.
const NG_SERVE_CONFIG = /(?:--configuration|(?:^|\s)-c)[=\s]+(\S+)/;

function angularJsonPort(appDir, projectName, configName) {
  const path = join(appDir, 'angular.json');
  if (!existsSync(path)) return null;
  try {
    const json = JSON.parse(readFileSync(path, 'utf8'));
    const projects = json.projects ?? {};
    const names = Object.keys(projects);
    // The project `ng serve` runs: the one the start script names, else the
    // workspace default, else the sole project. Several projects and no name is
    // ambiguous — return null and let the live probe resolve it, never guess a
    // sibling's port.
    const name =
      projectName && projects[projectName]
        ? projectName
        : json.defaultProject && projects[json.defaultProject]
          ? json.defaultProject
          : names.length === 1
            ? names[0]
            : null;
    if (!name) return null;
    const serve = projects[name]?.architect?.serve ?? projects[name]?.targets?.serve;
    // The active configuration overrides base options. A comma list merges
    // left-to-right, so the last that pins a port wins; else the serve target's
    // own defaultConfiguration applies. The effective port is the override's,
    // falling back to the base option.
    const active = (configName ?? serve?.defaultConfiguration ?? '').split(',').filter(Boolean);
    const configs = serve?.configurations ?? {};
    let port = serve?.options?.port;
    for (const cfg of active) {
      if (Number.isInteger(configs[cfg]?.port)) port = configs[cfg].port;
    }
    if (Number.isInteger(port)) return port;
  } catch {
    // unreadable / malformed angular.json — fall through to null
  }
  return null;
}

// A dev-server port pinned in the framework config file, or null. Static and
// deterministic, so deriveBaseUrl persists it like a declared value; keyed on
// the framework dependency, mirroring frameworkPort/consumesPort above.
function detectConfigPort(appDir, deps, script) {
  if (deps.includes('vite') || deps.includes('@sveltejs/kit')) {
    const port = viteConfigPort(appDir);
    if (port) return port;
  }
  if (deps.includes('@angular/core')) {
    const served = script ? NG_SERVE_PROJECT.exec(script)?.[1] : undefined;
    const config = script ? NG_SERVE_CONFIG.exec(script)?.[1] : undefined;
    const port = angularJsonPort(appDir, served, config);
    if (port) return port;
  }
  return null;
}

// Which port this location's dev server binds, without starting it. An explicit
// flag wins, then `vite preview`, then an inline PORT= for a framework that reads
// it, then a port pinned in the framework config file, then the framework's
// documented default. null when none answers, keeping E2E_BASE_URL blank rather
// than guessing (#157).
//
// A config-file port and the framework default both need no running server; a
// port bound only at runtime does, and that is #404's probe (probe-port.mjs),
// run at setup time, not here.
function detectPort(pkg, appDir) {
  const start = detectStartCommand(pkg);
  const script = start ? pkg.scripts?.[start] : null;
  const deps = declaredDependencies(pkg);
  // fromCommand marks a port that binds regardless of the environment, so
  // deriveBaseUrl must not let an exported PORT override it. An explicit --port
  // flag and `vite preview` are authoritative for every framework. An inline
  // `PORT=` is authoritative too, but only where the framework reads PORT — for
  // Vite or Angular it is inert, so it falls through to the default. A bare
  // framework default is only a guess, which an exported PORT the framework
  // reads legitimately displaces.
  const flag = matchPort(FLAG_PORT, script);
  if (flag) return { port: flag, fromCommand: true, fromConfig: false };
  if (script && VITE_PREVIEW.test(script)) {
    // `vite preview` defaults to 4173, but a `preview: { port: N }` in the
    // config overrides it — read that so the port matches what preview binds.
    const text = readViteConfig(appDir);
    const preview = text ? viteBlockPort(text, 'preview') : null;
    return { port: preview ?? 4173, fromCommand: true, fromConfig: false };
  }
  if (consumesPort(deps)) {
    const inline = matchPort(INLINE_PORT, script);
    if (inline) return { port: inline, fromCommand: true, fromConfig: false };
  }
  const config = detectConfigPort(appDir, deps, script);
  if (config) return { port: config, fromCommand: false, fromConfig: true };
  return { port: frameworkPort(deps), fromCommand: false, fromConfig: false };
}

// Frameworks whose dev server reads the generic `PORT` environment variable, so
// an exported `PORT` actually moves where they bind. Next, Create React App and
// Nuxt do; Vite, the Angular CLI and SvelteKit (Vite under the hood) do not —
// they take `--port` or a config value and ignore `PORT`. Getting this wrong is
// the exact timeout the port work exists to prevent: writing localhost:$PORT for
// a framework that never binds it.
// ponytail: dependency names only, same as WEB_DEPENDENCIES; extend the list if
// a real repo turns up another PORT-reading framework.
const PORT_CONSUMING_DEPENDENCIES = ['next', 'nuxt', 'react-scripts'];

function consumesPort(deps) {
  return deps.some((dep) => PORT_CONSUMING_DEPENDENCIES.includes(dep));
}

function detectBootstrapScript(pkg) {
  const scripts = pkg.scripts ?? {};
  for (const name of ['postinstall', 'bootstrap', 'setup']) {
    if (scripts[name]) return name;
  }
  return null;
}

// Candidate test-id attributes, in tie-break priority order: the Playwright
// default first, so a tie or an empty repo lands on the value the config would
// carry anyway.
const TEST_ID_CANDIDATES = ['data-testid', 'data-test', 'data-cy', 'data-test-id'];
const SOURCE_EXTENSIONS = /\.(tsx|jsx|ts|js|mjs|cjs|vue|svelte|astro|html)$/;
// Skip content that names the attribute without rendering it: unit-test and
// story files reference selectors as strings (`getByTestId('...')`) and often
// mention a non-UI attribute far more than the app's actual markup does.
const TESTID_SKIP_FILES = /\.(test|spec|stories|story|cy)\.[^.]+$|\.d\.ts$/;
const TESTID_SCAN_IGNORE_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  'out',
  'e2e',
  '__tests__',
  '__mocks__',
]);
const TESTID_SCAN_FILE_CAP = 2000;
const TESTID_SCAN_MAX_DEPTH = 6;

// The most-used test-id attribute across the repo's web source, or null when
// none appears. `use.testIdAttribute` in the scaffolded config is set from this
// so `getByTestId` resolves against what components actually annotate — a
// data-cy/data-test repo stops getting silent no-ops from Playwright's
// data-testid default. Counts only the forms that actually render the
// attribute, not bare mentions, so a comment or a plain string literal naming
// it does not sway the ranking:
//   data-cy="x" / data-cy={x} / :data-cy="x"   JSX, HTML, Vue/Svelte bindings
//   [attr.data-cy]="x" / [data-cy]="x"         Angular property binding (]=)
//   'data-cy': x                               object-literal prop (createElement/h)
// The `(?![-\w])` lookahead stops `data-test` counting inside
// `data-testid`/`data-test-id`. Test and story files are skipped for the same
// reason. A full syntax-aware parse is deliberately not attempted — this is a
// best-effort heuristic with a data-testid fallback. Bounded by depth and a
// file cap so a big repo stays cheap.
function detectTestIdAttribute(repoRoot) {
  const counts = Object.fromEntries(TEST_ID_CANDIDATES.map((attr) => [attr, 0]));
  const patterns = TEST_ID_CANDIDATES.map((attr) => [
    attr,
    new RegExp(`\\b${attr}(?![-\\w])(?:\\s*\\]?\\s*=|['"]\\s*:)`, 'g'),
  ]);
  let scanned = 0;
  const walk = (dir, depth) => {
    if (depth > TESTID_SCAN_MAX_DEPTH || scanned >= TESTID_SCAN_FILE_CAP) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (scanned >= TESTID_SCAN_FILE_CAP) return;
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || TESTID_SCAN_IGNORE_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name), depth + 1);
      } else if (SOURCE_EXTENSIONS.test(entry.name) && !TESTID_SKIP_FILES.test(entry.name)) {
        scanned += 1;
        let content;
        try {
          content = readFileSync(join(dir, entry.name), 'utf8');
        } catch {
          continue;
        }
        for (const [attr, pattern] of patterns) {
          const matches = content.match(pattern);
          if (matches) counts[attr] += matches.length;
        }
      }
    }
  };
  walk(repoRoot, 0);
  const ranked = TEST_ID_CANDIDATES.filter((attr) => counts[attr] > 0).sort(
    (a, b) => counts[b] - counts[a] || TEST_ID_CANDIDATES.indexOf(a) - TEST_ID_CANDIDATES.indexOf(b),
  );
  return ranked[0] ?? null;
}

// Resolve the test-id attribute to write into the config, from a detect()
// report. Falls back to Playwright's own default when detection found nothing,
// mirroring resolvePackageManager's null-handling.
export function resolveTestIdAttribute(report) {
  return report.testIdAttribute ?? 'data-testid';
}

function detectTaskRunner(repoRoot) {
  if (existsSync(join(repoRoot, 'turbo.json'))) return 'turbo';
  if (existsSync(join(repoRoot, 'nx.json'))) return 'nx';
  if (existsSync(join(repoRoot, 'lerna.json'))) return 'lerna';
  return null;
}

// Config filenames and deps that mark a repo as running each linter. Kept local
// to detect.mjs rather than imported from scaffold.mjs (which already imports
// this module — importing back would cycle). The flat/legacy eslint split does
// not matter here: both mean "the repo lints with ESLint", which is the one
// distinction the linter answer turns on.
const ESLINT_CONFIG_FILES = [
  'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts',
  '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.yml', '.eslintrc.yaml', '.eslintrc.json', '.eslintrc',
];
const BIOME_CONFIG_FILES = ['biome.json', 'biome.jsonc'];

function hasDep(pkg, name) {
  return Boolean(pkg.dependencies?.[name] || pkg.devDependencies?.[name]);
}

// Which linter the repo already uses, so e2e-setup follows it instead of
// imposing ESLint. 'eslint' | 'biome' | 'none' — read from the repo ROOT, where
// both Biome and ESLint resolve their repo-wide config from (the motivating
// #447 case is a root `biome.json`). It is deliberately NOT aggregated across a
// monorepo's workspaces: the e2e suite is self-contained and the app it tests
// is not chosen until after this scan, so there is no "selected app" to scope
// to here, and OR-ing every workspace lets an unrelated ESLint package impose
// ESLint on a Biome app. The human confirms the detected default at setup's
// approval gate and can override it for the rare per-workspace-only linter.
// ESLint wins when the root has both: it already runs ESLint, so the suite's
// eslint-plugin-playwright rules impose nothing foreign; the repo defers to
// Biome only when the root runs Biome and not ESLint.
function detectLinter(repoRoot) {
  const pkg = readPackageJson(repoRoot);
  if (ESLINT_CONFIG_FILES.some((file) => existsSync(join(repoRoot, file))) || hasDep(pkg, 'eslint')) return 'eslint';
  if (BIOME_CONFIG_FILES.some((file) => existsSync(join(repoRoot, file))) || hasDep(pkg, '@biomejs/biome')) return 'biome';
  return 'none';
}

// Resolve the linter to follow, from a detect() report. detectLinter always
// returns a concrete value, so this only guards a report that predates linter
// detection — mirroring resolveTestIdAttribute's null-handling.
export function resolveLinter(report) {
  return report.linter ?? 'none';
}

const CONFIG_EXTENSIONS = ['ts', 'js', 'mjs', 'cjs'];

// Report an existing E2E framework so e2e-setup can warn before adding a second
// one. Cypress: a cypress.config.* file or a cypress/ directory. Selenium /
// WebDriver: a wdio.conf.* file. Probed across every candidate location (repo
// root and discovered workspaces), since a monorepo keeps its suite under the
// web app, not the root. Returns null when neither is present anywhere.
function detectExistingE2eFramework(dirs) {
  const hasConfig = (dir, base) => CONFIG_EXTENSIONS.some((ext) => existsSync(join(dir, `${base}.${ext}`)));
  for (const dir of dirs) {
    if (hasConfig(dir, 'cypress.config') || existsSync(join(dir, 'cypress'))) return 'cypress';
    if (hasConfig(dir, 'wdio.conf')) return 'selenium';
  }
  return null;
}

const SECRET_LIKE_PATTERN = /auth|token|password|secret/i;

function redactSecretLine(line) {
  if (!SECRET_LIKE_PATTERN.test(line)) return line;
  const separatorIndex = Math.max(line.lastIndexOf('='), line.lastIndexOf(':'));
  return separatorIndex === -1 ? line : `${line.slice(0, separatorIndex + 1)} [redacted]`;
}

function readNotableLines(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map(redactSecretLine);
}

function detectNpmrc(repoRoot) {
  const path = join(repoRoot, '.npmrc');
  return existsSync(path) ? { present: true, notable: readNotableLines(path) } : { present: false, notable: [] };
}

function detectYarnrc(repoRoot) {
  const path = join(repoRoot, '.yarnrc.yml');
  return existsSync(path) ? { present: true, notable: readNotableLines(path) } : { present: false, notable: [] };
}

function parsePnpmWorkspaceYaml(content) {
  const packages = [];
  let inPackages = false;
  for (const rawLine of content.split('\n')) {
    const line = rawLine.replace(/#.*$/, '');
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    const flowMatch = line.match(/^packages:\s*\[(.*)\]\s*$/);
    if (flowMatch) {
      for (const item of flowMatch[1].split(',')) {
        const trimmed = item.trim().replace(/^['"]|['"]$/g, '');
        if (trimmed) packages.push(trimmed);
      }
      inPackages = false;
      continue;
    }
    if (!inPackages) continue;
    const match = line.match(/^\s*-\s*['"]?([^'"]+)['"]?\s*$/);
    if (match) {
      packages.push(match[1].trim());
    } else if (line.trim() !== '') {
      inPackages = false;
    }
  }
  return packages;
}

function expandWorkspacePatterns(repoRoot, patterns) {
  const paths = [];
  for (const pattern of patterns) {
    if (pattern.startsWith('!')) continue;
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -2);
      const dir = join(repoRoot, prefix);
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = `${prefix}/${entry.name}`;
        if (existsSync(join(repoRoot, candidate, 'package.json'))) paths.push(candidate);
      }
      continue;
    }
    if (existsSync(join(repoRoot, pattern, 'package.json'))) paths.push(pattern);
  }
  return paths;
}

// Conventional monorepo layout, scanned only when nothing is declared. Plenty
// of repos are a monorepo by directory convention alone — no `workspaces`
// field, no pnpm-workspace.yaml — and without this the only location found is
// the repo root, so the app itself never appears.
const CONVENTIONAL_MEMBER_PATTERNS = ['apps/*', 'packages/*'];

function discoverWorkspacePaths(repoRoot, rootPkg) {
  if (Array.isArray(rootPkg.workspaces)) {
    return expandWorkspacePatterns(repoRoot, rootPkg.workspaces);
  }
  if (Array.isArray(rootPkg.workspaces?.packages)) {
    return expandWorkspacePatterns(repoRoot, rootPkg.workspaces.packages);
  }
  const pnpmWorkspacePath = join(repoRoot, 'pnpm-workspace.yaml');
  if (existsSync(pnpmWorkspacePath)) {
    return expandWorkspacePatterns(repoRoot, parsePnpmWorkspaceYaml(readFileSync(pnpmWorkspacePath, 'utf8')));
  }
  // A declaring repo is never second-guessed: patterns that deliberately
  // exclude a directory keep excluding it. This runs only where there is no
  // declaration to honor.
  return expandWorkspacePatterns(repoRoot, CONVENTIONAL_MEMBER_PATTERNS);
}

// Dependency signals for what kind of app a location holds. `resolveWebServer`
// narrows its candidates to the `web` ones when any exist, which is what keeps
// a React Native sibling out of the webServer block.
const WEB_DEPENDENCIES = [
  'vite',
  'next',
  'nuxt',
  'react-dom',
  'react-router-dom',
  '@remix-run/react',
  'vue',
  'svelte',
  '@sveltejs/kit',
  '@angular/core',
  'webpack-dev-server',
];
const MOBILE_DEPENDENCIES = ['expo', 'expo-router', 'react-native'];
const MOBILE_DEPENDENCY_SCOPES = ['@react-navigation/'];

function declaredDependencies(pkg) {
  return Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });
}

// Expo declares `react-dom` for its web target, so a web signal alone would
// keep a mobile app in the candidate list. The mobile signal therefore vetoes
// rather than competing: an Expo/React Native package is never a web location,
// whatever else it depends on.
// ponytail: dependency names only — no config-file probing (app.json,
// vite.config.*). Add that only if a real repo turns up with neither signal in
// its package.json.
function classifyLocation(pkg) {
  const deps = declaredDependencies(pkg);
  const mobile = deps.some(
    (dep) => MOBILE_DEPENDENCIES.includes(dep) || MOBILE_DEPENDENCY_SCOPES.some((scope) => dep.startsWith(scope)),
  );
  return { web: !mobile && deps.some((dep) => WEB_DEPENDENCIES.includes(dep)), mobile };
}

// The workspace patterns that actually govern a given manager: pnpm reads
// pnpm-workspace.yaml only (it ignores package.json `workspaces`), while
// npm/yarn/bun read package.json `workspaces`. Selecting by manager matters for
// a repo that carries both a compat `workspaces` field and a pnpm-workspace.yaml.
function workspacePatternsFor(repoRoot, packageManager) {
  if (packageManager === 'pnpm') {
    const path = join(repoRoot, 'pnpm-workspace.yaml');
    return existsSync(path) ? parsePnpmWorkspaceYaml(readFileSync(path, 'utf8')) : [];
  }
  const pkg = readPackageJson(repoRoot);
  if (Array.isArray(pkg.workspaces)) return pkg.workspaces;
  if (Array.isArray(pkg.workspaces?.packages)) return pkg.workspaces.packages;
  return [];
}

// Match a single workspace glob against one path. Handles a leading `./`,
// exact paths, a one-level `*` segment, and `**` globstar spanning any depth
// including zero segments (so `**/e2e/*` and `e2e/**/web` match `e2e/web`) —
// the forms real workspace declarations use for a member like e2e/web.
// ponytail: no brace/char-class/extglob support — those are rare in a
// `workspaces` list and the notice is a "may" warning, not a guarantee. Add
// them only if a real declaration needs them.
function matchesWorkspaceGlob(glob, path) {
  const normalized = glob.replace(/^\.\//, '').replace(/\/$/, '');
  let source = '';
  for (let i = 0; i < normalized.length; i += 1) {
    if (normalized.startsWith('**/', i)) {
      source += '(?:.*/)?'; // globstar + separator, zero segments allowed
      i += 2;
    } else if (normalized.startsWith('**', i)) {
      source += '.*';
      i += 1;
    } else if (normalized[i] === '*') {
      source += '[^/]*';
    } else {
      source += normalized[i].replace(/[.+^${}()|[\]\\?]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`).test(path);
}

// Is `relativePath` an actual member of the repo's workspace, for the manager
// that will run the install? Checks membership by pattern (honoring `!`
// exclusions, last match wins), not by the mere presence of a workspaces field
// — a repo whose patterns exclude the path installs it standalone. The path
// needs its own package.json to be a member.
export function isWorkspaceMember(repoRoot, relativePath, packageManager) {
  if (!existsSync(join(repoRoot, relativePath, 'package.json'))) return false;
  let member = false;
  for (const pattern of workspacePatternsFor(repoRoot, packageManager)) {
    const negated = pattern.startsWith('!');
    if (matchesWorkspaceGlob(negated ? pattern.slice(1) : pattern, relativePath)) member = !negated;
  }
  return member;
}

export const STANDALONE_WEB_DIR = 'e2e/web';

// install-playwright.mjs installs into e2e/web as a self-contained sub-package
// on purpose, outside any declared workspace. Probe it directly so it's never
// missed just because no workspace pattern names it. The persisted root
// manifest's location is probed the same way: a suite scaffolded at a custom,
// non-workspace location (e.g. 'services/e2e') is otherwise invisible to every
// caller of detect() — run-specs/validate-specs would report 'no-playwright'
// for a suite that is right there on disk.
function discoverLocationPaths(repoRoot, rootPkg) {
  const paths = ['.', ...discoverWorkspacePaths(repoRoot, rootPkg)];
  const standaloneCandidates = [STANDALONE_WEB_DIR, readRootManifest(repoRoot)?.location].filter(Boolean);
  for (const candidate of standaloneCandidates) {
    if (!paths.includes(candidate) && existsSync(join(repoRoot, candidate, 'package.json'))) {
      paths.push(candidate);
    }
  }
  return paths;
}

export function detect(targetPath, options = {}) {
  const rootPkg = readPackageJson(targetPath);
  const packageManager = detectPackageManager(targetPath);
  const locationPaths = discoverLocationPaths(targetPath, rootPkg);
  const locationDirs = locationPaths.map((relativePath) =>
    relativePath === '.' ? targetPath : join(targetPath, relativePath),
  );
  // discoverLocationPaths reads the package.json `workspaces` field first, so it
  // misses a pnpm monorepo whose members live only in pnpm-workspace.yaml
  // (which a compat `workspaces` field may exclude). Union in the manager-aware
  // view so the framework probe below sees those members too. Resolve the
  // manager the way install does — Corepack `packageManager` field included —
  // so a lockfile-less pnpm repo still reads pnpm-workspace.yaml.
  const resolvedManager = resolvePackageManager({ packageManager, packageManagerField: rootPkg.packageManager ?? null });
  const e2eProbeDirs = [
    ...new Set([
      ...locationDirs,
      ...expandWorkspacePatterns(targetPath, workspacePatternsFor(targetPath, resolvedManager)).map((relativePath) =>
        join(targetPath, relativePath),
      ),
    ]),
  ];

  const locations = locationPaths.map((relativePath) => {
    const absolutePath = relativePath === '.' ? targetPath : join(targetPath, relativePath);
    const pkg = readPackageJson(absolutePath);
    const portInfo = detectPort(pkg, absolutePath);
    return {
      path: relativePath,
      playwright: detectPlaywright(absolutePath),
      startCommand: detectStartCommand(pkg),
      port: portInfo.port,
      portFromCommand: portInfo.fromCommand,
      portFromConfig: portInfo.fromConfig,
      consumesPort: consumesPort(declaredDependencies(pkg)),
      ...classifyLocation(pkg),
    };
  });

  return {
    packageManager,
    language: detectLanguage(targetPath, options),
    pinningStyle: detectPinningStyle(rootPkg),
    npmrc: detectNpmrc(targetPath),
    yarnrc: detectYarnrc(targetPath),
    engines: rootPkg.engines ?? null,
    packageManagerField: rootPkg.packageManager ?? null,
    taskRunner: detectTaskRunner(targetPath),
    linter: detectLinter(targetPath),
    typescript: detectTypeScript(targetPath),
    existingE2eFramework: detectExistingE2eFramework(e2eProbeDirs),
    bootstrapScript: detectBootstrapScript(rootPkg),
    testIdAttribute: detectTestIdAttribute(targetPath),
    locations,
  };
}

const isMainModule = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const targetPath = process.argv[2] ?? '.';
    console.log(JSON.stringify(detect(targetPath), null, 2));
  } catch (err) {
    console.log(JSON.stringify({ status: 'error', message: err.message }, null, 2));
    process.exitCode = 0;
  }
}
