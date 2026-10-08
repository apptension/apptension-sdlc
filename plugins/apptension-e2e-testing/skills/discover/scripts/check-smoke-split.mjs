import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findPlaywrightConfig } from '../../generate/scripts/write-specs.mjs';
import { hasSmokeSplit } from '../../e2e-setup/scripts/scaffold.mjs';

// The .smoke. filename infix only lands a spec in the merge-blocking
// Playwright project when the target's config actually has the
// smoke/granular split e2e-setup scaffolds. Writing the file is not enough
// on its own — a hand-authored config with no such split just runs the spec
// in whatever ordinary project matches, giving no merge-blocking guarantee
// at all. This is checked before writing, not after, so a missing split is
// an actionable stop instead of a spec that silently doesn't do its job.
// `location` is the e2e suite directory relative to the repo root, from
// the `### E2E bindings` Location row. A suite at a non-default location
// (e.g. 'services/e2e') is invisible to findPlaywrightConfig's fixed
// candidate walk without it, so the caller reads Location and passes it
// through; a suite at the default e2e/web needs no location.
export function checkSmokeSplit(targetPath, location) {
  const configPath = findPlaywrightConfig(targetPath, location);
  if (!configPath) {
    return { hasSplit: false, configPath: null };
  }

  return { hasSplit: hasSmokeSplit(readFileSync(configPath, 'utf8')), configPath };
}

const isMainModule = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const args = process.argv.slice(2);
    const locationFlag = args.indexOf('--location');
    const location = locationFlag === -1 ? undefined : args[locationFlag + 1];
    const positional = args.filter((arg, index) => {
      if (locationFlag !== -1 && (index === locationFlag || index === locationFlag + 1)) return false;
      return !arg.startsWith('--');
    });
    const targetPath = positional[0] ?? '.';
    console.log(JSON.stringify(checkSmokeSplit(targetPath, location), null, 2));
  } catch (err) {
    // A removed or unreadable config makes the read throw. Match the other
    // entrypoints: an error envelope on stdout, exit 0 — never a raw stack.
    console.log(JSON.stringify({ status: 'error', message: err.message }, null, 2));
    process.exitCode = 0;
  }
}
