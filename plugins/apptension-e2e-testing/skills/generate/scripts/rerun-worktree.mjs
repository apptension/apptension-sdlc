import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultExec } from './gather-context.mjs';

// A throwaway worktree for running the same specs against another commit: the
// pre-fix commit for generate's bug gate, the integration branch for
// triage-e2e-run's base re-run. Installing its dependencies is left to the
// caller, which follows the repo's own conventions.

const DEFAULT_SUITE = 'e2e/web';

function lines(output) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function filesUnder(root, relativeDir) {
  const dir = join(root, relativeDir);
  if (!existsSync(dir)) return [];
  if (!statSync(dir).isDirectory()) return [relativeDir];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath ?? entry.path, entry.name)));
}

// Every suite file this branch changed since it forked from the commit:
// tracked changes, staged or not, and untracked files git does not ignore.
// Measured from the merge-base, so a commit that moved on past the fork keeps
// its own newer files. A path the working tree deleted is returned apart, so
// the worktree loses it too and runs the same suite the fix side ran.
function changedSuiteFiles(root, commit, suite, exec) {
  const forkPoint = exec('git', ['merge-base', commit, 'HEAD'], { cwd: root }).trim();
  // --no-renames lists a rename as its deleted source and its added
  // destination, so the source is removed from the worktree too.
  const tracked = lines(exec('git', ['diff', '--no-renames', '--name-only', forkPoint, '--', suite], { cwd: root }));
  const untracked = lines(exec('git', ['ls-files', '--others', '--exclude-standard', '--', suite], { cwd: root }));
  const changed = [...tracked, ...untracked];
  return {
    present: changed.filter((path) => existsSync(join(root, path))),
    deleted: changed.filter((path) => !existsSync(join(root, path))),
  };
}

export function addWorktree(targetPath, options) {
  const { commit, copy = [], suiteLocation = DEFAULT_SUITE, exec = defaultExec } = options;
  let root;
  let path;
  let attempted = false;
  try {
    root = exec('git', ['rev-parse', '--show-toplevel'], { cwd: targetPath }).trim();
    const sha = exec('git', ['rev-parse', '--verify', `${commit}^{commit}`], { cwd: root }).trim();
    path = join(dirname(root), `${basename(root)}-e2e-${sha.slice(0, 7)}`);
    if (existsSync(path)) return { status: 'exists', path };

    const missing = copy.filter((file) => !existsSync(join(root, file)));
    if (missing.length > 0) return { status: 'error', message: `--copy path not found: ${missing.join(', ')}` };

    const suiteChanges = changedSuiteFiles(root, sha, suiteLocation, exec);
    const files = new Set([
      ...copy.flatMap((file) => filesUnder(root, file)),
      ...suiteChanges.present,
      ...filesUnder(root, join(suiteLocation, '.env')),
      ...filesUnder(root, join(suiteLocation, '.auth')),
    ]);

    attempted = true;
    exec('git', ['worktree', 'add', '--detach', path, sha], { cwd: root });
    for (const file of files) {
      mkdirSync(dirname(join(path, file)), { recursive: true });
      cpSync(join(root, file), join(path, file));
    }
    const removed = suiteChanges.deleted.filter((file) => existsSync(join(path, file)));
    for (const file of removed) rmSync(join(path, file), { force: true });
    return { status: 'added', path, commit: sha, copied: [...files].sort(), removed: removed.sort() };
  } catch (err) {
    // A failure from `git worktree add` on (a failing post-checkout hook, a
    // copy error) can leave a half-made worktree. Remove it, and name the
    // path either way so the caller can check.
    if (attempted) {
      try {
        removeWorktree(root, { path, exec });
      } catch {
        // Reported through the error below; the path lets the caller look.
      }
    }
    return { status: 'error', message: err.message, ...(path ? { path } : {}) };
  }
}

// Acts only on a linked worktree git itself lists, never the main checkout
// and never an arbitrary directory, so a wrong --path cannot delete anything.
export function removeWorktree(targetPath, options) {
  const { path, exec = defaultExec } = options;
  const root = exec('git', ['rev-parse', '--show-toplevel'], { cwd: targetPath }).trim();
  const [, ...linked] = lines(exec('git', ['worktree', 'list', '--porcelain'], { cwd: root }))
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));
  const wanted = existsSync(path) ? realpathSync(path) : path;

  if (!linked.includes(wanted)) {
    exec('git', ['worktree', 'prune'], { cwd: root });
    return { status: 'not-present' };
  }
  exec('git', ['worktree', 'remove', '--force', wanted], { cwd: root });
  exec('git', ['worktree', 'prune'], { cwd: root });
  return { status: 'removed' };
}

function flag(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

export function parseCliArgs(argv) {
  const [command, targetPath] = argv;
  if (command === 'remove') return { command, targetPath, path: flag(argv, '--path') };

  const copyIndex = argv.indexOf('--copy');
  const copy = [];
  if (copyIndex !== -1) {
    for (const arg of argv.slice(copyIndex + 1)) {
      if (arg.startsWith('--')) break;
      copy.push(arg);
    }
  }
  const suiteLocation = flag(argv, '--suite-location');
  return {
    command,
    targetPath,
    commit: flag(argv, '--commit'),
    copy,
    ...(suiteLocation ? { suiteLocation } : {}),
  };
}

const isMainModule = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const { command, targetPath = '.', ...options } = parseCliArgs(process.argv.slice(2));
  let result;
  try {
    if (command === 'add') result = addWorktree(targetPath, options);
    else if (command === 'remove') result = removeWorktree(targetPath, options);
    else result = { status: 'error', message: 'usage: rerun-worktree.mjs add|remove <target path> ...' };
  } catch (err) {
    result = { status: 'error', message: err.message };
  }
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 0;
}
