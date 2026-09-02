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
export function checkSmokeSplit(targetPath) {
  const configPath = findPlaywrightConfig(targetPath);
  if (!configPath) {
    return { hasSplit: false, configPath: null };
  }

  return { hasSplit: hasSmokeSplit(readFileSync(configPath, 'utf8')), configPath };
}

const isMainModule = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const targetPath = process.argv[2] ?? '.';
    console.log(JSON.stringify(checkSmokeSplit(targetPath), null, 2));
  } catch (err) {
    // A removed or unreadable config makes the read throw. Match the other
    // entrypoints: an error envelope on stdout, exit 0 — never a raw stack.
    console.log(JSON.stringify({ status: 'error', message: err.message }, null, 2));
    process.exitCode = 0;
  }
}
