import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect, resolvePackageManager } from './detect.mjs';
import { scaffold } from './scaffold.mjs';
import { installPlaywright } from './install-playwright.mjs';
import { installBrowsers } from './install-browsers.mjs';
import { resolveWebServer } from './web-server.mjs';
import { resolveLocation } from './manifest.mjs';

// Orchestrate the post-wizard tail in one cd-free call. The pre-wizard
// @playwright/test install (so list-devices can enumerate) stays a separate
// step; this re-affirms it idempotently and is self-sufficient on a
// desktop-only run. Order matches #105: detect -> scaffold -> install -> browsers.
export function runSetup(targetPath, options = {}) {
  const { browsers = ['chromium'], devices = [], resolutions = [], withDeps = false, onlyShell = false, packageManager, createMissing = false, run, location, authScheme, linter, typescript } = options;

  // Resolve once so every downstream module gets an absolute path, independent
  // of the caller's cwd (the SKILL invites a relative target like `webapp`).
  const root = resolve(targetPath);
  // Detect before scaffolding: scaffold writes e2e/web/package.json, which
  // detect probes as its own location.
  const report = detect(root);
  const pm = packageManager ?? resolvePackageManager(report);
  // Resolve the suite location before the webServer: resolveWebServer's cwd is
  // computed relative to where the suite's config actually lives, so a custom
  // suite location must be known before it runs, not defaulted to e2e/web.
  const suiteLocation = resolveLocation(root, options);
  const webServer = resolveWebServer(report, { suiteLocation });

  const scaffoldResult = scaffold(root, { browsers, devices, resolutions, createMissing, webServer, packageManager: pm, location, authScheme, linter, typescript });
  if (scaffoldResult.status === 'conform') {
    return { status: 'conform', packageManager: pm, webServer, scaffold: scaffoldResult };
  }

  const installResult = installPlaywright(root, { packageManager: pm, run, location, linter, typescript });
  const browsersResult = installBrowsers(root, { withDeps, onlyShell, run, packageManager: pm, location });

  return {
    status: browsersResult.status,
    packageManager: pm,
    webServer,
    scaffold: scaffoldResult,
    browsers: browsersResult,
    rootFilesTouched: installResult.rootFilesTouched,
  };
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
  const result = runSetup(targetPath, {
    browsers,
    devices,
    resolutions,
    withDeps: process.argv.includes('--with-deps'),
    onlyShell: process.argv.includes('--only-shell'),
    packageManager: flag('--pm'),
    createMissing: process.argv.includes('--create-missing'),
    location: flag('--location'),
    authScheme: flag('--auth'),
    linter: flag('--linter'),
    typescript: flag('--typescript'),
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'ok' && result.status !== 'conform') process.exit(1);
}
