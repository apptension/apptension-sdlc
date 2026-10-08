import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { detect } from '../../e2e-setup/scripts/detect.mjs';
import { resolveLocation } from './run-specs.mjs';

// A worktree gets its own working copy but shares only committed blobs, and the
// suite gitignores node_modules, .auth and .env — so a fresh worktree cut from a
// commit where the suite was fully set up still has none of them. Re-running
// e2e-setup would re-scaffold an already-scaffolded suite; the fix is to install
// and restore this worktree.
export const SCAFFOLDED_NOT_INSTALLED_MESSAGE =
  'Playwright is scaffolded here but its dependencies are not installed in this worktree. ' +
  "Install them (and restore this worktree's .auth and .env), then re-run — do not run e2e-setup, the suite is already set up.";

// Runs before step 3 drafts or presents a plan, so a repo with no Playwright
// install anywhere stops before the human is asked to approve anything and
// before step 4 ever boots the app. No spec paths exist yet at this point —
// only the location-level status matters here; resolveLocation's disambiguation
// between several installs is left to steps 4, 7 and 8, which each resolve their
// own location once real spec paths exist.
//
// resolveLocation reads the declared dependency (package.json), which travels
// between worktrees once committed; the on-disk install that actually runs
// Playwright does not. So a resolved location whose deps are absent here is
// scaffolded but not installed — a distinct verdict from `no-playwright`, which
// means nothing is scaffolded at all.
//
// With an explicit location the operator named that suite, so its own install is
// the answer. With no location, resolveLocation picks the deepest declared suite,
// which may not be the installed one in a monorepo — so the worktree only counts
// as uninstalled when nothing is installed anywhere. A single-suite worktree, the
// #568 case, satisfies that by having no installed candidate at all.
export function checkPlaywright(targetPath, location) {
  const detected = detect(targetPath, { location });
  const resolved = resolveLocation(detected, [], location);
  if (resolved.status !== 'resolved') return resolved;

  const notInstalled = { status: 'scaffolded-not-installed', location: resolved.location, message: SCAFFOLDED_NOT_INSTALLED_MESSAGE };

  if (location) {
    const entry = detected.locations.find((candidate) => candidate.path === resolved.location);
    return entry?.playwright?.dependenciesInstalled === false ? notInstalled : resolved;
  }

  const installedAnywhere = detected.locations.some(
    (candidate) => candidate.playwright?.installed && candidate.playwright?.dependenciesInstalled,
  );
  return installedAnywhere ? resolved : notInstalled;
}

const isMainModule = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const targetPath = process.argv[2] ?? '.';
  const args = process.argv.slice(3);
  const locationIndex = args.indexOf('--location');
  const location = locationIndex !== -1 ? args[locationIndex + 1] : undefined;
  try {
    console.log(JSON.stringify(checkPlaywright(targetPath, location), null, 2));
  } catch (err) {
    console.log(JSON.stringify({ status: 'error', message: err.message }, null, 2));
    process.exitCode = 0;
  }
}
