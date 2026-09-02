import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MANIFEST_NAME } from '../../e2e-setup/scripts/scaffold.mjs';
import { findParsedManifestPath } from './write-specs.mjs';

// Writes the user's spec-structure choice into the scaffold manifest, leaving
// every other key untouched. The generate skill calls this once after the
// ask-once prompt, and again whenever --pom/--no-pom flips the mode.
export function persistPom(targetPath, value) {
  if (typeof value !== 'boolean') {
    return { status: 'error', message: `pom value must be a boolean, got ${typeof value}` };
  }
  const manifestPath = findParsedManifestPath(targetPath);
  if (!manifestPath) {
    return { status: 'error', message: `no usable ${MANIFEST_NAME} found under ${targetPath}` };
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    return { status: 'error', message: `manifest is not valid JSON: ${err.message}` };
  }
  manifest.pom = value;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return { status: 'ok', manifestPath };
}

const isMainModule = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const targetPath = process.argv[2] ?? '.';
  const args = process.argv.slice(3);
  const value = args.includes('--pom') ? true : args.includes('--no-pom') ? false : undefined;
  const result =
    value === undefined
      ? { status: 'error', message: 'pass --pom or --no-pom' }
      : persistPom(targetPath, value);
  console.log(JSON.stringify(result, null, 2));
}
