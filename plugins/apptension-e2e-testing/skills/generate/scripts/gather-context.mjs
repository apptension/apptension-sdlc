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

function detectBaseBranchSafely(targetPath, exec) {
  try {
    return detectBaseBranch(targetPath, exec);
  } catch {
    return FALLBACK_BASE_BRANCHES.find((branch) => remoteBranchExists(targetPath, branch, exec)) ?? null;
  }
}

function localDiffFiles(targetPath, base, exec) {
  try {
    const output = exec('git', ['diff', '--name-only', `origin/${base}...HEAD`], { cwd: targetPath });
    return splitLines(output);
  } catch {
    return [];
  }
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

function fetchTicket(issueNumber, targetPath, exec) {
  const output = exec('gh', ['issue', 'view', String(issueNumber), '--json', 'title,body'], { cwd: targetPath });
  return JSON.parse(output);
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

  const resolvedBase = base ?? detectBaseBranchSafely(targetPath, exec);
  if (resolvedBase) {
    changedFiles = localDiffFiles(targetPath, resolvedBase, exec);
    if (changedFiles.length > 0) diffSource = 'git';
  }

  if (changedFiles.length === 0) {
    const prNumber = linkedPrNumber(issueNumber, targetPath, exec);
    if (prNumber) {
      const prFiles = prDiffFiles(prNumber, targetPath, exec);
      if (prFiles.length > 0) {
        changedFiles = prFiles;
        diffSource = 'gh-pr';
      }
    }
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
    ...(diffSource === 'none' ? { hasChildren } : {}),
  };
}

const isMainModule = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const issueNumber = Number(process.argv[2]);
    const targetPath = process.argv[3] ?? '.';
    console.log(JSON.stringify(gatherContext(targetPath, issueNumber), null, 2));
  } catch (err) {
    console.log(JSON.stringify({ status: 'error', message: err.message }, null, 2));
    process.exitCode = 0;
  }
}
