import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { detect } from '../../e2e-setup/scripts/detect.mjs';
import { resolveLocation } from './run-specs.mjs';

// Runs before step 3 drafts or presents a plan, so a repo with no Playwright
// install anywhere stops before the human is asked to approve anything and
// before step 4 ever boots the app. No spec paths exist yet at this point —
// only the `no-playwright` status matters here; resolveLocation's
// disambiguation between several installs is left to steps 4, 7 and 8, which
// each resolve their own location once real spec paths exist.
export function checkPlaywright(targetPath) {
  return resolveLocation(detect(targetPath), []);
}

const isMainModule = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const targetPath = process.argv[2] ?? '.';
  try {
    console.log(JSON.stringify(checkPlaywright(targetPath), null, 2));
  } catch (err) {
    console.log(JSON.stringify({ status: 'error', message: err.message }, null, 2));
    process.exitCode = 0;
  }
}
