import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderAuthSetup, isRegeneratableAuthSetup } from './scaffold.mjs';
import { resolveLocation } from './manifest.mjs';

// All four selectors renderAuthSetup's working branch needs — see its opts
// destructuring in scaffold.mjs. Validated here, before any write, so a
// partial opts object (e.g. a CLI flag omitted) fails loud instead of
// rendering `page.undefined.fill(...)`.
const REQUIRED_OPTS = ['emailSelector', 'passwordSelector', 'submitSelector', 'waitUrl'];

// Overwrite e2e/web/auth.setup.ts with a working login rendered from the
// selectors the setup skill discovered over the bundled Playwright MCP —
// but only on a file this scaffolder owns: absent, or regeneratable per
// isRegeneratableAuthSetup (the current stub/prior working render carrying
// AUTH_SETUP_MARKER, or a pre-marker legacy stub recognized by its commented
// placeholder line). That lets a retry (fix selectors, rewrite, re-run)
// overwrite the previous working render — not just the untouched stub, and not
// just repos scaffolded after the marker existed. A suite with its own
// hand-authored auth.setup.ts (neither signal) is left untouched; the caller
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
  const rel = `${webDir}/auth.setup.ts`;
  const abs = join(targetPath, rel);
  if (existsSync(abs) && !isRegeneratableAuthSetup(readFileSync(abs, 'utf8'))) {
    return { written: null, refused: rel, reason: `existing ${rel} was not written by e2e-setup — left untouched` };
  }

  writeFileSync(abs, renderAuthSetup(opts));
  return { written: rel };
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
