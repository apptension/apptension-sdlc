import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect, resolvePackageManager, PLAYWRIGHT_CONFIG_NAMES } from './detect.mjs';
import { resolveLocation } from './manifest.mjs';

// How each manager runs a project-local binary. npx resolves outside the
// project under Yarn Berry's PnP, so a hardcoded npx breaks there; each
// manager's own exec form resolves against its own install. First element is
// the command, the rest is prefix args before `playwright install ...`.
// __proto__: null so an unrecognised manager name that happens to be an
// Object.prototype key (constructor, toString, ...) misses instead of
// resolving to an inherited member and falls back to npx below.
const EXEC_FORM = {
  __proto__: null,
  npm: ['npx'],
  yarn: ['yarn'],
  pnpm: ['pnpm', 'exec'],
  bun: ['bunx'],
};

export function execForm(packageManager) {
  return EXEC_FORM[packageManager] ?? EXEC_FORM.npm;
}

// Which browser engines the scaffolded config actually needs: every project
// spreads `...devices['<name>']`, and each descriptor carries a
// `defaultBrowserType` (chromium/firefox/webkit). Installing only these avoids
// pulling engines the projects never use.
export function enginesFromConfig(configText, devices) {
  const names = [...configText.matchAll(/devices\['([^']+)'\]/g)].map((m) => m[1]);
  const engines = new Set();
  for (const name of names) {
    const engine = devices?.[name]?.defaultBrowserType;
    if (engine) engines.add(engine);
  }
  return [...engines].sort();
}

// The child's stdout goes to stderr: stdout carries only this script's JSON
// result, and the human still sees the progress in the terminal.
function defaultRun(command, args, options) {
  execFileSync(command, args, { stdio: ['inherit', process.stderr, 'inherit'], ...options });
}

// Ensure the browser binaries for the scaffolded config are present. Playwright's
// own installer is idempotent — it downloads only the browsers that are missing —
// so this is safe to re-run.
export function installBrowsers(targetPath, options = {}) {
  const { run = defaultRun, withDeps = false, onlyShell = false, packageManager } = options;
  // Resolve to absolute: createRequire (below) rejects a relative path, and the
  // SKILL invites a relative target (e.g. `webapp`).
  const root = resolve(targetPath);
  const webDir = resolveLocation(root, options);
  const webAbs = join(root, webDir);

  // The suite's config may carry any Playwright config name: a conform suite
  // configured in .js is left as-is by the ownership gate, so keying on .ts
  // alone would report no-config and fail setup for exactly that case.
  const configName = PLAYWRIGHT_CONFIG_NAMES.find((name) => existsSync(join(webAbs, name)));
  if (!configName) {
    return { status: 'no-config', message: `No Playwright config in ${webDir} — run the scaffolder first.` };
  }
  const configPath = join(webAbs, configName);

  let devices;
  try {
    devices = createRequire(join(webAbs, 'package.json'))('@playwright/test').devices;
  } catch {
    return {
      status: 'not-installed',
      message: `@playwright/test is not installed in ${webDir} — run \`npm install\` there first.`,
    };
  }

  const engines = enginesFromConfig(readFileSync(configPath, 'utf8'), devices);
  const args = ['playwright', 'install', ...engines];
  if (withDeps) args.push('--with-deps');
  // --only-shell swaps the full Chromium download for the smaller headless
  // shell. Playwright applies it only to the chromium engine, so it is a no-op
  // when the config pulls firefox/webkit alone — safe to pass unconditionally
  // when requested.
  if (onlyShell) args.push('--only-shell');
  const [command, ...prefix] = execForm(packageManager);
  run(command, [...prefix, ...args], { cwd: webAbs });
  return { status: 'ok', engines };
}

const isMainModule = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const targetPath = process.argv[2] ?? '.';
  const withDeps = process.argv.includes('--with-deps');
  const onlyShell = process.argv.includes('--only-shell');
  const pmFlag = process.argv.indexOf('--pm');
  const packageManager = pmFlag !== -1 ? process.argv[pmFlag + 1] : resolvePackageManager(detect(targetPath));
  const locationFlag = process.argv.indexOf('--location');
  const location = locationFlag !== -1 ? process.argv[locationFlag + 1] : undefined;
  const result = installBrowsers(targetPath, { withDeps, onlyShell, packageManager, location });
  if (result.status === 'no-config' || result.status === 'not-installed') {
    console.error(result.message);
    process.exit(1);
  }
  console.log(JSON.stringify(result, null, 2));
}
