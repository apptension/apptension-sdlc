import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { renderAuthSetup, renderLogin, isRegeneratableAuthSetup, LEGACY_STUB_SIGNAL } from './scaffold.mjs';
import { resolveLocation } from './manifest.mjs';
import { ENV_VARS } from './env.mjs';
import { loadEnvFile } from './web-server.mjs';

// All four selectors renderAuthSetup's working branch needs — see its opts
// destructuring in scaffold.mjs. Validated here, before any write, so a
// partial opts object (e.g. a CLI flag omitted) fails loud instead of
// rendering `page.undefined.fill(...)`.
const REQUIRED_OPTS = ['emailSelector', 'passwordSelector', 'submitSelector', 'waitUrl'];

// renderAuthSetup writes each selector after `page.`, so a selector passed in
// its full `page.getByLabel(...)` form would render `page.page.getByLabel(...)`.
const SELECTOR_OPTS = ['emailSelector', 'passwordSelector', 'submitSelector'];
const stripPagePrefix = (selector) => selector.replace(/^\s*page\./, '');

// Overwrite e2e/web/auth.setup.ts and e2e/web/fixtures/login.ts with a working
// login rendered from the selectors the setup skill discovered over the bundled
// Playwright MCP — but only on files this scaffolder owns, each one: absent, or regeneratable per
// isRegeneratableAuthSetup (the current stub/prior working render carrying
// AUTH_SETUP_MARKER, or a pre-marker legacy stub recognized by its commented
// placeholder line). That lets a retry (fix selectors, rewrite, re-run)
// overwrite the previous working render — not just the untouched stub, and not
// just repos scaffolded after the marker existed. A suite with its own
// hand-authored auth.setup.ts or login.ts (neither signal) is left untouched; the caller
// reports the refusal instead of silently destroying someone else's login
// logic.
export function writeAuthSetup(targetPath, opts) {
  if (opts) {
    const missing = REQUIRED_OPTS.filter((name) => typeof opts[name] !== 'string' || opts[name] === '');
    if (missing.length > 0) {
      throw new Error(`writeAuthSetup: missing required option(s): ${missing.join(', ')}`);
    }
  }

  const webDir = resolveLocation(targetPath, { location: opts?.location });
  // Written as a pair: auth.setup.ts calls login() from fixtures/login.ts, so
  // regenerating one without the other would leave a setup calling a login
  // that is not the one just discovered. Either file hand-authored refuses both.
  const files = [
    { rel: `${webDir}/auth.setup.ts`, render: renderAuthSetup },
    { rel: `${webDir}/fixtures/login.ts`, render: renderLogin },
  ];
  for (const { rel } of files) {
    const abs = join(targetPath, rel);
    if (existsSync(abs) && !isRegeneratableAuthSetup(readFileSync(abs, 'utf8'))) {
      return { written: null, refused: rel, reason: `existing ${rel} was not written by e2e-setup — left untouched` };
    }
  }

  const renderOpts = opts && { ...opts };
  if (renderOpts) for (const name of SELECTOR_OPTS) renderOpts[name] = stripPagePrefix(renderOpts[name]);
  for (const { rel, render } of files) {
    const abs = join(targetPath, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, render(renderOpts));
  }
  return { written: files.map(({ rel }) => rel) };
}

// The keys a login cannot run without, the same three the skill's login step
// gates on.
const LOGIN_KEYS = ['E2E_BASE_URL', 'E2E_USER_EMAIL', 'E2E_USER_PASSWORD'];

// Whether a re-run can skip straight to the login step. 'ready' means
// auth.setup.ts is still the stub, Playwright resolves from the suite, and the
// suite's .env sets every LOGIN_KEYS entry. Every other status sends the skill
// through the whole setup and names why: 'no-stub' when auth.setup.ts is
// absent, a working login or hand-authored, 'not-installed' when the install
// the shortcut skips never ran here, as in a fresh clone, and 'needs-keys'
// when a LOGIN_KEYS entry is blank. `blank` lists every ENV_VARS key the .env
// leaves empty. It holds names only, because this output lands in a
// transcript. Only the suite's .env is read, first line per key, the way the
// generated config reads it.
export function resumeState(targetPath, { location } = {}) {
  const root = resolve(targetPath);
  const webAbs = join(root, resolveLocation(root, { location }));
  // The current stub and a pre-marker one both carry this commented line. A
  // working render and a hand-authored login carry neither.
  const setupAbs = join(webAbs, 'auth.setup.ts');
  if (!existsSync(setupAbs) || !readFileSync(setupAbs, 'utf8').includes(LEGACY_STUB_SIGNAL)) {
    return { status: 'no-stub' };
  }
  try {
    createRequire(join(webAbs, 'package.json')).resolve('@playwright/test');
  } catch {
    return { status: 'not-installed' };
  }
  const env = loadEnvFile(webAbs, {});
  const blank = ENV_VARS.filter((key) => !env[key]);
  return { status: LOGIN_KEYS.some((key) => blank.includes(key)) ? 'needs-keys' : 'ready', blank };
}

// A flag's value must not itself look like another flag: `--email --password X`
// with no value given for --email would otherwise return the literal string
// '--password' (argv[i+1], blindly) — which passes the non-empty REQUIRED_OPTS
// check above and renders `page.--password.fill(...)`. Undefined (flag is last,
// or absent) and any `--`-prefixed token both count as absent, so the required-
// opts check fails loud before anything is written. Exported so the rule is
// tested directly rather than only indirectly through the CLI.
export function flagValue(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const value = argv[i + 1];
  return value === undefined || value.startsWith('--') ? undefined : value;
}

const isMain = process.argv[1] && process.argv[1].endsWith('write-auth-setup.mjs');
if (isMain) {
  const argv = process.argv.slice(2);
  const flag = (name) => flagValue(argv, name);
  const targetPath = argv.find((a) => !a.startsWith('--') && argv.indexOf(a) === 0) ?? '.';
  if (argv.includes('--check')) {
    console.log(JSON.stringify(resumeState(targetPath, { location: flag('--location') }), null, 2));
    process.exit(0);
  }
  const opts = {
    emailSelector: flag('--email'),
    passwordSelector: flag('--password'),
    submitSelector: flag('--submit'),
    waitUrl: flag('--wait'),
    location: flag('--location'),
  };
  const result = writeAuthSetup(targetPath, opts);
  console.log(JSON.stringify(result, null, 2));
  if (result.refused) process.exitCode = 2; // not written; caller must notice
}
