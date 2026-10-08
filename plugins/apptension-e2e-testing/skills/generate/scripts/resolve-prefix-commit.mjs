import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defaultExec, detectBaseBranchSafely } from './gather-context.mjs';

// The pre-fix commit is the base branch as it stood just before the fix. While
// the fix is unmerged that is the merge-base. Once it has merged the merge-base
// equals the fix branch head and already holds the fix, so the answer comes
// from how the PR landed.

class Unresolved extends Error {}

function lines(output) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function linkedPr(issue, targetPath, exec) {
  const output = exec('gh', ['issue', 'view', String(issue), '--json', 'closedByPullRequestsReferences'], {
    cwd: targetPath,
  });
  const refs = JSON.parse(output).closedByPullRequestsReferences ?? [];
  if (refs.length === 0) throw new Unresolved(`issue ${issue} has no linked pull request`);
  return refs[0].number;
}

// A rebase merge replays each PR commit onto the base with its author date
// intact. A squash writes one new commit dated at merge time. So the landed
// commits, newest first, carry the PR's author dates exactly when it was a
// rebase. Dates ignore both the message, which GitHub may change, and the
// diff context, which a base that moved beside a hunk changes.
function landedCommitCount(pr, view, mergeSha, targetPath, exec) {
  const count = view.commits.length;
  if (count <= 1) return { count: 1, method: 'squash' };
  const landed = lines(
    exec('git', ['log', '-n', String(count), '--first-parent', '--format=%aI', mergeSha], { cwd: targetPath }),
  ).map((date) => Date.parse(date));
  const authored = view.commits.map((commit) => Date.parse(commit.authoredDate)).reverse();

  if (landed[0] !== authored[0]) return { count: 1, method: 'squash' };
  if (landed.length === count && landed.every((date, i) => date === authored[i])) return { count, method: 'rebase' };
  throw new Unresolved(
    `merge commit ${mergeSha} carries pull request ${pr}'s last author date, but the ${count} commits below it do not match its author dates`,
  );
}

function assertSameFiles(pr, commit, mergeSha, targetPath, exec) {
  const landed = new Set(lines(exec('git', ['diff', '--name-only', commit, mergeSha], { cwd: targetPath })));
  const expected = new Set(lines(exec('gh', ['pr', 'diff', String(pr), '--name-only'], { cwd: targetPath })));
  const missing = [...expected].filter((file) => !landed.has(file));
  const extra = [...landed].filter((file) => !expected.has(file));
  if (missing.length > 0 || extra.length > 0) {
    throw new Unresolved(
      `${commit}..${mergeSha} does not match pull request ${pr}'s files` +
        (missing.length > 0 ? `; missing: ${missing.join(', ')}` : '') +
        (extra.length > 0 ? `; extra: ${extra.join(', ')}` : ''),
    );
  }
}

// The pre-fix run compares against step 8's run on the target checkout, so a
// pre-fix commit means something only when that checkout holds the fix.
function assertCheckoutHolds(sha, missing, targetPath, exec) {
  try {
    exec('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: targetPath });
  } catch {
    throw new Unresolved(`${sha} is not in this clone; ${missing}`);
  }
  try {
    exec('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd: targetPath });
  } catch {
    throw new Unresolved(`the checkout's HEAD does not contain ${sha}, so step 8 did not test the fix; ${missing}`);
  }
}

function fromMergedPr(pr, view, targetPath, exec) {
  const mergeSha = view.mergeCommit?.oid;
  if (!mergeSha) throw new Unresolved(`pull request ${pr} is merged but reports no merge commit`);
  assertCheckoutHolds(mergeSha, 'run git fetch origin, update the checkout to include it, and retry', targetPath, exec);

  const parents = JSON.parse(
    exec('gh', ['api', `repos/{owner}/{repo}/commits/${mergeSha}`, '--jq', '[.parents[].sha]'], { cwd: targetPath }),
  );

  let commit;
  let method;
  if (parents.length > 1) {
    commit = parents[0];
    method = 'merge-commit';
  } else {
    const landed = landedCommitCount(pr, view, mergeSha, targetPath, exec);
    method = landed.method;
    commit =
      method === 'rebase'
        ? exec('git', ['rev-parse', `${mergeSha}~${landed.count}`], { cwd: targetPath }).trim()
        : parents[0];
  }

  assertSameFiles(pr, commit, mergeSha, targetPath, exec);
  return { status: 'resolved', commit, method, pr };
}

function fromPr(issue, targetPath, exec) {
  if (!issue) throw new Unresolved('--source gh-pr needs --issue <N>');
  const pr = linkedPr(issue, targetPath, exec);
  const view = JSON.parse(
    exec('gh', ['pr', 'view', String(pr), '--json', 'state,baseRefName,headRefOid,mergeCommit,commits'], {
      cwd: targetPath,
    }),
  );

  if (view.state === 'OPEN') {
    assertCheckoutHolds(view.headRefOid, "check out the pull request's branch and run generate again", targetPath, exec);
    const commit = exec(
      'gh',
      ['api', `repos/{owner}/{repo}/compare/${view.baseRefName}...${view.headRefOid}`, '--jq', '.merge_base_commit.sha'],
      { cwd: targetPath },
    ).trim();
    return { status: 'resolved', commit, method: 'merge-base', pr };
  }
  if (view.state === 'MERGED') return fromMergedPr(pr, view, targetPath, exec);
  throw new Unresolved(`pull request ${pr} was closed without merging`);
}

// A fix based on a branch other than the default, such as a git-flow
// develop, forked from that branch. With no --base, an open PR names it.
function openPrBase(issue, targetPath, exec) {
  if (!issue) return null;
  try {
    const pr = linkedPr(issue, targetPath, exec);
    const view = JSON.parse(exec('gh', ['pr', 'view', String(pr), '--json', 'state,baseRefName,headRefOid,mergeCommit,commits'], { cwd: targetPath }));
    return view.state === 'OPEN' ? view.baseRefName : null;
  } catch {
    return null;
  }
}

function fromLocalDiff(base, issue, targetPath, exec) {
  const resolvedBase = base ?? openPrBase(issue, targetPath, exec) ?? detectBaseBranchSafely(targetPath, exec);
  if (!resolvedBase) throw new Unresolved('no base branch: origin/HEAD, origin/main and origin/master are all missing');
  const commit = exec('git', ['merge-base', `origin/${resolvedBase}`, 'HEAD'], { cwd: targetPath }).trim();
  return { status: 'resolved', commit, method: 'merge-base' };
}

export function resolvePrefixCommit(targetPath, options = {}) {
  const { source, issue, base, exec = defaultExec } = options;
  try {
    if (source === 'git') return fromLocalDiff(base, issue, targetPath, exec);
    if (source === 'gh-pr') return fromPr(issue, targetPath, exec);
    throw new Unresolved(`--source must be git or gh-pr, got ${source}`);
  } catch (err) {
    return { status: 'unresolved', reason: err.message };
  }
}

function flag(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

export function parseCliArgs(argv) {
  const valued = new Set(['--source', '--issue', '--base']);
  const positional = argv.filter((arg, i) => !valued.has(arg) && !valued.has(argv[i - 1]));
  const issue = flag(argv, '--issue');
  return {
    targetPath: positional[0] ?? '.',
    source: flag(argv, '--source'),
    issue: issue === undefined ? undefined : Number(issue),
    base: flag(argv, '--base'),
  };
}

const isMainModule = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const { targetPath, ...options } = parseCliArgs(process.argv.slice(2));
  console.log(JSON.stringify(resolvePrefixCommit(targetPath, options), null, 2));
  process.exitCode = 0;
}
