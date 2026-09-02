import { existsSync, readdirSync, lstatSync, statSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSpecDir, isValidSlug } from './write-specs.mjs';

const SPEC_PATTERN = /\.spec\.[a-z]+$/;

function listDir(absolute) {
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute);
}

// A flow is a real directory that already sits in specDir, named as a plain
// kebab-case component — the same shape write-specs.mjs requires of a
// flowId it's asked to write into. A directory failing that shape is never
// offered as a match candidate: the plan would carry a flowId the writer
// refuses three steps later.
//
// lstatSync, not statSync: a symlink named like a valid flow (even one
// pointing at a real directory) is never treated as one. Reporting it as a
// flow would offer it as a match candidate that write-specs.mjs would then
// write through, following the link off wherever it points — including
// outside the repo entirely.
export function existingFlows(specDirAbsolute) {
  return listDir(specDirAbsolute).filter(
    (entry) => lstatSync(join(specDirAbsolute, entry)).isDirectory() && isValidSlug(entry),
  );
}

// statSync, not lstatSync: a live symlink to a real spec file is still a
// readable spec and belongs in the listing. But statSync throws ENOENT on a
// dangling one (target no longer exists) instead of returning stats for
// it — caught per entry so one broken link reports as "not a file" rather
// than crashing the whole listing.
function isReadableFile(absolutePath) {
  try {
    return statSync(absolutePath).isFile();
  } catch {
    return false;
  }
}

function specsIn(flowDirAbsolute) {
  return listDir(flowDirAbsolute)
    .filter((entry) => SPEC_PATTERN.test(entry) && isReadableFile(join(flowDirAbsolute, entry)))
    .sort();
}

// What the matching step (generate's SKILL.md step 3) reads to decide which
// existing user path a new case belongs to, instead of guessing with `find`
// against a hardcoded `e2e` that may not be where write-specs.mjs actually
// resolves to. Spec filenames are included, not just directory names: they
// carry the product vocabulary ("apply-promo-code") that makes a match
// obvious without opening any file.
export function listFlows(targetPath, options = {}) {
  const specDir = resolveSpecDir(targetPath, options);
  const specDirAbsolute = join(targetPath, specDir);

  const flows = existingFlows(specDirAbsolute)
    .sort()
    .map((flowId) => ({ flowId, specs: specsIn(join(specDirAbsolute, flowId)) }));

  return { specDir, flows };
}

const isMainModule = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const targetPath = process.argv[2] ?? '.';
  const args = process.argv.slice(3);
  const specDirIndex = args.indexOf('--spec-dir');
  const specDir = specDirIndex !== -1 ? args[specDirIndex + 1] : undefined;

  try {
    console.log(JSON.stringify(listFlows(targetPath, { specDir }), null, 2));
  } catch (err) {
    console.log(JSON.stringify({ status: 'error', message: err.message }, null, 2));
    process.exitCode = 0;
  }
}
