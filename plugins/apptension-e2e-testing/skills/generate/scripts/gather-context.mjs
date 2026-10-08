import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_FILE_PATTERNS = [
  /\.test\.[^/]+$/,
  /\.spec\.[^/]+$/,
  /(^|\/)__tests__\//,
  /(^|\/)test_[^/]+\.py$/,
  /_test\.py$/,
  /_test\.go$/,
  /_spec\.rb$/,
];

function isTestFile(path) {
  return TEST_FILE_PATTERNS.some((pattern) => pattern.test(path));
}

function splitLines(output) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// Node's default execFileSync maxBuffer is 1 MB. A `git diff`/`gh pr diff` on a
// large branch overflows it, and the child dies with ENOBUFS — which the diff
// helpers' catch turns into `[]` ("no changed files"), a wrong result rather
// than an error. 64 MB sits far above any realistic diff or gh payload; the
// output is buffered in memory either way, so raising the ceiling costs nothing.
export const MAX_BUFFER = 64 * 1024 * 1024;

export function defaultExec(command, args, options) {
  return execFileSync(command, args, { encoding: 'utf8', maxBuffer: MAX_BUFFER, ...options }).toString();
}

const FALLBACK_BASE_BRANCHES = ['main', 'master'];

function remoteBranchExists(targetPath, branch, exec) {
  try {
    exec('git', ['rev-parse', '--verify', `origin/${branch}`], { cwd: targetPath });
    return true;
  } catch {
    return false;
  }
}

function detectBaseBranch(targetPath, exec) {
  const ref = exec('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], { cwd: targetPath }).trim();
  return ref.replace(/^refs\/remotes\/origin\//, '');
}

export function detectBaseBranchSafely(targetPath, exec) {
  try {
    return detectBaseBranch(targetPath, exec);
  } catch {
    return FALLBACK_BASE_BRANCHES.find((branch) => remoteBranchExists(targetPath, branch, exec)) ?? null;
  }
}

function localDiffFiles(targetPath, base, exec) {
  let tracked = [];
  let trackedOk = true;
  try {
    const mergeBase = exec('git', ['merge-base', `origin/${base}`, 'HEAD'], { cwd: targetPath }).trim();
    tracked = splitLines(exec('git', ['diff', '--name-only', mergeBase], { cwd: targetPath }));
  } catch {
    // An unreachable merge-base (e.g. `origin/<base>` not fetched) keeps
    // the untracked scan below, but is reported so the caller does not
    // mistake an untracked-only list for a complete local diff.
    trackedOk = false;
  }

  let untracked = [];
  try {
    untracked = splitLines(exec('git', ['ls-files', '--others', '--exclude-standard'], { cwd: targetPath }));
  } catch {
    // Best-effort: a file `git rm --cached` left on disk shows as both a
    // deletion in `tracked` and untracked here, so dedupe. A failure to
    // list untracked files should not discard an already-successful
    // tracked diff.
  }
  return { files: [...new Set([...tracked, ...untracked])], tracked, trackedOk };
}

function linkedPrNumber(issueNumber, targetPath, exec) {
  try {
    const output = exec(
      'gh',
      ['issue', 'view', String(issueNumber), '--json', 'closedByPullRequestsReferences'],
      { cwd: targetPath },
    );
    const refs = JSON.parse(output).closedByPullRequestsReferences ?? [];
    return refs.length > 0 ? refs[0].number : null;
  } catch {
    return null;
  }
}

function prDiffFiles(prNumber, targetPath, exec) {
  try {
    const output = exec('gh', ['pr', 'diff', String(prNumber), '--name-only'], { cwd: targetPath });
    return splitLines(output);
  } catch {
    return [];
  }
}

function commitInCheckout(sha, targetPath, exec) {
  if (!sha) return false;
  try {
    exec('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd: targetPath });
    return true;
  } catch {
    return false;
  }
}

// The run boots and tests this checkout, so it must hold the PR's code: an
// open PR's head, or a merged PR's merge commit. A checkout that predates
// either would test code without the change. A failed view reports state
// null: the caller cannot confirm what it would test.
function prCheckout(prNumber, targetPath, exec) {
  let view;
  try {
    view = JSON.parse(
      exec('gh', ['pr', 'view', String(prNumber), '--json', 'state,headRefOid,mergeCommit'], { cwd: targetPath }),
    );
  } catch {
    return { number: prNumber, state: null };
  }
  const state = view.state ?? null;
  const code = { OPEN: view.headRefOid, MERGED: view.mergeCommit?.oid };
  if (!(state in code)) return { number: prNumber, state };
  return { number: prNumber, state, inCheckout: commitInCheckout(code[state], targetPath, exec) };
}

function fetchTicket(issueNumber, targetPath, exec) {
  const output = exec('gh', ['issue', 'view', String(issueNumber), '--json', 'title,body,labels'], { cwd: targetPath });
  return JSON.parse(output);
}

// `bug`, `type: bug`, `kind/bug`, `type-bug`: the word bug as the label's last
// token. `debug-tools` and `bugfix-backlog` name something else, and
// `not-a-bug`, `non-bug` and `no-bug` say the opposite.
const BUG_LABEL = /(^|[\s:/_-])bug$/i;
const NEGATED_BUG_LABEL = /(^|[\s:/_-])(not|non|no)([\s:/_-]+a)?[\s:/_-]+bug$/i;

export function bugSignalFromLabels(labels) {
  return (labels ?? []).some((label) => {
    const name = label.name.trim();
    return BUG_LABEL.test(name) && !NEGATED_BUG_LABEL.test(name);
  });
}

const ISSUE_TYPE_QUERY =
  'query($owner:String!,$repo:String!,$n:Int!){repository(owner:$owner,name:$repo){issue(number:$n){issueType{name}}}}';

// Best-effort: a repo without issue types, an old `gh`, or a failed call all
// mean no type signal, never a failed gather.
function issueTypeIsBug(issueNumber, targetPath, exec) {
  try {
    const output = exec(
      'gh',
      ['api', 'graphql', '-f', `query=${ISSUE_TYPE_QUERY}`, '-F', 'owner={owner}', '-F', 'repo={repo}', '-F', `n=${issueNumber}`],
      { cwd: targetPath },
    );
    const name = JSON.parse(output)?.data?.repository?.issue?.issueType?.name;
    return typeof name === 'string' && name.toLowerCase() === 'bug';
  } catch {
    return false;
  }
}

function bugSignal(ticket, issueNumber, targetPath, exec) {
  if (bugSignalFromLabels(ticket.labels)) return 'label';
  if (issueTypeIsBug(issueNumber, targetPath, exec)) return 'type';
  return null;
}

function currentBranch(targetPath, exec) {
  return exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: targetPath }).trim();
}

function readTestFiles(targetPath, paths) {
  return paths
    .filter((path) => existsSync(join(targetPath, path)))
    .map((path) => ({ path, content: readFileSync(join(targetPath, path), 'utf8') }));
}

function githubChildren(issueNumber, targetPath, exec) {
  try {
    const output = exec('gh', ['api', `repos/{owner}/{repo}/issues/${issueNumber}/sub_issues`], { cwd: targetPath });
    const subs = JSON.parse(output);
    return Array.isArray(subs) ? subs.length > 0 : null;
  } catch {
    return null;
  }
}

export function gatherContext(targetPath, issueNumber, options = {}) {
  const { exec = defaultExec, base } = options;

  const ticket = fetchTicket(issueNumber, targetPath, exec);
  const branch = currentBranch(targetPath, exec);

  let changedFiles = [];
  let diffSource = 'none';
  let pr;

  const resolvedBase = base ?? detectBaseBranchSafely(targetPath, exec);
  if (resolvedBase) {
    const local = localDiffFiles(targetPath, resolvedBase, exec);
    changedFiles = local.files;
    // Only committed work decides that this checkout holds the issue's
    // diff. An untracked-only list must not suppress the PR fallback:
    // one stray new file on a branch with no commits against base would
    // otherwise be reported as the whole change, hiding the linked PR.
    if (local.trackedOk && local.tracked.length > 0) diffSource = 'git';
  }

  if (diffSource !== 'git') {
    const prNumber = linkedPrNumber(issueNumber, targetPath, exec);
    if (prNumber) {
      const prFiles = prDiffFiles(prNumber, targetPath, exec);
      if (prFiles.length > 0) {
        // Untracked files are local-only, so the PR cannot list them.
        changedFiles = [...new Set([...prFiles, ...changedFiles])];
        diffSource = 'gh-pr';
        pr = prCheckout(prNumber, targetPath, exec);
      }
    }
    if (diffSource === 'none' && changedFiles.length > 0) diffSource = 'git';
  }

  let hasChildren;
  if (diffSource === 'none') {
    hasChildren = githubChildren(issueNumber, targetPath, exec);
  }

  const testFiles = readTestFiles(targetPath, changedFiles.filter(isTestFile));

  return {
    issueNumber,
    issueTitle: ticket.title,
    ticketBody: ticket.body,
    diffSource,
    branch,
    base: resolvedBase || null,
    changedFiles,
    testFiles,
    ...(pr ? { pr } : {}),
    ...(diffSource === 'none' ? { hasChildren } : {}),
    bug: bugSignal(ticket, issueNumber, targetPath, exec),
  };
}

export function parseCliArgs(argv) {
  const baseIndex = argv.indexOf('--base');
  const base = baseIndex !== -1 ? argv[baseIndex + 1] : undefined;
  const positional = baseIndex !== -1 ? [...argv.slice(0, baseIndex), ...argv.slice(baseIndex + 2)] : argv;
  return { issueNumber: Number(positional[0]), targetPath: positional[1] ?? '.', base };
}

const isMainModule = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const { issueNumber, targetPath, base } = parseCliArgs(process.argv.slice(2));
    console.log(JSON.stringify(gatherContext(targetPath, issueNumber, { base }), null, 2));
  } catch (err) {
    console.log(JSON.stringify({ status: 'error', message: err.message }, null, 2));
    process.exitCode = 0;
  }
}
