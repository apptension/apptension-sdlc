import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect } from './detect.mjs';
import { resolveWebServer } from './web-server.mjs';
import { resolveLocation } from './manifest.mjs';

// Searched in this order, and the first file holding a name wins, so a personal
// .env.local overrides the shared .env exactly as the app's own tooling reads it.
const ENV_FILE_NAMES = ['.env.local', '.env.development', '.env'];

// A declared PORT names where the app runs on this machine. A public URL alias
// is often the deployed site, and pointing a suite that logs in and clicks
// buttons at production is the one mistake worth ordering these against — so
// deriveBaseUrl runs before the aliases, never after.
function deriveBaseUrl(files, webServer, env) {
  const resolved = webServer?.status === 'resolved' ? webServer : null;

  // A port the start command names (a flag, or vite preview) or one pinned in
  // the framework config file binds regardless of the environment, so it beats
  // even a file-declared PORT — Vite and Angular ignore PORT outright — and is
  // trustworthy across runs. Ranked first for that reason.
  if ((resolved?.portFromCommand || resolved?.portFromConfig) && resolved.port) {
    return { value: `http://localhost:${resolved.port}`, source: 'detected' };
  }

  // A PORT the repo's own env files declare names where a PORT-reading framework
  // runs on this machine; it outranks the framework default and the URL aliases,
  // but not the command/config port above, which the framework honors instead.
  // The port of a declared PORT, mirroring dotenv's own handling of a quoted
  // value and an inline comment: `PORT=3000 # dev` and `PORT="3000" # dev` both
  // bind 3000, so that is the port used — never the raw `3000 # dev`, which
  // would land in the URL verbatim and break E2E_BASE_URL. The optional leading
  // quote covers the case unquote() leaves in place (a comment trailing the
  // closing quote), and the lookahead requires the digits to end at a quote,
  // whitespace, comment, or end — so a non-numeric value (`not-a-port`) or
  // garbage (`4000abc`) yields nothing and resolution falls through to the
  // exported PORT and framework default.
  const declared = findValue(files, 'PORT');
  const declaredPort = declared ? /^["']?(\d+)(?=["'\s#]|$)/.exec(declared.value)?.[1] : undefined;
  if (declaredPort) {
    return { value: `http://localhost:${declaredPort}`, source: declared.source };
  }

  // An exported PORT the file didn't declare still binds the dev server, but
  // only for a framework that reads it (Next/CRA/Nuxt; Vite and Angular ignore
  // it). So it displaces the framework default, never a command/config port.
  const exported = env?.PORT;
  if (resolved?.consumesPort && exported && /^\d+$/.test(exported)) {
    return { value: `http://localhost:${exported}`, source: 'env:PORT' };
  }

  // Otherwise the framework's documented default — a guess, not a reading of the
  // running server, so it is marked distinctly: setup probes the live port
  // (#404) when this is where E2E_BASE_URL landed. null when nothing answered.
  return resolved?.port ? { value: `http://localhost:${resolved.port}`, source: 'framework-default' } : null;
}

function fromWebServer(field) {
  return (files, webServer) =>
    webServer?.status === 'resolved' && webServer[field]
      ? { value: webServer[field], source: 'detected' }
      : null;
}

// Every E2E_ key the scaffolded config reads, with the unprefixed names a repo
// commonly uses for the same value. The prefix is what makes a CI secret
// readable at a glance, so the mapping onto it happens here, once, when setup
// writes the file — not inside playwright.config.ts on every run.
//
// Each key resolves in three passes: an exact E2E_ name the repo already
// declares, then `derive`, then the aliases in order. Nothing invents a value,
// so a key with no match stays blank for a human to fill.
const KEYS = [
  {
    key: 'E2E_BASE_URL',
    derive: deriveBaseUrl,
    aliases: ['BASE_URL', 'APP_URL', 'NEXT_PUBLIC_APP_URL', 'VITE_APP_URL', 'PUBLIC_URL'],
  },
  { key: 'E2E_WEB_SERVER_COMMAND', derive: fromWebServer('command'), aliases: [] },
  { key: 'E2E_WEB_SERVER_CWD', derive: fromWebServer('cwd'), aliases: [] },
  { key: 'E2E_USER_EMAIL', aliases: ['TEST_USER_EMAIL', 'TEST_EMAIL'] },
  { key: 'E2E_USER_PASSWORD', aliases: ['TEST_USER_PASSWORD', 'TEST_PASSWORD'] },
  { key: 'E2E_LOGIN_URL', aliases: ['LOGIN_URL'] },
  { key: 'E2E_BASIC_AUTH_USER', aliases: ['BASIC_AUTH_USER', 'BASIC_AUTH_USERNAME', 'HTTP_BASIC_USER'] },
  {
    key: 'E2E_BASIC_AUTH_PASSWORD',
    aliases: ['BASIC_AUTH_PASSWORD', 'BASIC_AUTH_PASS', 'HTTP_BASIC_PASSWORD'],
  },
];

// The names, in file order. scaffold.mjs writes .env.example from this, so the
// committed list of CI secrets and the resolver can never drift apart.
export const ENV_VARS = KEYS.map(({ key }) => key);

const ENV_LINE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

function unquote(value) {
  const quoted = /^(["'])(.*)\1$/.exec(value.trim());
  return quoted ? quoted[2] : value.trim();
}

// Deliberately more forgiving than the loader the generated config carries: this
// reads files written by humans and other tools, so it takes `export ` prefixes
// and quoted values. Writing goes back out bare, which is what that loader reads.
export function parseEnvFile(content) {
  const values = {};
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(ENV_LINE);
    if (match) values[match[1]] = unquote(match[2]);
  }
  return values;
}

function readSourceFiles(targetPath, webServer) {
  const location = webServer?.status === 'resolved' ? webServer.location : null;
  const dirs = location && location !== '.' ? [location, '.'] : ['.'];
  const files = [];
  for (const dir of dirs) {
    for (const name of ENV_FILE_NAMES) {
      const rel = dir === '.' ? name : `${dir}/${name}`;
      const abs = join(targetPath, rel);
      if (existsSync(abs)) files.push({ rel, values: parseEnvFile(readFileSync(abs, 'utf8')) });
    }
  }
  return files;
}

// An empty value is not a match: a repo carrying `BASE_URL=` has declared the
// name and left it unset, which is the same nothing as not declaring it.
function findValue(files, name) {
  for (const file of files) {
    const value = file.values[name];
    if (value) return { value, source: `${file.rel}:${name}` };
  }
  return null;
}

function resolveKey({ key, derive, aliases }, files, webServer, env) {
  const match =
    findValue(files, key) ??
    derive?.(files, webServer, env) ??
    aliases.reduce((found, alias) => found ?? findValue(files, alias), null);
  return match ? { key, ...match } : { key, value: '', source: 'blank' };
}

// Resolve every key against the repo, without touching disk. `webServer` is the
// resolveWebServer() result, passed in rather than detected here: detect()
// probes e2e/web/package.json as a location, so a detect run after the
// scaffolder wrote that file would see the package it just created.
export function resolveEnvValues(targetPath, options = {}) {
  const { webServer, env = process.env } = options;
  const files = readSourceFiles(targetPath, webServer);
  return KEYS.map((entry) => resolveKey(entry, files, webServer, env));
}

// The FIRST matching line for a key (export-tolerant, and — per Finding B —
// leading-whitespace-tolerant), or undefined when the key has no line at all.
// Used instead of parseEnvFile's last-wins map: the generated config's own
// loader (fullConfig in scaffold.mjs) stops at the first `KEY=` line it finds,
// so a duplicated key must be classified and filled by that same first,
// runtime-effective occurrence — not whichever line parseEnvFile kept.
function firstLineValue(content, key) {
  const match = content.match(new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=(.*)$`, 'm'));
  return match ? unquote(match[1]) : undefined;
}

// Write e2e/web/.env, adding keys the file lacks and filling keys the file
// declares but left blank. A value already in the file is never overwritten —
// it may be a secret typed by hand, and setup has no better one. Values go in
// bare, because the config's loader keeps everything after the `=` verbatim.
//
// The report names each key's source file and matched name, never its value:
// setup's JSON output lands in an agent transcript.
export function writeEnvFile(targetPath, resolved, options = {}) {
  const webDir = resolveLocation(targetPath, options);
  const abs = join(targetPath, webDir, '.env');
  const existing = existsSync(abs) ? readFileSync(abs, 'utf8') : null;

  const firstOf = (key) => (existing === null ? undefined : firstLineValue(existing, key));
  const isPresent = (key) => firstOf(key) !== undefined;
  const isPresentEmpty = (key) => isPresent(key) && firstOf(key) === '';
  const toAppend = resolved.filter(({ key }) => !isPresent(key));
  const toFill = resolved.filter(({ key, value }) => isPresentEmpty(key) && value !== '');

  const keys = resolved.map(({ key, source }) => ({
    key,
    // Present with a non-empty value is kept. Present but left blank (e.g.
    // `E2E_USER_EMAIL=` from an earlier scaffold) and now resolved reports
    // that resolved source. Present but left blank with nothing resolved is
    // the same nothing as absent, so it reports blank rather than falsely
    // claiming a value. Absent reports its resolved source as before.
    source:
      isPresent(key) && firstOf(key) !== ''
        ? 'kept'
        : toFill.some((entry) => entry.key === key)
          ? source
          : isPresent(key)
            ? 'blank'
            : source,
  }));

  if (toAppend.length > 0 || toFill.length > 0) {
    mkdirSync(join(targetPath, webDir), { recursive: true });
    let out = existing ?? '';
    for (const { key, value } of toFill) {
      // Leading-whitespace-tolerant (Finding B) and targets only the first
      // occurrence (Finding C: no 'g' flag, matching firstLineValue above).
      const re = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=.*$`, 'm');
      out = out.replace(re, () => `${key}=${value}`); // function form: `$` in value is not a replacement token
    }
    if (toAppend.length > 0) {
      const prefix = out.length > 0 && !out.endsWith('\n') ? '\n' : '';
      const lines = toAppend.map(({ key, value }) => `${key}=${value}`);
      out = out + prefix + lines.join('\n') + '\n';
    }
    writeFileSync(abs, out);
  }

  return {
    path: `${webDir}/.env`,
    created: existing === null,
    added: [...toFill.map(({ key }) => key), ...toAppend.map(({ key }) => key)],
    keys,
  };
}

const isMainModule = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const targetPath = process.argv[2] ?? '.';
    const webServer = resolveWebServer(detect(targetPath), { suiteLocation: resolveLocation(targetPath, {}) });
    console.log(JSON.stringify(writeEnvFile(targetPath, resolveEnvValues(targetPath, { webServer })), null, 2));
  } catch (err) {
    // detect() is called bare here, so a malformed package.json anywhere in the
    // workspace throws. Match detect.mjs's own main: an error envelope on
    // stdout, exit 0 — never a raw stack.
    console.log(JSON.stringify({ status: 'error', message: err.message }, null, 2));
    process.exitCode = 0;
  }
}
