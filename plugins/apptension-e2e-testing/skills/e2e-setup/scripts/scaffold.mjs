import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detect,
  resolveTestIdAttribute,
  resolvePackageManager,
  resolveLinter,
  resolveBiome,
  reachesBiomePlaywrightMin,
  BIOME_PLAYWRIGHT_MIN,
  PLAYWRIGHT_CONFIG_NAMES,
} from './detect.mjs';
import { resolveWebServer, runScriptCommand } from './web-server.mjs';
import { ENV_VARS, resolveEnvValues, writeEnvFile } from './env.mjs';
import { WEB_DIR, resolveLocation, rootRelativeCwd, resolveOverride } from './manifest.mjs';

// Re-exported so existing importers (write-specs.mjs, write-auth-setup.mjs,
// scaffold.test.ts) keep resolving this from scaffold.mjs.
export { WEB_DIR };

// Sub-directory names, relative to the suite location. Exported so
// write-specs.mjs's resolvers can join them onto an agent-passed location
// without restating the names.
export const SCAFFOLD_DIRS = { specs: 'specs', pages: 'pages', fixtures: 'fixtures' };

// ENV_VARS comes from env.mjs, which also resolves each name's value: one list
// feeds both the committed .env.example and the .env setup writes.
//
// Lives at e2e/web/.gitignore — scoped to the sub-package, so paths are local.
// '.yarn/' is Yarn Berry's install-state dir (node-modules linker); yarn.lock and
// .yarnrc.yml are deliberately NOT ignored — they define the sub-package. It only
// applies under Yarn: npm/pnpm/bun never create it, so listing it unconditionally
// is dead noise on those repos.
function gitignoreEntriesFor(pm) {
  const entries = ['node_modules/'];
  if (pm === 'yarn') entries.push('.yarn/');
  entries.push('.auth/', '.env', 'playwright-report/', 'test-results/', 'blob-report/');
  return entries;
}
const NPM_SCRIPTS = {
  'test:e2e': 'playwright test',
  'test:e2e:ui': 'playwright test --ui',
  'test:e2e:report': 'playwright show-report',
  'test:e2e:codegen': 'node codegen.mjs',
  'test:e2e:debug': 'playwright test --debug',
};

// `playwright codegen` never loads playwright.config, so shell-expanding
// $E2E_BASE_URL in the npm script would miss the .env value the config reads
// (npm only expands exported vars, and cmd.exe does not expand $VAR at all).
// This wrapper mirrors the config's .env loader, then passes the URL as codegen's
// positional argument. An exported var still wins over .env.
const CODEGEN_WRAPPER = `import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

for (const line of existsSync('.env') ? readFileSync('.env', 'utf8').split('\\n') : []) {
  const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (match && !(match[1] in process.env)) process.env[match[1]] = match[2];
}

// Resolve the Playwright CLI via the package's bin field, reachable through the
// always-exported package.json rather than the ./cli subpath, then run it
// directly with Node (no shell): the URL is a plain argv entry, so a query
// string, spaces, or other shell metacharacters pass through intact, and there
// is no cmd.exe .cmd-shim quirk to escape.
const require = createRequire(import.meta.url);
const pkg = require.resolve('@playwright/test/package.json');
const bin = require(pkg).bin;
const cli = join(dirname(pkg), typeof bin === 'string' ? bin : bin.playwright);
const url = process.env.E2E_BASE_URL;
const { status } = spawnSync(process.execPath, [cli, 'codegen', ...(url ? [url] : [])], {
  stdio: 'inherit',
});
process.exit(status ?? 1);
`;

// The gate: a `.smoke.spec.` filename is a whole-path test that blocks merge;
// no infix means a single-behaviour test for the nightly run. One pattern,
// read by both the smoke project's testMatch and the granular project's
// testIgnore below, so the two halves can never drift into overlapping or
// non-covering sets — a spec belongs to exactly one of them by construction,
// not because two independently-written globs happen to agree today.
// ts/js/mjs: what `generate` writes (.spec.ts, or .spec.js with no tsconfig)
// and what walkSpecs() above also counts (.mjs).
const SMOKE_SPEC_PATTERN = /.*\.smoke\.spec\.(ts|js|mjs)$/;

const smokeProjectName = (name) => `${name}-smoke`;

// `--project` native names, not a custom flag: both halves then show up in
// Playwright's UI mode and the IDE extension, and every other native flag
// (--headed, --repeat-each) keeps working, since this is still plain
// `playwright test` underneath. Quoted whenever a device name carries a space.
const projectFlag = (name) => (/\s/.test(name) ? `--project="${name}"` : `--project=${name}`);

// One pair of npm scripts derived from the same matrix `fullConfig` turns into
// projects, so the two can never name a project the matrix doesn't have.
function dynamicNpmScripts(browsers, devices, resolutions) {
  const names = resolveProjects(browsers, devices, resolutions).map(({ name }) => name);
  return {
    'test:e2e:smoke': `playwright test ${names.map((n) => projectFlag(smokeProjectName(n))).join(' ')}`,
    'test:e2e:granular': `playwright test ${names.map((n) => projectFlag(n)).join(' ')}`,
  };
}

// The lint script is added separately, not in NPM_SCRIPTS, because it must run
// only when a flat config is present — `eslint .` under ESLint 9 fails outright
// when the sub-package has only a legacy .eslintrc (which 9 does not load), so
// adding it there would inject a broken script into a repo we meant to leave
// alone. Added when we wrote our config, or an existing flat config is present.
const LINT_SCRIPT = { lint: 'eslint .' };

// The Biome suite's lint script. Added only when the suite holds a Biome config
// and the repo's Biome carries the Playwright rules, so it never runs a Biome
// that rejects the config.
const BIOME_LINT_SCRIPT = { lint: 'biome lint .' };

// Added only to a TypeScript suite, beside the tsconfig.json applyTsconfig
// writes. Playwright strips types without checking them, so this is the one
// place a type error in a spec or fixture fails before an editor shows it.
const TYPECHECK_SCRIPT = { typecheck: 'tsc --noEmit' };

// Root configs a suite tsconfig.json extends, first hit wins. An Nx repo keeps
// its compiler options in tsconfig.base.json, and its root tsconfig.json (if
// any) is often a solution file with no options of its own.
const ROOT_TSCONFIG_NAMES = ['tsconfig.base.json', 'tsconfig.json'];

// The standalone suite config, for a repo with no root tsconfig to extend.
// NodeNext needs TypeScript 4.7, and TypeScript 6 deprecates Node resolution,
// so no one pair of module settings works on every version. The scaffold runs
// before the suite's TypeScript is installed, so it writes NodeNext, and
// install-playwright rewrites the file to the legacy pair when the installed
// version is older. Exported so install-playwright can tell this file, left
// as written, from one somebody edited.
export function renderStandaloneTsconfig({ legacy = false } = {}) {
  return JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        ...(legacy ? { module: 'CommonJS', moduleResolution: 'Node' } : { module: 'NodeNext', moduleResolution: 'NodeNext' }),
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: ['node'],
      },
      include: ['**/*.ts'],
    },
    null,
    2,
  ) + '\n';
}

// The suite's own program: every .ts file in the package, Node types for
// `node:fs` and `process.env`, and no output. Extending a root config also
// resets three keys that config may set for the app. Its `rootDir` would fail
// every suite file with TS6059. Its `files` list is inherited through
// `extends`, which would type-check the app's own code here. Its `exclude` is
// inherited too, and one that keeps the app's `*.spec.ts` files out would
// keep the suite's specs out with them.
function renderTsconfig(rootConfig, location) {
  if (rootConfig) {
    // A bare name in `extends` resolves as a package, so a path always starts
    // with `.`.
    const path = relative(location, rootConfig).split(sep).join('/');
    return JSON.stringify(
      { extends: path.startsWith('.') ? path : `./${path}`, compilerOptions: { types: ['node'], noEmit: true, rootDir: '.' }, files: [], include: ['**/*.ts'], exclude: ['node_modules'] },
      null,
      2,
    ) + '\n';
  }
  return renderStandaloneTsconfig();
}

// Flat config for the self-contained sub-package. .mjs, not .js, because the
// scaffolded package.json has no "type": "module". Enables the plugin's
// recommended rules — where missing-playwright-await and no-networkidle are
// already errors — and promotes no-wait-for-timeout from its recommended `warn`
// to `error`, so a spec that sleeps or drops an await fails lint, not a run.
// The TS parser is what lets eslint read the `.ts` specs at all.
export const ESLINT_CONFIG = `import playwright from 'eslint-plugin-playwright';
import parser from '@typescript-eslint/parser';

export default [
  {
    ...playwright.configs['flat/recommended'],
    // Cover every spec extension SMOKE_SPEC_PATTERN and walkSpecs() recognize:
    // .ts, .js (a target with no tsconfig, from the generate skill), and .mjs
    // (a hand-authored spec) — a smoke-marked .mjs file that this scaffolder's
    // own project split runs would otherwise carry none of these rules.
    // The TS parser reads plain JS/ESM fine, so one block serves all three.
    files: ['**/*.ts', '**/*.js', '**/*.mjs'],
    languageOptions: {
      ...playwright.configs['flat/recommended'].languageOptions,
      parser,
    },
    rules: {
      ...playwright.configs['flat/recommended'].rules,
      'playwright/no-wait-for-timeout': 'error',
      // Page Object specs assert through <page>.assert.<matcher>() methods
      // named like Playwright's own matchers (toBeLoaded, toShowGuest). The
      // rule matches only a call's last name, so the pattern keys on that.
      'playwright/expect-expect': ['warn', { assertFunctionPatterns: ['^to[A-Z]'] }],
    },
  },
];
`;

// Flat-config filenames — the ones `eslint .` under ESLint 9 actually loads.
// Their presence (ours newly written, or one already there) is what makes the
// lint script safe to add.
export const FLAT_ESLINT_CONFIG_NAMES = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts'];

// True when e2e/web holds a flat eslint config eslint 9 would actually load —
// ours, or one already there. install-playwright uses this to decide whether the
// lint stack is safe to add; scaffold runs before it, so ours is already on disk.
export function hasFlatEslintConfig(webAbs) {
  return FLAT_ESLINT_CONFIG_NAMES.some((name) => existsSync(join(webAbs, name)));
}

// Any existing eslint config — flat or legacy — means the sub-package already
// lints, so we never write ours over it. Legacy .eslintrc.* names are included
// on purpose: under ESLint 9 a flat eslint.config.mjs silently takes precedence
// and the legacy config is ignored, so writing ours would break their lint
// rather than leave it working.
const LEGACY_ESLINT_CONFIG_NAMES = ['.eslintrc.js', '.eslintrc.cjs', '.eslintrc.yml', '.eslintrc.yaml', '.eslintrc.json', '.eslintrc'];
const ESLINT_CONFIG_NAMES = [...FLAT_ESLINT_CONFIG_NAMES, ...LEGACY_ESLINT_CONFIG_NAMES];

// Nested config for a Biome repo's suite. `root: false` marks it nested and
// `extends: "//"` inherits the repo's root config, so the repo's own formatter
// and rules still apply and these rules add to them. Every Playwright rule sits
// in Biome's nursery group, which the `playwright` domain does not switch on,
// so each rule is named. `useExpect` is off: it takes no options and counts
// only a call rooted at `expect` or `assert`, so it flags every Page Object
// spec. The assertion plugin covers the missing-assertion check instead.
export const BIOME_CONFIG = `{
  "root": false,
  "extends": "//",
  "plugins": ["./expect-assertion.grit"],
  "linter": {
    "rules": {
      "nursery": {
        "noPlaywrightWaitForTimeout": "error",
        "noPlaywrightMissingAwait": "error",
        "noPlaywrightNetworkidle": "error",
        "useExpect": "off"
      }
    }
  }
}
`;

// Biome's counterpart to the ESLint suite's playwright/expect-expect: a test
// with no expect() call and no Page Object assertion gets a warning. Page
// Objects assert through <page>.assert.<matcher>() methods named like
// Playwright's own matchers, so a call to any method named to<Matcher> counts,
// the same `^to[A-Z]` pattern the ESLint config sets. `test(name, body)` and
// `test(name, details, body)` are matched, bare and with each modifier that
// declares a test. The body has to be a function, because a conditional
// `test.skip(condition, 'reason')` inside a test has the same shape with a
// string where the callback goes. validate-specs recognises the plugin's
// diagnostic by its message, so the message is exported with it.
export const BIOME_ASSERTION_MESSAGE = 'Test has no assertion. Call expect() or a Page Object assertion method named to<Matcher>().';
export const BIOME_ASSERTION_PLUGIN = `language js

or {
  \`test($name, $body)\`,
  \`test($name, $details, $body)\`,
  \`test.$modifier($name, $body)\` where { $modifier <: or { \`only\`, \`skip\`, \`fixme\`, \`fail\`, \`slow\` } },
  \`test.$modifier($name, $details, $body)\` where { $modifier <: or { \`only\`, \`skip\`, \`fixme\`, \`fail\`, \`slow\` } }
} where {
  $body <: or { JsArrowFunctionExpression(), JsFunctionExpression() },
  $body <: not contains \`expect($...)\`,
  $body <: not contains \`$object.$matcher($...)\` where { $matcher <: r"^to[A-Z].*" },
  register_diagnostic(
    span=$name,
    message="${BIOME_ASSERTION_MESSAGE}",
    severity="warn"
  )
}
`;
const BIOME_PLUGIN_FILE = 'expect-assertion.grit';

// Suite-level Biome config filenames. Either one means the suite already has
// its own Biome config, which is left as it is.
export const BIOME_CONFIG_NAMES = ['biome.json', 'biome.jsonc'];

// True when the suite holds a Biome config, ours or one already there.
// install-playwright uses this to decide whether to add @biomejs/biome and run
// the lint; scaffold runs before it, so ours is already on disk.
export function hasBiomeConfig(webAbs) {
  return BIOME_CONFIG_NAMES.some((name) => existsSync(join(webAbs, name)));
}
const STORAGE_STATE = '.auth/user.json';

// Desktop browser keys map to a project name + Playwright device descriptor.
// Mobile/tablet targets come in via `devices` as raw Playwright descriptor
// names, enumerated live from the installed Playwright by the e2e-setup skill.
const BROWSER_PRESETS = {
  chromium: { name: 'chromium', device: 'Desktop Chrome' },
  firefox: { name: 'firefox', device: 'Desktop Firefox' },
  webkit: { name: 'webkit', device: 'Desktop Safari' },
};

// Playwright's Desktop descriptors default to 1280x720; desktop projects
// override that to full HD. Mobile projects keep their device viewport (no
// viewport key), so real phone/tablet dimensions are preserved.
const DESKTOP_VIEWPORT = { width: 1920, height: 1080 };

// "1920x1080" -> { width, height }. Trims the raw wizard/CLI string.
function parseResolution(res) {
  const [w, h] = res.split('x').map((n) => Number(n.trim()));
  return { width: w, height: h };
}

// With no resolutions chosen, keep #150's single default: one project per
// engine, named <engine>, at 1920x1080. With resolutions chosen, fan every
// engine across every resolution into <engine>-<WxH> projects, so tests run on
// each browser at each size. Mobile projects keep their device viewport either way.
function resolveProjects(browsers, devices, resolutions) {
  const presets = browsers.map((browser) => BROWSER_PRESETS[browser]).filter(Boolean);
  const desktop = resolutions.length
    ? presets.flatMap((preset) =>
        resolutions.map((res) => ({
          name: `${preset.name}-${res}`,
          device: preset.device,
          viewport: parseResolution(res),
        })),
      )
    : presets.map((preset) => ({ ...preset, viewport: DESKTOP_VIEWPORT }));
  const mobile = devices.map((device) => ({ name: device, device }));
  return [...desktop, ...mobile];
}

// The base fixture overrides \`page\` to watch every test's browser output:
// an uncaught page exception FAILS the test (a crash that a passing test would
// otherwise hide), while console.error output is attached as a report warning
// annotation — surfaced for a human/agent to triage, but never a failure, since
// benign console.error is common and would make the suite flaky.
// It also carries the auth mode: the shared saved login by default, or a login
// per worker under E2E_AUTH_MODE=per-worker, and it annotates a failed
// logged-in test that ends on the login page as `session-expired`.
// The triple-slash reference loads the Node types for `node:fs` and
// `process.env` on its own: TypeScript 6+ includes no @types package unless
// `types` names it. The suite's tsconfig.json names it too, and the reference
// keeps the file checking under a suite tsconfig.json that does not.
const FIXTURES_BASE = `/// <reference types="node" />
import { test as base, expect, type BrowserContextOptions, type Page } from '@playwright/test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { login } from './login';

export * from '@playwright/test';

// E2E_AUTH_MODE=per-worker: each worker logs in on its own through
// fixtures/login.ts and writes its session back after every test, for backends
// that rotate refresh tokens and blacklist the used one. There, one shared
// saved login is spent by the first refresh and every later test is logged
// out. Any other value keeps the shared saved login in .auth/user.json.
const perWorker = process.env.E2E_AUTH_MODE === 'per-worker';

// True when the page sits on the E2E_LOGIN_URL page. An absolute value must
// match the origin too; a relative one matches on the page's own origin. A
// query string is ignored, a trailing slash on either side is ignored, and a
// hash route (/#/login) is compared when the value has one.
const trimSlash = (path: string) => path.replace(/\\/+$/, '') || '/';
const hashRoute = (hash: string) => trimSlash(hash.split('?')[0]);

function isAbsoluteUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function onLoginPage(page: Page): boolean {
  const loginUrl = process.env.E2E_LOGIN_URL;
  if (!loginUrl) return false;
  try {
    const current = new URL(page.url());
    const target = new URL(loginUrl, current);
    if (isAbsoluteUrl(loginUrl) && target.origin !== current.origin) return false;
    if (trimSlash(current.pathname) !== trimSlash(target.pathname)) return false;
    return !target.hash || hashRoute(current.hash) === hashRoute(target.hash);
  } catch {
    return false;
  }
}

// The project's browser-context options, so the per-worker login runs on the
// same device, locale and network settings as the tests: every
// BrowserContextOptions key except the ones the test runner owns (storageState,
// recordVideo, recordHar, logger). The project's contextOptions merge
// underneath, and a top-level option wins, as it does in Playwright.
const CONTEXT_OPTIONS = [
  'acceptDownloads', 'baseURL', 'bypassCSP', 'clientCertificates', 'colorScheme', 'contrast',
  'deviceScaleFactor', 'extraHTTPHeaders', 'forcedColors', 'geolocation', 'hasTouch', 'httpCredentials',
  'ignoreHTTPSErrors', 'isMobile', 'javaScriptEnabled', 'locale', 'offline', 'permissions', 'proxy',
  'reducedMotion', 'screen', 'serviceWorkers', 'strictSelectors', 'timezoneId', 'userAgent', 'viewport',
] as const;

function contextOptions(use: object): BrowserContextOptions {
  const source = use as Record<string, unknown>;
  const picked = CONTEXT_OPTIONS.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]);
  return { ...(source.contextOptions as BrowserContextOptions | undefined), ...Object.fromEntries(picked) };
}

// A test started logged in when its storage state carries any cookie or
// origin, inline or in the file it names. A spec or project that opts out with
// an empty state is left alone. An unreadable file counts as a session, and
// Playwright reports the file itself.
function hasSession(state: unknown): boolean {
  if (!state) return false;
  if (typeof state === 'string') {
    try {
      const parsed: unknown = JSON.parse(readFileSync(state, 'utf8'));
      return typeof parsed === 'object' && hasSession(parsed);
    } catch {
      return true;
    }
  }
  const { cookies = [], origins = [] } = state as { cookies?: unknown[]; origins?: unknown[] };
  return cookies.length > 0 || origins.length > 0;
}


export const test = base.extend<{}, { workerStorageState: string | undefined }>({
  // Per-worker mode only: a fresh login at every worker start. A file left by
  // an earlier run holds a token that has already rotated, so it is
  // overwritten, never reused. A project with no saved login, such as setup
  // or one pinned to an empty state, gets none: it stays logged out.
  workerStorageState: [
    async ({ browser }, use, workerInfo) => {
      if (!perWorker || !hasSession(workerInfo.project.use.storageState)) return use(undefined);
      const file = \`.auth/worker-\${workerInfo.parallelIndex}.json\`;
      const context = await browser.newContext({ ...contextOptions(workerInfo.project.use), storageState: undefined });
      await login(await context.newPage());
      await context.storageState({ path: file });
      await context.close();
      await use(file);
    },
    { scope: 'worker' },
  ],
  // The worker file replaces the project's saved login only; a test-level
  // override (test.use({ storageState })) is kept.
  storageState: async ({ storageState, workerStorageState }, use, testInfo) => {
    const projectState = testInfo.project.use.storageState;
    const projectDefault = hasSession(projectState) && JSON.stringify(storageState) === JSON.stringify(projectState);
    await use(workerStorageState && projectDefault ? workerStorageState : storageState);
  },
  // A failed logged-in test with a page left on the login page lost its
  // session: annotate it for run-specs, whether the test used page or opened
  // its own pages. In per-worker mode every test context then writes its
  // session back to the worker file, because a rotated refresh token lives only
  // in this context until it is written. A page left on the login page means
  // the worker logs in again first and saves a live session. Only a test that
  // ran on the worker's own file writes; a test on another saved login (a
  // second role) would overwrite it.
  context: async ({ context, storageState, workerStorageState }, use, testInfo) => {
    await use(context);
    const stale = hasSession(storageState) ? context.pages().find((page) => onLoginPage(page)) : undefined;
    if (stale && testInfo.status !== testInfo.expectedStatus) {
      testInfo.annotations.push({ type: 'session-expired', description: perWorker ? 'per-worker' : 'shared' });
    }
    if (!workerStorageState || storageState !== workerStorageState) return;
    if (stale) {
      try {
        await login(stale);
      } catch (error) {
        testInfo.annotations.push({ type: 'warning', description: \`per-worker auth: re-login failed: \${(error as Error).message}\` });
        return;
      }
    }
    try {
      await context.storageState({ path: workerStorageState });
    } catch (error) {
      testInfo.annotations.push({ type: 'warning', description: \`per-worker auth: saving the session failed: \${(error as Error).message}\` });
    }
  },
  page: async ({ page }, use, testInfo) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    // Responses >= 400 during the case: the signal that usually explains a
    // failure a screenshot only shows the symptom of. Method + URL + status.
    // Scoped to this page's context, so it is exclusive to this case even
    // under parallel workers.
    const networkFailures: { method: string; url: string; status: number }[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('response', (response) => {
      if (response.status() >= 400) {
        networkFailures.push({ method: response.request().method(), url: response.url(), status: response.status() });
      }
    });

    // The boot step writes one app.log for the whole run. Under a single
    // worker cases run one at a time, so the byte slice a case appends between
    // its start and end is exclusive to it; under parallel workers that slice
    // would splice in other concurrent cases' lines, so it is not captured.
    // E2E_APP_LOG_PATH is set by run-specs; a direct \`playwright test\` leaves
    // it unset, so app-log capture is skipped then.
    const appLogPath = process.env.E2E_APP_LOG_PATH;
    const serial = testInfo.config.workers === 1;
    const appLogStart = serial && appLogPath && existsSync(appLogPath) ? statSync(appLogPath).size : 0;

    await use(page);

    for (const text of consoleErrors) {
      testInfo.annotations.push({ type: 'warning', description: \`console.error: \${text}\` });
    }

    // Attach before the throwing assertion below, so a case that fails *on*
    // that assertion still carries the evidence. A clean pass attaches
    // nothing, keeping its result small. Cap before attaching (newest kept):
    // an unbounded slice must not balloon the attachment; the runner caps
    // again on read.
    const failed = testInfo.status !== testInfo.expectedStatus;

    if (failed || pageErrors.length > 0) {
      if (networkFailures.length > 0) {
        await testInfo.attach('network-failures', { body: JSON.stringify(networkFailures.slice(-50)), contentType: 'application/json' });
      }
      if (appLogPath && !serial) {
        // The shared log cannot be sliced per case under parallel workers, so
        // record why the slice is absent rather than leaving it silent.
        testInfo.annotations.push({
          type: 'warning',
          description: 'app-log: slice skipped under parallel execution (workers > 1); re-run with a single worker to capture it',
        });
      } else if (appLogPath && existsSync(appLogPath)) {
        const slice = readFileSync(appLogPath).subarray(appLogStart).toString('utf8');
        const lines = slice.split('\\n').filter((line) => line.length > 0).slice(-200);
        if (lines.length > 0) await testInfo.attach('app-log', { body: JSON.stringify(lines), contentType: 'application/json' });
      }
    }

    expect(pageErrors, \`uncaught page errors:\\n\${pageErrors.join('\\n')}\`).toEqual([]);
  },
  // Generated page objects and fixtures plug in here.
});
`;

// Marks e2e/web/auth.setup.ts as this scaffolder's own output — stub or a
// prior working render alike — so write-auth-setup's overwrite guard can tell
// "scaffold wrote this earlier" (safe to regenerate) from a suite's genuine
// hand-authored login (never touch). Exported so the guard imports this exact
// literal instead of restating it and risking drift.
export const AUTH_SETUP_MARKER = '@generated by apptension-e2e-testing e2e-setup';

// A repo scaffolded by a plugin version older than AUTH_SETUP_MARKER has a stub
// with no marker at all, but still carries this commented placeholder line (see
// the stub branch of renderAuthSetup below) — a genuine hand-authored login has
// neither. Kept verbatim, not re-derived, so it can never drift from the string
// the stub branch actually emits.
export const LEGACY_STUB_SIGNAL = "// await page.getByLabel('Email').fill(process.env.E2E_USER_EMAIL);";

// Overwritable by write-auth-setup's guard: carries the marker (current stub or
// a prior working render), OR predates the marker but is still recognizably the
// stub (the commented placeholder survives untouched either way). Exported so
// the guard imports this exact rule instead of restating it.
export function isRegeneratableAuthSetup(content) {
  return content.includes(AUTH_SETUP_MARKER) || content.includes(LEGACY_STUB_SIGNAL);
}

// A repo scaffolded before AUTH_SETUP_MARKER was added to playwright.config.ts
// (see fullConfig below) has a marker-less config that still carries this
// .env-loader comment line, which fullConfig has always emitted, current
// template included — a hand-authored config has neither. Kept verbatim, not
// re-derived, so it can never drift from the string fullConfig actually
// emits.
export const LEGACY_CONFIG_SIGNAL = "Fill process.env from this package's .env";

// Overwritable by scaffold's config-ownership check below: carries the marker
// (current or a prior working render), OR predates the marker but is still
// recognizably fullConfig's own output (the .env-loader comment survives
// untouched either way). AUTH_SETUP_MARKER doubles as the config's own
// generated-marker here — fullConfig stamps the same literal into
// playwright.config.ts (see line ~415) that renderAuthSetup stamps into
// auth.setup.ts, so one marker covers both files.
export function isRegeneratableConfig(content) {
  return content.includes(AUTH_SETUP_MARKER) || content.includes(LEGACY_CONFIG_SIGNAL);
}

// The Playwright config actually present under a suite location, as
// { name, path }, or null when none is. PLAYWRIGHT_CONFIG_NAMES order decides
// which wins when several exist — the .ts the scaffolder owns comes first. The
// create/report path reads the real filename from here rather than assuming
// playwright.config.ts, so a suite hand-configured in .js is gated and reported
// against the config it actually has, not a .ts that was never there.
function presentPlaywrightConfig(webAbs) {
  for (const name of PLAYWRIGHT_CONFIG_NAMES) {
    const path = join(webAbs, name);
    if (existsSync(path)) return { name, path };
  }
  return null;
}

// True when the scaffolder may author playwright.config.ts here: either no
// config is present at all, or the only one present is our own regeneratable
// .ts. Any other config — a hand-authored .ts, or a .js/.mjs/.cjs in any
// form — means the suite is not ours, so we neither clobber it nor drop a
// competing .ts beside it. classify() calls a spec-less foreign suite 'fresh',
// so ownership, not mode, is the gate.
function ownsConfigAt(webAbs) {
  const present = presentPlaywrightConfig(webAbs);
  if (!present) return true;
  return present.name === 'playwright.config.ts' && isRegeneratableConfig(readFileSync(present.path, 'utf8'));
}

// One template for both the stub and the working file, so the two cannot
// drift. No opts → the stub: goto '/', login lines commented, and a comment
// stating plainly it ships as a stub, not a working login. With selectors →
// the working file: call login() from fixtures/login.ts (the one copy of the
// selectors, which per-worker mode in fixtures/base.ts reuses), which asserts
// the login form is gone, then save the state. Either way it imports from
// ./fixtures/base so the page-error listener fails setup on a login-page crash.
// Each branch ends on an assertion (the page rendered), so the file
// passes eslint-plugin-playwright's expect-expect rule.
export function renderAuthSetup(opts) {
  const imports = opts
    ? `import { test as setup, expect } from './fixtures/base';
import { login } from './fixtures/login';`
    : `import { test as setup, expect } from './fixtures/base';`;
  const header = `${imports}

// ${AUTH_SETUP_MARKER} — safe to regenerate; edits here are overwritten.

const authFile = '${STORAGE_STATE}';

setup('authenticate', async ({ page }) => {`;
  const footer = `
  await page.context().storageState({ path: authFile });
});
`;
  if (!opts) {
    return `${header}
  // STUB — not a working login. Setup could not resolve a login URL and
  // credentials, so this ships as a stub. Replace with your app's real login,
  // or re-run setup once E2E_LOGIN_URL / E2E_USER_EMAIL / E2E_USER_PASSWORD are
  // set in .env (gitignored). See .env.example.
  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();
  // await page.getByLabel('Email').fill(process.env.E2E_USER_EMAIL);
  // await page.getByLabel('Password').fill(process.env.E2E_USER_PASSWORD);
  // await page.getByRole('button', { name: 'Sign in' }).click();
  // await page.waitForURL('**/');
${footer}`;
  }
  return `${header}
  // The login steps live in fixtures/login.ts, which per-worker mode reuses.
  // login() itself asserts the form is gone; a single-page app may log in
  // without leaving the URL, so the page is only checked for having rendered.
  await login(page);
  await expect(page.locator('body')).toBeVisible();
${footer}`;
}

// fixtures/login.ts: the app's login steps, in one place. auth.setup.ts calls
// it once for the shared saved login; fixtures/base.ts calls it per worker when
// E2E_AUTH_MODE=per-worker. It imports only from @playwright/test, so base.ts
// can import it without a cycle. The stub throws, and only per-worker mode
// calls it, so a stub suite in the shared mode never reaches it.
export function renderLogin(opts) {
  if (!opts) {
    return `import type { Page } from '@playwright/test';

// ${AUTH_SETUP_MARKER} — safe to regenerate; edits here are overwritten.

// STUB — not a working login. Only E2E_AUTH_MODE=per-worker calls this.
export async function login(page: Page): Promise<void> {
  throw new Error(
    \`fixtures/login.ts is a stub — run e2e-setup's write-auth-setup, or write the app's login steps here (page: \${page.url()})\`,
  );
}
`;
  }
  const { emailSelector, passwordSelector, submitSelector, waitUrl } = opts;
  return `/// <reference types="node" />
import { expect, type Page } from '@playwright/test';

// ${AUTH_SETUP_MARKER} — safe to regenerate; edits here are overwritten.

// Credentials come from environment variables (names only; set real values
// in .env, which is gitignored). See .env.example. An unset one fails here,
// by name, and keeps this file (and base.ts, which imports it) tsc --strict.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(\`\${name} is not set — fill it in the suite's .env\`);
  return value;
}

export async function login(page: Page): Promise<void> {
  await page.goto(requireEnv('E2E_LOGIN_URL'));
  await page.${emailSelector}.fill(requireEnv('E2E_USER_EMAIL'));
  await page.${passwordSelector}.fill(requireEnv('E2E_USER_PASSWORD'));
  await page.${submitSelector}.click();
  await page.waitForURL(${waitUrl});
  await expect(page.${emailSelector}).toBeHidden();
}
`;
}

// Named with a hyphen, not `global.setup.ts`, so the setup project's
// testMatch (/.*\.setup\.ts/) does not pick it up as a test file.
const GLOBAL_SETUP_FILE = 'global-setup.ts';

// Shipped as a no-op: a fresh scaffold assumes nothing about the target
// database, so wiring this in cannot turn an existing suite red. The comments
// are the deliverable — they name this file as the place suite-wide data is
// seeded and reset, instead of leaving each spec to hope a row already exists.
const GLOBAL_SETUP = `// Runs once before the whole suite, and again — via the function it returns —
// after the last test. Playwright calls it with no test context, which is what
// makes it the place for data every spec depends on and no spec owns.
export default async function globalSetup() {
  // Seed here: the account \`auth.setup.ts\` logs in as, reference data the app
  // needs before any page renders, the one workspace/project a list view is
  // expected to show. Data a single case uses belongs in that case instead,
  // created under a unique name so parallel workers cannot collide.
  //
  // Reset by returning a teardown function. Undo only what this file created
  // — never wipe a database the suite does not own:
  //
  //   return async () => { await deleteSeedData(); };
  //
  // Left empty on purpose. A suite that passes against an empty database is
  // the goal; anything it needs is seeded above, not assumed.
}
`;

// CI-only reporters and the Playwright minor that introduced each: 'github'
// (annotations) in 1.20, 'blob' (blob-report/) in 1.37. Older wins the reporter
// gate below.
const CI_REPORTERS = [
  { name: 'github', since: [1, 20] },
  { name: 'blob', since: [1, 37] },
];

// The LOWEST [major, minor] the (possibly disjunctive) range could resolve to —
// the safe floor for the reporter gate — or null when it names no version.
// `^1.61.0 || ^1.30.0` floors at 1.30, not the first pair 1.61, so a lockfile
// that resolves the low arm still loads its reporters. '*' / 'latest' match
// nothing -> null (handled as unresolved by ciReporters).
function parseMinor(pwVersion) {
  const pairs = pwVersion && String(pwVersion).match(/(\d+)\.(\d+)/g);
  if (!pairs) return null;
  return pairs
    .map((p) => p.split('.').map(Number))
    .reduce((lo, cur) => (cur[0] < lo[0] || (cur[0] === lo[0] && cur[1] < lo[1]) ? cur : lo));
}

// Split CI_REPORTERS into what the pinned Playwright supports and what it is too
// old for, so the generated config loads instead of throwing 'Unknown reporter'
// under CI before any test runs (#384).
export function ciReporters(pwVersion) {
  const allNames = CI_REPORTERS.map((r) => r.name);
  // No pin detected at all: the install step adds a current Playwright, so keep
  // every reporter.
  if (pwVersion == null) return { kept: allNames, dropped: [] };
  const version = parseMinor(pwVersion);
  // A declaration with no readable version floor ('*', 'latest', 'workspace:*',
  // an open or disjunctive range): the resolved version is unknown and a
  // committed lockfile may pin an old one. ponytail: gate conservatively —
  // drop every version-gated reporter rather than read three lockfile formats
  // to resolve it; a dropped reporter loads, a kept-but-unsupported one crashes.
  if (!version) return { kept: [], dropped: allNames };
  const ok = ([major, minor]) => version[0] > major || (version[0] === major && version[1] >= minor);
  return {
    kept: CI_REPORTERS.filter((r) => ok(r.since)).map((r) => r.name),
    dropped: CI_REPORTERS.filter((r) => !ok(r.since)).map((r) => r.name),
  };
}

// The CI reporter spread for the generated config, or '' when the pin supports
// none — so an old pin drops the line entirely rather than emitting an empty
// `...(process.env.CI ? [] : [])`.
function ciReporterLine(pwVersion) {
  const kept = ciReporters(pwVersion).kept;
  if (kept.length === 0) return '';
  // `as const` keeps each entry a tuple, the type Playwright's reporter list
  // takes, so the config passes `tsc --strict`.
  return `\n    ...(process.env.CI ? ([${kept.map((n) => `['${n}']`).join(', ')}] as const) : []),`;
}

export function fullConfig(browsers, devices = [], resolutions = [], testIdAttribute = 'data-testid', pwVersion = null, location = WEB_DIR) {
  const projects = resolveProjects(browsers, devices, resolutions)
    .flatMap(({ name, device, viewport }) => {
      const vp = viewport ? `viewport: { width: ${viewport.width}, height: ${viewport.height} }, ` : '';
      const use = `use: { ...devices['${device}'], ${vp}storageState: '${STORAGE_STATE}' },`;
      return [
        `    {
      name: '${name}',
      ${use}
      testIgnore: ${SMOKE_SPEC_PATTERN},
      dependencies: ['setup'],
    },`,
        `    {
      name: '${smokeProjectName(name)}',
      ${use}
      testMatch: ${SMOKE_SPEC_PATTERN},
      dependencies: ['setup'],
    },`,
      ];
    })
    .join('\n');

  return `import { existsSync, readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// ${AUTH_SETUP_MARKER} — safe to regenerate; edits here are overwritten.

// Fill process.env from this package's .env, without overriding anything the
// real environment already set — an exported var or a CI secret always wins.
// Resolved against the cwd Playwright runs in, which is this package for both
// \`npm run test:e2e\` and the generate skill's runner; when it isn't, the file
// is simply skipped and exported vars still apply.
for (const line of existsSync('.env') ? readFileSync('.env', 'utf8').split('\\n') : []) {
  const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (match && !(match[1] in process.env)) process.env[match[1]] = match[2];
}

export default defineConfig({
  testDir: '.',
  globalSetup: './${GLOBAL_SETUP_FILE}',
  forbidOnly: !!process.env.CI,
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  // 'list' first: a run with no config override otherwise prints nothing to
  // the console, so a smoke run's test count and duration would be invisible
  // outside the html report. 'open: never' keeps a local run from popping a
  // browser. 'github' (annotations) and 'blob' (blob-report/, already
  // gitignored) are CI-only, and gated to what the pinned Playwright supports.
  reporter: [
    ['list'],
    ['html', { open: 'never' }],${ciReporterLine(pwVersion)}
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL,
    testIdAttribute: '${testIdAttribute}',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    ...(process.env.E2E_BASIC_AUTH_USER
      ? {
          httpCredentials: {
            username: process.env.E2E_BASIC_AUTH_USER,
            // httpCredentials takes a string, so an unset password is sent empty.
            password: process.env.E2E_BASIC_AUTH_PASSWORD ?? '',
          },
        }
      : {}),
  },
  // Spread, not a conditional value: with no E2E_WEB_SERVER_COMMAND the key is
  // absent entirely, which is exactly the attach-to-a-running-app behavior this
  // config had before webServer existed.
  ...(process.env.E2E_WEB_SERVER_COMMAND
    ? {
        webServer: {
          command: process.env.E2E_WEB_SERVER_COMMAND,
          url: process.env.E2E_BASE_URL,
          cwd: process.env.E2E_WEB_SERVER_CWD || '${rootRelativeCwd(location)}',
          reuseExistingServer: !process.env.CI,
        },
      }
    : {}),
  projects: [
    { name: 'setup', testMatch: /.*\\.setup\\.ts/ },
${projects}
  ],
});
`;
}

// Pin the sub-package's @playwright/test to whatever version is already
// installed nearby, so `npm install` inside e2e/web is reproducible. Returns a
// caret range, or null when no install is found (the install step adds it).
export function detectPlaywrightVersion(targetPath, location = WEB_DIR) {
  // The suite dir first: the config runs from there, so a local install shadows
  // the root one at load. Gating off root while the suite resolves an older copy
  // is exactly the 'Unknown reporter' crash this detection exists to prevent.
  const installed = [
    join(targetPath, location, 'node_modules/@playwright/test/package.json'),
    join(targetPath, 'node_modules/@playwright/test/package.json'),
  ];
  for (const path of installed) {
    if (!existsSync(path)) continue;
    try {
      return `^${JSON.parse(readFileSync(path, 'utf8')).version}`;
    } catch {
      // unreadable / malformed — fall through to the next candidate
    }
  }
  // No install found: fall back to the version DECLARED in a nearby
  // package.json. setup scaffolds before installing and preserves an existing
  // e2e/web pin, so a target already pinned to an old @playwright/test would
  // otherwise read as "unknown" here and get both CI reporters — then crash on
  // 'Unknown reporter "blob"' once that old version installs (#384). The
  // declared range's floor is the safe signal for the reporter gate: too-low
  // over-drops a reporter (config still loads), never the reverse.
  for (const path of [join(targetPath, location, 'package.json'), join(targetPath, 'package.json')]) {
    if (!existsSync(path)) continue;
    try {
      const pkg = JSON.parse(readFileSync(path, 'utf8'));
      const declared = pkg.devDependencies?.['@playwright/test'] ?? pkg.dependencies?.['@playwright/test'];
      if (declared) return declared;
    } catch {
      // unreadable / malformed — fall through
    }
  }
  return null;
}

function walkSpecs(dir, depth, acc) {
  if (depth < 0 || !existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkSpecs(path, depth - 1, acc);
    else if (/\.spec\.(ts|js|mjs)$/.test(entry.name)) acc.push(path);
  }
  return acc;
}

// 'fresh' | 'conform'. A suite whose location has no Playwright config yet is
// fresh: create-if-absent for structure, and create-or-regenerate for the
// config (rewritten only when the projects changed; identical content still
// skips). An e2e/web that already holds a Playwright config AND specs is
// conform: report, touch nothing unless --create-missing.
export function classify(targetPath, location) {
  const webAbs = join(targetPath, location);
  // Conform means a real Playwright suite is already here, so leave it alone
  // (touch nothing unless --create-missing). Any config filename Playwright
  // loads counts — a suite configured in playwright.config.js is still a
  // suite, and classifying it fresh would regenerate a second, conflicting
  // playwright.config.ts beside it. The fresh path creates and owns the .ts
  // config; the conform path writes nothing, so it does not depend on the
  // filename.
  const hasConfig = PLAYWRIGHT_CONFIG_NAMES.some((name) => existsSync(join(webAbs, name)));
  if (hasConfig && existsSync(webAbs) && walkSpecs(webAbs, 4, []).length > 0) return 'conform';
  return 'fresh';
}

function ensureDir(absPath, relPath, created, skipped) {
  if (existsSync(absPath)) return skipped.push(relPath);
  mkdirSync(absPath, { recursive: true });
  created.push(relPath);
}

function writeIfAbsent(absPath, relPath, contents, created, skipped) {
  if (existsSync(absPath)) return skipped.push(relPath);
  mkdirSync(join(absPath, '..'), { recursive: true });
  writeFileSync(absPath, contents);
  created.push(relPath);
}

function appendLinesIfAbsent(absPath, relPath, lines, created, skipped) {
  const existing = existsSync(absPath) ? readFileSync(absPath, 'utf8') : '';
  const present = new Set(existing.split('\n').map((line) => line.trim()));
  const toAdd = lines.filter((line) => !present.has(line.trim()));
  if (toAdd.length === 0) return skipped.push(relPath);
  const prefix = existing.length && !existing.endsWith('\n') ? '\n' : '';
  writeFileSync(absPath, existing + prefix + toAdd.join('\n') + '\n');
  created.push(relPath);
}

function writePackageJson(webAbs, location, pwVersion, created, skipped) {
  const rel = `${location}/package.json`;
  const pkgPath = join(webAbs, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    let changed = false;
    pkg.scripts = pkg.scripts ?? {};
    for (const [key, value] of Object.entries(NPM_SCRIPTS)) {
      if (!(key in pkg.scripts)) {
        pkg.scripts[key] = value;
        changed = true;
      }
    }
    if (pwVersion) {
      pkg.devDependencies = pkg.devDependencies ?? {};
      if (!pkg.devDependencies['@playwright/test']) {
        pkg.devDependencies['@playwright/test'] = pwVersion;
        changed = true;
      }
    }
    if (!changed) return skipped.push(rel);
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    return created.push(rel);
  }
  const pkg = {
    name: 'e2e-web',
    private: true,
    scripts: { ...NPM_SCRIPTS },
    devDependencies: pwVersion ? { '@playwright/test': pwVersion } : {},
  };
  mkdirSync(webAbs, { recursive: true });
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  created.push(rel);
}

// On a dir THIS scaffolder owns, regenerate the config when the desired
// projects changed — this is how a re-run after picking devices updates the
// config with no manual rm. Byte-identical content still skips (idempotent).
// When `regenerate` is false (a dir we did not author) an existing config is
// never clobbered.
function wireConfig(webAbs, location, browsers, devices, resolutions, testIdAttribute, pwVersion, regenerate, created, skipped) {
  const rel = `${location}/playwright.config.ts`;
  const cfgPath = join(webAbs, 'playwright.config.ts');
  // On a dir we do not own, author nothing: an existing config is left as-is,
  // and a foreign config (a .js/.mjs/.cjs, or a .ts we didn't write) gets no
  // competing .ts created beside it that Playwright would load in its place.
  if (!regenerate) {
    const present = presentPlaywrightConfig(webAbs);
    return skipped.push(present ? `${location}/${present.name}` : rel);
  }
  const next = fullConfig(browsers, devices, resolutions, testIdAttribute, pwVersion, location);
  if (existsSync(cfgPath) && readFileSync(cfgPath, 'utf8') === next) return skipped.push(rel);
  writeFileSync(cfgPath, next);
  created.push(rel);
}

// Everything the sub-package should contain, for the conform report.
function structurePieces(location) {
  return [
    `${location}/package.json`,
    `${location}/playwright.config.ts`,
    `${location}/eslint.config.mjs`,
    `${location}/pages`,
    `${location}/specs`,
    `${location}/fixtures/base.ts`,
    `${location}/fixtures/login.ts`,
    `${location}/auth.setup.ts`,
    `${location}/${GLOBAL_SETUP_FILE}`,
    `${location}/.auth`,
    `${location}/.env.example`,
    `${location}/.env`,
    `${location}/.gitignore`,
  ];
}

function reportStructure(targetPath, location, resolvedLinter = 'none') {
  const present = [];
  const missing = [];
  const notes = [];
  // A suite wiring its own globalSetup is deliberately not given ours, so
  // listing the file as missing would report a complete setup as incomplete.
  const hookRel = `${location}/${GLOBAL_SETUP_FILE}`;
  const hasOwnHook = globalSetupEntry(join(targetPath, location)).declared;
  const eslintRel = `${location}/eslint.config.mjs`;
  const hasEslintConfig = ESLINT_CONFIG_NAMES.some((name) => existsSync(join(targetPath, location, name)));
  // The config piece is satisfied by any Playwright config name, not only .ts:
  // a conform suite configured in .js holds a real config, so listing .ts as
  // missing would report a complete suite as incomplete.
  const configRel = `${location}/playwright.config.ts`;
  const presentConfig = presentPlaywrightConfig(join(targetPath, location));
  // A Biome repo is never given an eslint config, so it is not a missing piece
  // there — drop it from the expected set rather than report a gap setup would
  // deliberately not fill.
  const pieces = resolvedLinter === 'biome' ? structurePieces(location).filter((rel) => rel !== eslintRel) : structurePieces(location);
  // Only a TypeScript suite away from the repo root is expected to carry a
  // tsconfig.json and a typecheck script, the two pieces applyTsconfig adds.
  // The script is a piece of its own: a suite that already has a
  // tsconfig.json can still lack it.
  const typecheckRel = `${location}/package.json typecheck script`;
  if (location !== '.' && suiteIsTypeScript(targetPath, location)) pieces.push(`${location}/tsconfig.json`, typecheckRel);
  for (const rel of pieces) {
    const satisfied =
      existsSync(join(targetPath, rel)) ||
      (rel === hookRel && hasOwnHook) ||
      (rel === eslintRel && hasEslintConfig) ||
      (rel === configRel && presentConfig !== null) ||
      (rel === typecheckRel && hasTypecheckScript(join(targetPath, location)));
    (satisfied ? present : missing).push(rel);
  }
  // Reached only in conform mode (real specs, no manifest — see
  // noteUnsplitConfig's comment for why that makes any config here
  // unconditionally hand-authored), which never calls applyStructure and so
  // never reaches the same check there. Without this, the single most common
  // case — scaffold() run with no --create-missing against an existing suite
  // — got no smoke-split guidance at all. Named against the config actually
  // present, not a .ts that a .js-configured suite never had.
  if (presentConfig) noteUnsplitConfig(presentConfig.path, location, notes);
  return { present, missing, notes };
}

// env.mjs resolves and writes e2e/web/.env itself (relative to targetPath, not
// webAbs) — it owns that file's create-if-absent / append-missing-keys logic,
// mirroring how the rest of this function treats every other piece.
function applyEnvFile(targetPath, location, webServer, created, skipped) {
  const rel = `${location}/.env`;
  const report = writeEnvFile(targetPath, resolveEnvValues(targetPath, { webServer }), { location });
  (report.added.length > 0 ? created : skipped).push(rel);
  return report;
}

// What the config actually wires as its globalSetup: `target` is the configured
// path (null when it is not a plain string literal), `declared` says whether an
// entry is there at all. Comments come out first — a commented-out entry runs
// nothing, and treating it as wiring would put back the inert hook this whole
// gate exists to prevent. The `//` strip keeps its leading whitespace so a URL
// inside a string ('https://...') is not mistaken for a line comment.
function globalSetupEntry(webAbs) {
  const present = presentPlaywrightConfig(webAbs);
  if (!present) return { target: null, declared: false, configName: null };
  const source = readFileSync(present.path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');
  return {
    target: source.match(/globalSetup:\s*['"]([^'"]+)['"]/)?.[1] ?? null,
    declared: /globalSetup\s*:/.test(source),
    configName: present.name,
  };
}

// The hook is only real when the config points at it. On a dir we do not own,
// wireConfig leaves a hand-authored config alone, so writing the hook there
// would report a file Playwright never runs — say what's needed instead.
function applyGlobalSetup(webAbs, location, created, skipped, notes) {
  const { target, declared, configName } = globalSetupEntry(webAbs);
  if (target === `./${GLOBAL_SETUP_FILE}` || target === GLOBAL_SETUP_FILE) {
    return writeIfAbsent(join(webAbs, GLOBAL_SETUP_FILE), `${location}/${GLOBAL_SETUP_FILE}`, GLOBAL_SETUP, created, skipped);
  }
  const config = configName ?? 'playwright.config.ts';
  notes.push(
    declared
      ? `${location}/${config} already wires globalSetup to ${target ?? 'a hook of its own'}, so ${location}/${GLOBAL_SETUP_FILE} was not written — ` +
          'seed and reset suite-wide test data in that hook instead.'
      : `${location}/${config} is hand-authored and has no globalSetup, so ${location}/${GLOBAL_SETUP_FILE} was not written — ` +
          `add \`globalSetup: './${GLOBAL_SETUP_FILE}'\` to that config and re-run to get the hook.`,
  );
}

// A repo whose resolved linter is Biome gets no ESLint stack: applyEslintConfig,
// applyLintScript, and install-playwright's LINT_DEPS are all skipped, so setup
// follows the repo's linter instead of imposing ESLint on it. Detection reports
// only eslint/biome/none, so this fires for Biome; a repo on a linter detection
// does not recognise reads as `none` and gets ESLint unless the human overrides.
//
// The suite gets Biome's Playwright rules instead, in a nested biome.json beside
// the assertion plugin, when the repo's Biome reaches BIOME_PLAYWRIGHT_MIN. Below
// it, or with no version to read, nothing is written and a note says why, since
// a skipped lint setup is otherwise invisible. An existing suite Biome config is
// left as it is, with a note naming the rules to add, unless it is ours.
function applyBiomeConfig(webAbs, location, biomeVersion, created, skipped, notes) {
  const missed = 'so the specs are not linted for waitForTimeout, a missing await, networkidle or a missing assertion';
  if (!reachesBiomePlaywrightMin(biomeVersion)) {
    notes.push(
      biomeVersion
        ? `Biome is the repo's linter, and its @biomejs/biome version (${biomeVersion}) does not reach ${BIOME_PLAYWRIGHT_MIN}, ` +
            `the first release with Playwright lint rules. No ${location}/biome.json or lint script was added, ${missed}. ` +
            `Upgrade @biomejs/biome to ${BIOME_PLAYWRIGHT_MIN} or later and re-run setup to add them.`
        : `Biome is the repo's linter, but the repo root has no @biomejs/biome version installed or declared. ` +
            `No ${location}/biome.json or lint script was added, ${missed}. ` +
            `Add @biomejs/biome ${BIOME_PLAYWRIGHT_MIN} or later as a root devDependency and re-run setup to add them.`,
    );
    return false;
  }
  const present = BIOME_CONFIG_NAMES.find((name) => existsSync(join(webAbs, name)));
  if (present) {
    const rel = `${location}/${present}`;
    skipped.push(rel);
    if (readFileSync(join(webAbs, present), 'utf8') === BIOME_CONFIG) {
      writeIfAbsent(join(webAbs, BIOME_PLUGIN_FILE), `${location}/${BIOME_PLUGIN_FILE}`, BIOME_ASSERTION_PLUGIN, created, skipped);
    } else {
      notes.push(
        `${rel} already exists, so it was left as it is and no Playwright rules were added to it. ` +
          'To lint the specs for the Playwright anti-patterns, enable noPlaywrightWaitForTimeout, ' +
          'noPlaywrightMissingAwait and noPlaywrightNetworkidle under linter.rules.nursery.',
      );
    }
    return true;
  }
  mkdirSync(webAbs, { recursive: true });
  writeFileSync(join(webAbs, 'biome.json'), BIOME_CONFIG);
  created.push(`${location}/biome.json`);
  writeIfAbsent(join(webAbs, BIOME_PLUGIN_FILE), `${location}/${BIOME_PLUGIN_FILE}`, BIOME_ASSERTION_PLUGIN, created, skipped);
  return true;
}

// Write our eslint.config.mjs only when the sub-package has no eslint config of
// any name — an existing config (hand-written or from a prior tool) is left
// working, never clobbered.
function applyEslintConfig(webAbs, location, created, skipped) {
  const rel = `${location}/eslint.config.mjs`;
  if (ESLINT_CONFIG_NAMES.some((name) => existsSync(join(webAbs, name)))) return skipped.push(rel);
  mkdirSync(webAbs, { recursive: true });
  writeFileSync(join(webAbs, 'eslint.config.mjs'), ESLINT_CONFIG);
  created.push(rel);
}

// Add the lint script, `eslint .` unless the caller passes Biome's, when the
// suite has no `lint` script yet. The caller gates on the config: ESLint's only
// when a flat config is present after applyEslintConfig ran, ours just written
// or one already there. A sub-package left on a legacy .eslintrc gets no lint
// script, since `eslint .` under ESLint 9 would fail on it.
function applyLintScript(webAbs, location, created, skipped, script = LINT_SCRIPT) {
  const rel = `${location}/package.json`;
  const pkgPath = join(webAbs, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.scripts = pkg.scripts ?? {};
  if ('lint' in pkg.scripts) return;
  pkg.scripts = { ...pkg.scripts, ...script };
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  // This write changed package.json. writePackageJson may already have parked it
  // in `skipped` (nothing else to change); move it to `created` so the report
  // does not claim the file is unchanged when the lint script was just added.
  const at = skipped.indexOf(rel);
  if (at !== -1) skipped.splice(at, 1);
  if (!created.includes(rel)) created.push(rel);
}

// The suite's language, read after the config is wired: a fresh scaffold's
// playwright.config.ts makes it TypeScript, and a suite of .spec.js files or a
// hand-authored playwright.config.js keeps it JavaScript.
function suiteIsTypeScript(targetPath, location) {
  return detect(targetPath, { location }).language === 'ts';
}

// A TypeScript suite gets a tsconfig.json of its own and a typecheck script.
// An existing suite tsconfig.json is left as it is, and so is an existing
// typecheck script. A JavaScript suite gets neither. A suite at the repo root
// gets neither too: its tsconfig.json and package.json are the app's, so a
// typecheck there would check the app.
function applyTsconfig(targetPath, webAbs, location, created, skipped, notes) {
  if (!suiteIsTypeScript(targetPath, location)) return;
  if (location === '.') {
    notes.push(
      'The suite is the repo root, so no tsconfig.json or typecheck script was written for it — ' +
        "the root's are the app's, and a typecheck there would check the app. Move the suite to its own directory to get both.",
    );
    return;
  }
  const rootConfig = ROOT_TSCONFIG_NAMES.find((name) => existsSync(join(targetPath, name)));
  writeIfAbsent(join(webAbs, 'tsconfig.json'), `${location}/tsconfig.json`, renderTsconfig(rootConfig, location), created, skipped);
  const rel = `${location}/package.json`;
  const pkgPath = join(webAbs, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.scripts = pkg.scripts ?? {};
  if ('typecheck' in pkg.scripts) return;
  pkg.scripts = { ...pkg.scripts, ...TYPECHECK_SCRIPT };
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  const at = skipped.indexOf(rel);
  if (at !== -1) skipped.splice(at, 1);
  if (!created.includes(rel)) created.push(rel);
}

// The smoke/granular project names depend on the chosen browsers/devices/
// resolutions, so they can't live in the static NPM_SCRIPTS map above — and
// unlike those (plain `playwright test`, valid against any config), a value
// here hard-codes project names that only exist because *our* fullConfig()
// put them there. On a dir we don't own, the actual config's project names
// are unknown — it may have no smoke split, or none at all — so adding these
// scripts there risks a `--project` naming something that doesn't exist,
// which fails outright rather than degrading. Skip both entirely in that
// case, the same gate wireConfig already uses to decide whether to touch the
// config at all. On a dir we own, always keep them in sync with the current
// matrix (including overwriting a manual edit) — this is how a re-run with a
// different matrix stops a script from naming a project that no longer
// exists, mirroring how an owned config itself gets regenerated wholesale.
function applyDynamicScripts(webAbs, location, browsers, devices, resolutions, owned, created, skipped) {
  if (!owned) return;
  const rel = `${location}/package.json`;
  const pkgPath = join(webAbs, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.scripts = pkg.scripts ?? {};
  let changed = false;
  for (const [key, value] of Object.entries(dynamicNpmScripts(browsers, devices, resolutions))) {
    if (pkg.scripts[key] === value) continue;
    pkg.scripts[key] = value;
    changed = true;
  }
  if (!changed) return;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  const at = skipped.indexOf(rel);
  if (at !== -1) skipped.splice(at, 1);
  if (!created.includes(rel)) created.push(rel);
}

// Evidence of every piece of a working split, not just some of them: a
// project named '<x>-smoke' (either quote style — a bare '-smoke\''
// substring check falsely reports a double-quoted name as missing), a
// testMatch filter mentioning 'smoke' (the smoke project routing spec files
// in), AND SEPARATELY a testIgnore filter mentioning 'smoke' (a granular
// counterpart routing them back out). `test(?:Match|Ignore)` as a single
// alternation would pass on testMatch alone — a smoke project with no
// testIgnore anywhere leaves every granular file unrouted by any project,
// which is not a working split, just a smoke project with nothing to pair it.
// Exported: discover's check-smoke-split.mjs reuses this exact test against
// whatever config it locates, rather than reimplementing the three-part rule.
// A bounded window (not [^\n]*) after the key, so a value written across a
// few lines — a testMatch/testIgnore array, most commonly — still counts.
// Unbounded ([\s\S]*) would risk matching a later, unrelated project's
// 'smoke' mention; a few hundred characters comfortably covers how this
// value is actually formatted without reading past it.
const AFTER_KEY = '[\\s\\S]{0,200}';

export function hasSmokeSplit(source) {
  return (
    /-smoke['"]/.test(source) &&
    new RegExp(`testMatch\\s*:${AFTER_KEY}smoke`, 'i').test(source) &&
    new RegExp(`testIgnore\\s*:${AFTER_KEY}smoke`, 'i').test(source)
  );
}

// On a config we don't own, say once when it predates the smoke/granular
// split — the same way applyGlobalSetup does for a hand-authored config
// missing our hook — instead of silently leaving the gap invisible. Takes
// the config path directly (not webAbs + an ownership flag) so the conform-
// mode report below, which never reaches applyStructure and so never
// computes `owned`, can share this exact check: a manifest-less dir in
// conform mode never held a config this scaffolder wrote, by construction
// (classify() reads any manifest's presence as 'fresh' regardless of specs),
// so any config found there is unconditionally hand-authored.
function noteUnsplitConfig(cfgPath, location, notes) {
  if (!existsSync(cfgPath) || hasSmokeSplit(readFileSync(cfgPath, 'utf8'))) return;
  notes.push(
    `${location}/${basename(cfgPath)} is hand-authored and has no smoke/granular project split — ` +
      `add a '-smoke' project per browser with testMatch: ${SMOKE_SPEC_PATTERN} and testIgnore: ${SMOKE_SPEC_PATTERN} ` +
      'on its granular counterpart, or scaffold a fresh e2e/web to get one generated.',
  );
}

// Surface which CI reporters the pinned Playwright was too old for, so a dropped
// reporter is a stated choice, not a silent gap — and so nobody reads a missing
// blob-report/ under CI as a bug (#384). The pin is left untouched; only the
// generated config adapts to it.
function noteDroppedReporters(pwVersion, notes) {
  const dropped = ciReporters(pwVersion).dropped;
  if (dropped.length === 0) return;
  const plural = dropped.length > 1 ? 's' : '';
  // Unresolved range ('*', 'latest', a disjunctive range) vs a concrete-but-old
  // pin get different wording — the first is "can't confirm", the second "too
  // old".
  const cause = parseMinor(pwVersion)
    ? `Pinned Playwright ${pwVersion} predates the ${dropped.join(' and ')} reporter${plural}`
    : `Declared Playwright '${pwVersion}' resolves to no known version, so the ${dropped.join(' and ')} reporter${plural} cannot be confirmed supported`;
  notes.push(
    `${cause}; omitted from the CI config so it loads instead of throwing 'Unknown reporter'. ` +
      'Pin @playwright/test to 1.37+ to get them back.',
  );
}

function hasTypecheckScript(webAbs) {
  try {
    return Boolean(JSON.parse(readFileSync(join(webAbs, 'package.json'), 'utf8')).scripts?.typecheck);
  } catch {
    return false;
  }
}

// True only when e2e/web/package.json actually defines a test:e2e script, so
// the note never prints a `run test:e2e` command that would fail. A fresh
// scaffold writes one; a conform-mode suite may carry none (or no manifest).
function hasE2eTestScript(webAbs) {
  const pkgPath = join(webAbs, 'package.json');
  if (!existsSync(pkgPath)) return false;
  try {
    return Boolean(JSON.parse(readFileSync(pkgPath, 'utf8')).scripts?.['test:e2e']);
  } catch {
    return false;
  }
}

// detect() reports a monorepo task runner (nx/turbo/lerna). Registering e2e/web
// with it would mean editing a root manifest this plugin doesn't own (turbo's
// tasks, the root workspaces list, lerna.json packages, an nx project), which
// the never-clobber ethos rules out, so this only reports — the way
// noteUnsplitConfig surfaces a gap rather than closing it silently.
//
// It deliberately does NOT try to say whether the runner already picks the
// suite up. Each runner discovers projects differently — nx from project.json /
// inference, lerna from lerna.json `packages`, turbo from the package manager's
// workspaces — so package-manager workspace membership is not a reliable proxy
// for runner registration (a lerna.json glob can include or exclude e2e/web
// regardless of root workspaces). The one fact this plugin can state without
// parsing three config formats is that *setup itself did not register it*; the
// runner's own config decides the rest. It reports the runnable command only
// when a test:e2e script exists, using `pm` — setup's --pm override, else the
// resolved root manager — so the command matches how the suite was installed.
// No runner: no note.
function noteTaskRunner(targetPath, report, pm, notes, location) {
  const runner = report.taskRunner;
  if (!runner) return;
  const scriptTail = hasE2eTestScript(join(targetPath, location))
    ? ` Run it directly with \`cd ${location} && ${runScriptCommand(pm, 'test:e2e')}\`.`
    : ` It has no test:e2e script yet — a fresh scaffold writes one.`;
  notes.push(
    `A ${runner} task runner is configured here. setup created ${location} as a self-contained ` +
      `package but did not register it with ${runner}; whether ${runner} already runs the suite ` +
      `depends on ${runner}'s own project/task config, which setup does not modify. Add a ${runner} ` +
      `task/target/package entry for ${location} to include the suite in the task graph.${scriptTail}`,
  );
}

// fixtures/base.ts imports { login } from ./login. A fixtures/login.ts the
// suite already had, without that export, would make a fresh base.ts fail to
// load, so base.ts is left unwritten and the note says what to add.
const LOGIN_DECLARATION = /export\s+(async\s+)?function\s+login\b|export\s+(const|let|var)\s+login\b/;

// True when the source exports the name `login`: a declaration, or an export
// list entry whose exported name is login (`login`, `signIn as login`). An
// entry that renames login away (`login as default`) does not count.
function exportsLogin(source) {
  if (LOGIN_DECLARATION.test(source)) return true;
  for (const [, list] of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const entry of list.split(',')) {
      const words = entry.trim().split(/\s+/);
      if (words.at(-1) === 'login') return true;
    }
  }
  return false;
}

function applyFixturesBase(webAbs, location, created, skipped, notes) {
  const loginPath = join(webAbs, 'fixtures/login.ts');
  if (!existsSync(join(webAbs, 'fixtures/base.ts')) && existsSync(loginPath) && !exportsLogin(readFileSync(loginPath, 'utf8'))) {
    notes.push(
      `${location}/fixtures/login.ts exists and exports no \`login\`, so ${location}/fixtures/base.ts was not written — ` +
        'the generated base fixture imports { login } from it. Export `async function login(page)` from that file, or move it aside, and re-run.',
    );
    return;
  }
  writeIfAbsent(join(webAbs, 'fixtures/base.ts'), `${location}/fixtures/base.ts`, FIXTURES_BASE, created, skipped);
}

// Create everything under the suite location (create-if-absent, never clobbering).
function applyStructure(targetPath, webAbs, location, webServer, browsers, devices, resolutions, testIdAttribute, pwVersion, ownsConfig, resolvedLinter, biomeVersion, pm, created, skipped, notes) {
  writePackageJson(webAbs, location, pwVersion, created, skipped);
  wireConfig(webAbs, location, browsers, devices, resolutions, testIdAttribute, pwVersion, ownsConfig, created, skipped);
  if (!ownsConfig) {
    const present = presentPlaywrightConfig(webAbs);
    if (present) noteUnsplitConfig(present.path, location, notes);
  } else noteDroppedReporters(pwVersion, notes);
  // ESLint stack only when the repo lints with ESLint or has no recognised
  // linter; a Biome repo gets Biome's Playwright rules where its Biome has them.
  if (resolvedLinter === 'biome') {
    if (applyBiomeConfig(webAbs, location, biomeVersion, created, skipped, notes)) {
      applyLintScript(webAbs, location, created, skipped, BIOME_LINT_SCRIPT);
    }
  } else {
    applyEslintConfig(webAbs, location, created, skipped);
    if (hasFlatEslintConfig(webAbs)) applyLintScript(webAbs, location, created, skipped);
  }
  applyDynamicScripts(webAbs, location, browsers, devices, resolutions, ownsConfig, created, skipped);
  applyTsconfig(targetPath, webAbs, location, created, skipped, notes);
  ensureDir(join(webAbs, 'pages'), `${location}/pages`, created, skipped);
  ensureDir(join(webAbs, 'specs'), `${location}/specs`, created, skipped);
  ensureDir(join(webAbs, '.auth'), `${location}/.auth`, created, skipped);
  applyFixturesBase(webAbs, location, created, skipped, notes);
  writeIfAbsent(join(webAbs, 'fixtures/login.ts'), `${location}/fixtures/login.ts`, renderLogin(), created, skipped);
  writeIfAbsent(join(webAbs, 'auth.setup.ts'), `${location}/auth.setup.ts`, renderAuthSetup(), created, skipped);
  writeIfAbsent(join(webAbs, 'codegen.mjs'), `${location}/codegen.mjs`, CODEGEN_WRAPPER, created, skipped);
  applyGlobalSetup(webAbs, location, created, skipped, notes);
  appendLinesIfAbsent(join(webAbs, '.env.example'), `${location}/.env.example`, ENV_VARS.map((n) => `${n}=`), created, skipped);
  appendLinesIfAbsent(join(webAbs, '.gitignore'), `${location}/.gitignore`, gitignoreEntriesFor(pm), created, skipped);
  return applyEnvFile(targetPath, location, webServer, created, skipped);
}

export function scaffold(targetPath, options = {}) {
  const { browsers = ['chromium'], devices = [], resolutions = [], createMissing = false, linter } = options;
  // Playwright runs three desktop engines. An unknown key would otherwise
  // produce no project and no error, so it stops the run before any write.
  const unknown = browsers.filter((browser) => !Object.hasOwn(BROWSER_PRESETS, browser));
  if (unknown.length) {
    const valid = Object.keys(BROWSER_PRESETS).join(', ');
    return { status: 'error', message: `Unknown desktop browser key: ${unknown.join(', ')}. Valid keys: ${valid}. Opera and other Chromium-based browsers share the Chromium engine: pick chromium, which runs Playwright's Chromium build, not the branded browser.` };
  }
  const location = resolveLocation(targetPath, options);
  const webAbs = join(targetPath, location);
  const pwVersion = detectPlaywrightVersion(targetPath, location);
  const mode = classify(targetPath, location);

  // Resolved here rather than threaded in from setup.mjs, so scaffold() stays
  // callable (and correct) on its own — its CLI entry and its own tests never
  // pass them. detect() runs before this call writes the suite's package.json, so
  // it never sees the sub-package this run is about to create. One report feeds
  // both paths. `pm` mirrors setup's own resolution (an explicit --pm override
  // wins over the detected root manager) so the task-runner note names the
  // manager the suite was actually installed with.
  const report = detect(targetPath);
  const pm = options.packageManager ?? resolvePackageManager(report);

  // The linter to follow: an explicit choice wins, else the repo's detected
  // linter. Drives which lint stack applyStructure writes and what the conform
  // report expects.
  const resolvedLinter = resolveOverride(linter, resolveLinter(report));

  if (mode === 'conform' && !createMissing) {
    const structure = reportStructure(targetPath, location, resolvedLinter);
    noteTaskRunner(targetPath, report, pm, structure.notes, location);
    return { status: 'conform', webDir: location, ...structure };
  }

  const webServer = options.webServer ?? resolveWebServer(report, { suiteLocation: location });
  const testIdAttribute = options.testIdAttribute ?? resolveTestIdAttribute(report);

  // Regenerate the config only on a dir THIS scaffolder owns. classify() also
  // calls a spec-less, human-authored suite 'fresh', so keying on mode would
  // silently clobber (or write a competing .ts beside) a hand-written config;
  // ownership is the correct gate. No manifest records the answer — a suite is
  // ours only when its lone config is our own playwright.config.ts carrying the
  // regeneratable marker OR the legacy .env-loader signal every fullConfig
  // render has emitted; a config of any other name, or a .ts with neither
  // signal, reads as unowned (ownsConfigAt).
  const owned = ownsConfigAt(webAbs);

  const created = [];
  const skipped = [];
  const notes = [];
  const env = applyStructure(targetPath, webAbs, location, webServer, browsers, devices, resolutions, testIdAttribute, pwVersion, owned, resolvedLinter, resolveBiome(report), pm, created, skipped, notes);
  noteTaskRunner(targetPath, report, pm, notes, location);

  const status = mode === 'conform' ? 'conformed' : 'scaffolded';
  return { status, webDir: location, pinnedPlaywright: pwVersion, created, skipped, notes, env };
}

const isMainModule = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const targetPath = process.argv[2] ?? '.';
  const flag = (name) => {
    const i = process.argv.indexOf(name);
    return i !== -1 ? process.argv[i + 1] : undefined;
  };
  const browsers = (flag('--browsers') ?? 'chromium').split(',').map((b) => b.trim()).filter(Boolean);
  const devicesArg = flag('--devices');
  const devices = devicesArg ? devicesArg.split(',').map((d) => d.trim()).filter(Boolean) : [];
  const resolutionsArg = flag('--resolutions');
  const resolutions = resolutionsArg ? resolutionsArg.split(',').map((r) => r.trim()).filter(Boolean) : [];
  const createMissing = process.argv.includes('--create-missing');
  const location = flag('--location');
  const linter = flag('--linter');
  const typescript = flag('--typescript');
  const result = scaffold(targetPath, { browsers, devices, resolutions, createMissing, location, linter, typescript });
  console.log(JSON.stringify(result, null, 2));
  if (result.status === 'error') process.exitCode = 1;
}
