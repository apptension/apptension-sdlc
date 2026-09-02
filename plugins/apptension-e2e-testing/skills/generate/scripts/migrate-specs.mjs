import { existsSync, readFileSync, readdirSync, statSync, rmSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveSpecDir, isValidSlug } from './write-specs.mjs';
import { existingFlows } from './list-flows.mjs';

const SPEC_PATTERN = /\.spec\.[a-z]+$/;
const LEDGER_PATTERN = /^generated-.*\.json$/;

function defaultRun(command, args, options) {
  execFileSync(command, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...options });
}

const NOT_A_REPO_PATTERN = /not a git repository/i;

// git mv refuses an untracked file, and by the time it does, any earlier
// moves in the loop have already landed on disk and in the index — exactly
// the half-migrated state this script exists to prevent. So every source is
// confirmed tracked before any move happens, through the injected `run` (not
// execFileSync directly) so tests can simulate both outcomes. "Not a git
// repository at all" is distinguished from "this file is untracked": the
// former is an environment problem, the latter is the guard doing its job.
function checkTracked(run, targetPath, moves) {
  const untracked = [];
  for (const move of moves) {
    try {
      run('git', ['ls-files', '--error-unmatch', move.from], { cwd: targetPath });
    } catch (err) {
      const message = String(err.stderr ?? err.message ?? '');
      if (NOT_A_REPO_PATTERN.test(message)) return { status: 'not-a-repo', message: message.trim() };
      untracked.push(move.from);
    }
  }
  return { status: 'ok', untracked };
}

// Repeated `--map <file>=<flowId>`. A value with no '=' is dropped rather
// than guessed at: an unmapped file is the honest report, and --apply
// refuses while any remain.
export function parseMapArgs(args) {
  const map = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--map') continue;
    const pair = args[index + 1] ?? '';
    const split = pair.indexOf('=');
    if (split <= 0) continue;
    map[pair.slice(0, split)] = pair.slice(split + 1);
  }
  return map;
}

function listDir(absolute) {
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute);
}

function flatSpecs(specDirAbsolute) {
  return listDir(specDirAbsolute).filter(
    (entry) => SPEC_PATTERN.test(entry) && statSync(join(specDirAbsolute, entry)).isFile(),
  );
}

function leadingSegment(file) {
  return file.replace(SPEC_PATTERN, '').split('-')[0];
}

function findLedgers(targetPath) {
  const dir = join(targetPath, '.e2e-testing');
  return listDir(dir)
    .filter((entry) => LEDGER_PATTERN.test(entry))
    .map((entry) => join('.e2e-testing', entry))
    .sort();
}

// A legacy ledger recorded the specDir its own run used. If that disagrees
// with the specDir this run resolved to, the flat specs it describes were
// never scanned here — deleting the ledger would destroy the only record of
// a suite this run never actually touched. A ledger with no specDir field,
// or unreadable/malformed JSON, cannot be compared either way, so it is
// treated as compatible rather than refused — there is nothing to disagree
// with.
function ledgerSpecDirDisagrees(targetPath, ledgerRelativePath, resolvedSpecDir) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(join(targetPath, ledgerRelativePath), 'utf8'));
  } catch {
    return false;
  }
  const recorded = parsed?.specDir;
  return typeof recorded === 'string' && recorded !== resolvedSpecDir;
}

export function migrateSpecs(targetPath, options = {}) {
  const { map = {}, apply = false, deleteLedgers = false, run = defaultRun, specDir: specDirOption } = options;

  const specDir = resolveSpecDir(targetPath, { specDir: specDirOption });
  const specDirAbsolute = join(targetPath, specDir);

  // Flows named in --map count as known, so one flag teaches a flow and its
  // leading-segment siblings follow.
  const flows = new Set([...existingFlows(specDirAbsolute), ...Object.values(map).filter(isValidSlug)]);

  const moves = [];
  const unmapped = [];
  for (const file of flatSpecs(specDirAbsolute)) {
    // An explicit --map entry, even a malformed one, is a human instruction
    // and takes priority: it is never allowed to fall through to the
    // leading-segment sweep, where filename coincidence could silently move
    // the file somewhere the human never named. Unmapped is the safe
    // direction to be wrong in.
    const hasExplicitMapping = Object.hasOwn(map, file);
    const explicit = map[file];
    const flowId = hasExplicitMapping
      ? isValidSlug(explicit) ? explicit : null
      : flows.has(leadingSegment(file)) ? leadingSegment(file) : null;
    if (flowId === null) {
      unmapped.push(join(specDir, file));
      continue;
    }
    moves.push({ from: join(specDir, file), to: join(specDir, flowId, file), flowId });
  }

  const ledgers = findLedgers(targetPath);
  const report = { specDir, moves, unmapped, ledgers, deleted: [] };

  if (!apply) return { status: 'reported', ...report };

  // No partial migration. A half-moved suite is worse than an unmoved one:
  // nothing tells the next person which half is which.
  if (unmapped.length > 0) return { status: 'refused-unmapped', ...report };

  const tracked = checkTracked(run, targetPath, moves);
  if (tracked.status === 'not-a-repo') {
    return { status: 'error', message: tracked.message || `Not a git repository: ${targetPath}` };
  }
  if (tracked.untracked.length > 0) {
    return { status: 'refused-untracked', ...report, untracked: tracked.untracked };
  }

  // git mv refuses an existing destination, and by the time it does, any
  // earlier moves in the loop have already landed — the same half-migrated
  // state the untracked-file check above exists to prevent. Every
  // destination is checked before any move happens.
  const collisions = moves.filter((move) => existsSync(join(targetPath, move.to))).map((move) => move.to);
  if (collisions.length > 0) {
    return { status: 'refused-collision', ...report, collisions };
  }

  for (const move of moves) {
    // git mv does not create missing destination directories and fails
    // immediately if one is absent — exactly the case a brand-new flow
    // named via --map produces. mkdirSync recursive is a no-op when the
    // directory (e.g. an existing flow) is already there.
    mkdirSync(join(targetPath, specDir, move.flowId), { recursive: true });
    run('git', ['mv', move.from, move.to], { cwd: targetPath });
  }

  // The flag is the confirmation. --apply alone names the ledgers and leaves
  // them exactly where they are.
  const deleted = [];
  const ledgerSpecDirMismatch = [];
  if (deleteLedgers) {
    for (const ledger of ledgers) {
      if (ledgerSpecDirDisagrees(targetPath, ledger, specDir)) {
        ledgerSpecDirMismatch.push(ledger);
        continue;
      }
      rmSync(join(targetPath, ledger), { force: true });
      deleted.push(ledger);
    }
  }

  return { status: 'migrated', ...report, deleted, ledgerSpecDirMismatch };
}

const isMainModule = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const targetPath = process.argv[2] ?? '.';
  const args = process.argv.slice(3);
  const specDirIndex = args.indexOf('--spec-dir');
  const specDir = specDirIndex !== -1 ? args[specDirIndex + 1] : undefined;

  try {
    const result = migrateSpecs(targetPath, {
      map: parseMapArgs(args),
      apply: args.includes('--apply'),
      deleteLedgers: args.includes('--delete-ledgers'),
      specDir,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.log(JSON.stringify({ status: 'error', message: err.message }, null, 2));
    process.exitCode = 0;
  }
}
