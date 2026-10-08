import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// One labelled row per persisted answer. Location is always present (a manifest
// without it is not a root manifest); the rest are written only when set, so an
// absent row reads as auto/unset and the next run re-detects.
export function manifestToBindingsSection(manifest) {
  const rows = [`| Location | \`${manifest.location}\` |`];
  if (manifest.pom !== undefined) {
    rows.push(`| Convention | \`${manifest.pom ? 'pom' : 'flat'}\` |`);
  }
  if (manifest.authScheme !== undefined) {
    rows.push(`| Auth scheme | \`${manifest.authScheme}\` |`);
  }
  if (manifest.linter !== undefined) {
    rows.push(`| Linter | \`${manifest.linter}\` |`);
  }
  if (manifest.typescript !== undefined) {
    rows.push(`| TypeScript | \`${manifest.typescript}\` |`);
  }
  return [
    '### E2E bindings',
    '',
    'Concrete E2E setup answers for this repo, in one place so every',
    'contributor — human or agent — reads the same ones. Rows are matched by',
    'label; an absent row means the value is auto-detected.',
    '',
    '| Binding | Value |',
    '|---|---|',
    ...rows,
    '',
  ].join('\n');
}

// The bindings file, by the same rule apptension-sdlc:setup uses: CLAUDE.md
// unless the repo keeps its bindings in AGENTS.md and has no CLAUDE.md.
export function resolveBindingsFile(repoRoot) {
  if (existsSync(join(repoRoot, 'CLAUDE.md'))) return 'CLAUDE.md';
  if (existsSync(join(repoRoot, 'AGENTS.md'))) return 'AGENTS.md';
  return 'CLAUDE.md';
}

// Prints the section from the answers approved at the gate, so the skill writes
// this output and never types a row by hand.
const isMainModule = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const flag = (name) => {
    const i = process.argv.indexOf(name);
    return i !== -1 ? process.argv[i + 1] : undefined;
  };
  const location = flag('--location');
  const convention = flag('--convention');
  if (!location) {
    console.error('bindings.mjs: --location is required');
    process.exit(1);
  }
  if (convention !== undefined && convention !== 'pom' && convention !== 'flat') {
    console.error(`bindings.mjs: --convention must be pom or flat, got ${convention}`);
    process.exit(1);
  }
  const manifest = { location };
  if (convention !== undefined) manifest.pom = convention === 'pom';
  if (flag('--auth-scheme') !== undefined) manifest.authScheme = flag('--auth-scheme');
  if (flag('--linter') !== undefined) manifest.linter = flag('--linter');
  if (flag('--typescript') !== undefined) manifest.typescript = flag('--typescript');
  process.stdout.write(manifestToBindingsSection(manifest));
}
