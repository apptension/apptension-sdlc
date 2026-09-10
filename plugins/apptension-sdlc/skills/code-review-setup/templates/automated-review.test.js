const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateReview,
  loadReview,
  changedLinesFromFiles,
  countAutomatedReviews,
  postReview,
  resolveAddressedThreads,
} = require('./automated-review.%%EXT%%');

const sha = 'a'.repeat(40);

test('counts no automated reviews when review history is empty', () => {
  assert.equal(countAutomatedReviews([]), 0);
});

test('counts three automated reviews from review history', () => {
  assert.equal(countAutomatedReviews([
    { user: { login: 'github-actions[bot]' }, submitted_at: '2026-08-18T10:00:00Z' },
    { user: { login: 'github-actions[bot]' }, submitted_at: '2026-08-18T10:01:00Z' },
    { user: { login: 'github-actions[bot]' }, submitted_at: '2026-08-18T10:02:00Z' },
  ]), 3);
});

test('does not count pending automated reviews', () => {
  assert.equal(countAutomatedReviews([
    { user: { login: 'github-actions[bot]' }, submitted_at: null },
    { user: { login: 'github-actions[bot]' }, submitted_at: '2026-08-18T10:00:00Z' },
  ]), 1);
});

test('does not count human reviews', () => {
  assert.equal(countAutomatedReviews([
    { user: { login: 'octocat' } },
    { user: { login: 'github-actions[bot]' }, submitted_at: '2026-08-18T10:00:00Z' },
  ]), 1);
});

test('does not count malformed review entries', () => {
  assert.equal(countAutomatedReviews([
    null,
    {},
    { user: null },
    { user: {} },
    { user: { login: 'octocat' } },
  ]), 0);
  assert.equal(countAutomatedReviews(null), 0);
});

test('keeps unique findings on changed new-side lines', () => {
  const result = validateReview({
    review: { head_sha: sha, outcome: 'reviewed', summary: null, addressed_comment_ids: [], findings: [{ path: 'src/a.ts', line: 4, body: 'Handle the null value.', severity: null }] },
    headSha: sha,
    changedLines: new Map([['src/a.ts', new Set([4])]]),
    noFindingsSummary: 'No issues found',
  });
  assert.deepEqual(result, { comments: [{ path: 'src/a.ts', line: 4, body: 'Handle the null value.' }], body: null, addressedCommentIds: [] });
});

test('preserves a useful later-round summary when no current inline findings survive', () => {
  const result = validateReview({
    review: {
      head_sha: sha,
      outcome: 'reviewed',
      summary: 'The earlier finding at src/a.ts:4 was addressed by the null guard.',
      addressed_comment_ids: [4021],
      findings: [],
    },
    headSha: sha,
    changedLines: new Map(),
    noFindingsSummary: 'No issues found',
  });

  assert.deepEqual(result, {
    comments: [],
    body: 'The earlier finding at src/a.ts:4 was addressed by the null guard.',
    addressedCommentIds: [4021],
  });
});

test('deduplicates addressed comment ids', () => {
  assert.deepEqual(validateReview({
    review: { head_sha: sha, outcome: 'reviewed', summary: 'Two earlier findings are addressed.', addressed_comment_ids: [7, 8, 7], findings: [] },
    headSha: sha,
    changedLines: new Map(),
  }).addressedCommentIds, [7, 8]);
});

test('rejects malformed addressed comment ids', () => {
  const base = { head_sha: sha, outcome: 'reviewed', summary: null, findings: [] };
  assert.throws(() => validateReview({ review: { ...base }, headSha: sha, changedLines: new Map() }), /addressed_comment_ids.*required/);
  assert.throws(() => validateReview({ review: { ...base, addressed_comment_ids: 'none' }, headSha: sha, changedLines: new Map() }), /addressed_comment_ids must be an array/);
  for (const id of [0, -1, 2.5, '7', null]) {
    assert.throws(() => validateReview({ review: { ...base, addressed_comment_ids: [id] }, headSha: sha, changedLines: new Map() }), /addressed comment id must be a positive integer/);
  }
  assert.throws(() => validateReview({
    review: { ...base, addressed_comment_ids: Array.from({ length: 51 }, (_, index) => index + 1) },
    headSha: sha,
    changedLines: new Map(),
  }), /at most 50 items/);
});

test('rejects findings outside the current patch', () => {
  assert.throws(() => validateReview({
    review: { head_sha: sha, outcome: 'reviewed', summary: null, addressed_comment_ids: [], findings: [{ path: 'src/a.ts', line: 3, body: 'No.', severity: null }] },
    headSha: sha,
    changedLines: new Map(),
  }), /outside the current patch.*src\/a\.ts:3/);
});

test('supplies the shared verdict when no findings survive validation', () => {
  assert.deepEqual(validateReview({
    review: { head_sha: sha, outcome: 'reviewed', summary: null, addressed_comment_ids: [], findings: [] },
    headSha: sha,
    changedLines: new Map(),
    noFindingsSummary: 'No issues found',
  }), { comments: [], body: 'No issues found', addressedCommentIds: [] });
  assert.deepEqual(validateReview({
    review: { head_sha: sha, outcome: 'reviewed', summary: '  ', addressed_comment_ids: [], findings: [] },
    headSha: sha,
    changedLines: new Map(),
    noFindingsSummary: 'No issues found',
  }), { comments: [], body: 'No issues found', addressedCommentIds: [] });
  assert.throws(() => validateReview({
    review: { head_sha: sha, outcome: 'reviewed', summary: null, addressed_comment_ids: [], findings: [{ path: 'missing.ts', line: 1, body: 'Out of patch.', severity: null }] },
    headSha: sha,
    changedLines: new Map(),
    noFindingsSummary: 'No issues found',
  }), /outside the current patch/);
  assert.throws(() => validateReview({
    review: { head_sha: sha, outcome: 'reviewed', summary: null, addressed_comment_ids: [], findings: [{ path: 'missing.ts', line: 1, body: 'Out of patch.', severity: null }] },
    headSha: sha,
    changedLines: new Map(),
  }), /outside the current patch/);
});

test('rejects stale, malformed, and unknown-key output', () => {
  assert.throws(() => validateReview({ review: { head_sha: 'b'.repeat(40), outcome: 'reviewed', summary: null, addressed_comment_ids: [], findings: [] }, headSha: sha, changedLines: new Map() }), /stale PR head SHA/);
  assert.throws(() => validateReview({ review: { head_sha: sha, outcome: 'reviewed', summary: null, addressed_comment_ids: [], findings: 'no' }, headSha: sha, changedLines: new Map() }), /findings/);
  assert.throws(() => validateReview({ review: { head_sha: sha, outcome: 'reviewed', summary: null, addressed_comment_ids: [], findings: [], extra: true }, headSha: sha, changedLines: new Map() }), /unknown key/);
  assert.throws(() => validateReview({ review: { head_sha: sha, outcome: 'reviewed', summary: null, addressed_comment_ids: [], findings: [{ path: 'a', line: 0, body: 'x', severity: null }] }, headSha: sha, changedLines: new Map() }), /positive integer/);
  assert.throws(() => validateReview({ review: { head_sha: sha, outcome: 'reviewed', summary: null, addressed_comment_ids: [], findings: [{ path: 'a', line: 1, body: 'x', severity: 'urgent' }] }, headSha: sha, changedLines: new Map() }), /severity/);
  assert.throws(() => validateReview({ review: { head_sha: sha, summary: 'Review could not be completed.', addressed_comment_ids: [], findings: [] }, headSha: sha, changedLines: new Map() }), /outcome.*required/);
  assert.throws(() => validateReview({ review: { head_sha: sha, outcome: 'reviewed', addressed_comment_ids: [], findings: [] }, headSha: sha, changedLines: new Map() }), /summary.*required/);
  assert.throws(() => validateReview({ review: { head_sha: sha, outcome: 'reviewed', summary: null, addressed_comment_ids: [], findings: [{ path: 'a', line: 1, body: 'x' }] }, headSha: sha, changedLines: new Map() }), /severity.*required/);
});

test('rejects more findings than one GitHub review can publish', () => {
  const findings = Array.from({ length: 51 }, (_, index) => ({
    path: 'src/a.ts', line: index + 1, body: `Finding ${index + 1}`, severity: null,
  }));
  assert.throws(() => validateReview({
    review: { head_sha: sha, outcome: 'reviewed', summary: null, addressed_comment_ids: [], findings },
    headSha: sha,
    changedLines: new Map([['src/a.ts', new Set(findings.map(({ line }) => line))]]),
  }), /at most 50 items/);
});

test('fails closed when a provider could not complete the review', () => {
  for (const noFindingsSummary of [null, 'No issues found']) {
    assert.throws(() => validateReview({
      review: {
        head_sha: null,
        outcome: 'failed',
        summary: 'PR data was unavailable.',
        addressed_comment_ids: [],
        findings: [],
      },
      headSha: sha,
      changedLines: new Map(),
      noFindingsSummary,
    }), /Automated review failed: PR data was unavailable\./);
  }
  assert.throws(() => validateReview({
    review: { head_sha: null, outcome: 'failed', summary: null, addressed_comment_ids: [], findings: [] },
    headSha: sha,
    changedLines: new Map(),
  }), /must explain/);
  assert.throws(() => validateReview({
    review: {
      head_sha: null,
      outcome: 'failed',
      summary: 'Partial review only.',
      addressed_comment_ids: [],
      findings: [{ path: 'src/a.ts', line: 1, body: 'Untrusted partial finding.', severity: null }],
    },
    headSha: sha,
    changedLines: new Map([['src/a.ts', new Set([1])]]),
  }), /cannot include findings/);
});

test('accepts an intentional skip without publishing a no-findings verdict', () => {
  assert.deepEqual(validateReview({
    review: {
      head_sha: sha,
      outcome: 'skipped',
      summary: 'This commit was already reviewed.',
      addressed_comment_ids: [],
      findings: [],
    },
    headSha: sha,
    changedLines: new Map(),
    noFindingsSummary: 'No issues found',
  }), { comments: [], body: null, addressedCommentIds: [] });
  assert.throws(() => validateReview({
    review: { head_sha: sha, outcome: 'skipped', summary: null, addressed_comment_ids: [], findings: [] },
    headSha: sha,
    changedLines: new Map(),
  }), /must explain/);
});

test('rejects a skip that also confirms addressed comments', () => {
  assert.throws(() => validateReview({
    review: {
      head_sha: sha,
      outcome: 'skipped',
      summary: 'This commit was already reviewed.',
      addressed_comment_ids: [4021],
      findings: [],
    },
    headSha: sha,
    changedLines: new Map(),
  }), /skipped review cannot confirm addressed comments/);
});

test('rejects whitespace-only finding bodies and accepts nullable optional values', () => {
  assert.throws(() => validateReview({
    review: { head_sha: sha, outcome: 'reviewed', summary: null, addressed_comment_ids: [], findings: [{ path: 'src/a.ts', line: 1, body: ' \n\t ', severity: null }] },
    headSha: sha,
    changedLines: new Map(),
  }), /body/);
  assert.deepEqual(validateReview({
    review: { head_sha: sha, outcome: 'reviewed', summary: null, addressed_comment_ids: [], findings: [] },
    headSha: sha,
    changedLines: new Map(),
  }), { comments: [], body: null, addressedCommentIds: [] });
});

test('deduplicates findings and filters a duplicate summary', () => {
  const files = [{ filename: 'src/a.ts', patch: '@@ -2,2 +2,3 @@\n old\n-line deleted\n+new\n+another\n' }];
  const changed = changedLinesFromFiles(files);
  assert.deepEqual([...changed.get('src/a.ts')], [3, 4]);
  const review = { head_sha: sha, outcome: 'reviewed', summary: 'Handle null.', addressed_comment_ids: [], findings: [
    { path: 'src/a.ts', line: 3, body: 'Handle null.', severity: null },
    { path: 'src/a.ts', line: 3, body: 'Handle null.', severity: null },
  ] };
  assert.deepEqual(validateReview({ review, headSha: sha, changedLines: changed }), {
    comments: [{ path: 'src/a.ts', line: 3, body: 'Handle null.' }], body: null, addressedCommentIds: [],
  });
});

test('does not treat a no-newline marker as a changed line', () => {
  const changed = changedLinesFromFiles([{ filename: 'src/a.ts', patch: '@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file\n' }]);
  assert.deepEqual([...changed.get('src/a.ts')], [1]);
  assert.throws(() => validateReview({
    review: { head_sha: sha, outcome: 'reviewed', summary: null, addressed_comment_ids: [], findings: [{ path: 'src/a.ts', line: 2, body: 'Not in the diff.', severity: null }] },
    headSha: sha,
    changedLines: changed,
  }), /outside the current patch/);
});

test('treats deleted hunk content beginning with two dashes as deletion', () => {
  const changed = changedLinesFromFiles([{
    filename: 'query.sql',
    patch: '@@ -1,3 +1,3 @@\n--- removed SQL comment\n unchanged\n+replacement\n trailing\n',
  }]);
  assert.deepEqual([...changed.get('query.sql')], [2]);
  assert.throws(() => validateReview({
    review: { head_sha: sha, outcome: 'reviewed', summary: null, addressed_comment_ids: [], findings: [
      { path: 'query.sql', line: 2, body: 'Check the replacement.', severity: 'warning' },
      { path: 'query.sql', line: 4, body: 'This line does not exist.', severity: null },
    ] },
    headSha: sha,
    changedLines: changed,
  }), /outside the current patch/);
});

test('loads JSON and posts inline or summary-only reviews against the reviewed commit', async () => {
  assert.deepEqual(loadReview(JSON.stringify({ head_sha: sha, outcome: 'reviewed', summary: null, addressed_comment_ids: [], findings: [] })), { head_sha: sha, outcome: 'reviewed', summary: null, addressed_comment_ids: [], findings: [] });
  assert.throws(() => loadReview('{bad'), /JSON/);
  const calls = [];
  const github = { paginate: async () => [], rest: { pulls: {
    get: async (input) => { calls.push(['get', input]); return { data: { head: { sha } } }; },
    createReview: async (input) => calls.push(['createReview', input]),
  } } };
  assert.equal(await postReview({ github, owner: 'o', repo: 'r', pullNumber: 7, eventHeadSha: sha, reviewedHeadSha: sha, comments: [{ path: 'a', line: 2, body: 'Fix it' }], body: null }), true);
  assert.equal(await postReview({ github, owner: 'o', repo: 'r', pullNumber: 7, eventHeadSha: sha, reviewedHeadSha: sha, comments: [], body: 'summary' }), true);
  assert.deepEqual(calls, [
    ['get', { owner: 'o', repo: 'r', pull_number: 7 }],
    ['createReview', { owner: 'o', repo: 'r', pull_number: 7, commit_id: sha, event: 'COMMENT', body: '', comments: [{ path: 'a', line: 2, side: 'RIGHT', body: 'Fix it' }] }],
    ['get', { owner: 'o', repo: 'r', pull_number: 7 }],
    ['createReview', { owner: 'o', repo: 'r', pull_number: 7, commit_id: sha, event: 'COMMENT', body: 'summary', comments: [] }],
  ]);
});

test('reports no post when there is nothing to publish', async () => {
  const github = { rest: { pulls: { get: async () => assert.fail('an empty review reaches no API call') } } };
  assert.equal(await postReview({ github, owner: 'o', repo: 'r', pullNumber: 7, eventHeadSha: sha, reviewedHeadSha: sha, comments: [], body: null }), false);
});

test('refuses to post when the live PR head differs from the event or reviewed head', async () => {
  for (const heads of [
    { eventHeadSha: 'b'.repeat(40), reviewedHeadSha: sha },
    { eventHeadSha: sha, reviewedHeadSha: 'b'.repeat(40) },
  ]) {
    let posted = false;
    const github = { rest: { pulls: {
      get: async () => ({ data: { head: { sha } } }),
      createReview: async () => { posted = true; },
    } } };
    await assert.rejects(postReview({
      github, owner: 'o', repo: 'r', pullNumber: 7, ...heads,
      comments: [{ path: 'a', line: 2, body: 'Fix it' }], body: null,
    }), /stale PR head SHA/);
    assert.equal(posted, false);
  }
});

test('does not post another review for a commit already reviewed by Actions', async () => {
  let posted = false;
  const github = { paginate: async () => [{ user: { login: 'github-actions[bot]' }, commit_id: sha }], rest: { pulls: {
    get: async () => ({ data: { head: { sha } } }),
    listReviews: async () => assert.fail('paginate supplies existing reviews'),
    createReview: async () => { posted = true; },
  } } };
  assert.equal(await postReview({
    github, owner: 'o', repo: 'r', pullNumber: 7, eventHeadSha: sha, reviewedHeadSha: sha,
    comments: [{ path: 'a', line: 2, body: 'Fix it' }], body: null,
  }), false);
  assert.equal(posted, false);
});

function threeCompletedRounds() {
  const calls = { posted: false };
  const github = {
    paginate: async () => [
      { user: { login: 'github-actions[bot]' }, submitted_at: '2026-08-18T10:00:00Z' },
      { user: { login: 'github-actions[bot]' }, submitted_at: '2026-08-18T10:01:00Z' },
      { user: { login: 'github-actions[bot]' }, submitted_at: '2026-08-18T10:02:00Z' },
    ],
    rest: { pulls: {
      get: async () => ({ data: { head: { sha } } }),
      createReview: async () => { calls.posted = true; },
    } },
  };
  return { github, calls };
}

test('does not post after three completed automated reviews by default', async () => {
  const { github, calls } = threeCompletedRounds();
  assert.equal(await postReview({
    github, owner: 'o', repo: 'r', pullNumber: 7, eventHeadSha: sha, reviewedHeadSha: sha,
    comments: [{ path: 'a', line: 2, body: 'Fix it' }], body: null,
  }), false);
  assert.equal(calls.posted, false);
});

test('honors a raised review round cap', async () => {
  const { github, calls } = threeCompletedRounds();
  await postReview({
    github, owner: 'o', repo: 'r', pullNumber: 7, eventHeadSha: sha, reviewedHeadSha: sha,
    comments: [{ path: 'a', line: 2, body: 'Fix it' }], body: null, maxRounds: 4,
  });
  assert.equal(calls.posted, true);
});

test('rejects an invalid review round cap', async () => {
  for (const maxRounds of [0, -1, 2.5, Number.NaN, '3']) {
    const { github, calls } = threeCompletedRounds();
    await assert.rejects(postReview({
      github, owner: 'o', repo: 'r', pullNumber: 7, eventHeadSha: sha, reviewedHeadSha: sha,
      comments: [{ path: 'a', line: 2, body: 'Fix it' }], body: null, maxRounds,
    }), /positive integer/);
    assert.equal(calls.posted, false);
  }
});

test('ignores malformed review entries during duplicate suppression', async () => {
  let posted = false;
  const github = {
    paginate: async () => [null, { user: { login: 'octocat' } }],
    rest: { pulls: {
      get: async () => ({ data: { head: { sha } } }),
      createReview: async () => { posted = true; },
    } },
  };
  await postReview({
    github, owner: 'o', repo: 'r', pullNumber: 7, eventHeadSha: sha, reviewedHeadSha: sha,
    comments: [{ path: 'a', line: 2, body: 'Fix it' }], body: null,
  });
  assert.equal(posted, true);
});


const OUR_REVIEW_ID = 900;
const ourReviews = [
  { id: OUR_REVIEW_ID, user: { login: 'github-actions[bot]' }, submitted_at: '2026-08-18T10:00:00Z' },
];

function botThread(threadId, commentId, overrides = {}) {
  return {
    id: threadId,
    isResolved: false,
    path: 'src/a.ts',
    line: 4,
    originalLine: null,
    comments: { nodes: [{ databaseId: commentId, author: { login: 'github-actions[bot]' }, pullRequestReview: { databaseId: OUR_REVIEW_ID } }] },
    ...overrides,
  };
}

function rootedIn(threadId, commentId, { login, reviewId }) {
  return botThread(threadId, commentId, {
    comments: { nodes: [{ databaseId: commentId, author: { login }, pullRequestReview: reviewId == null ? null : { databaseId: reviewId } }] },
  });
}

function reviewThreadApi(pages, { reviews = ourReviews, threadError = null, resolveError = null } = {}) {
  const calls = { cursors: [], resolved: [] };
  const github = {
    paginate: async () => reviews,
    rest: { pulls: { listReviews: 'listReviews' } },
    graphql: async (query, params) => {
      if (query.includes('resolveReviewThread')) {
        calls.resolved.push(params.threadId);
        if (resolveError) throw new Error(resolveError);
        return { resolveReviewThread: { thread: { id: params.threadId, isResolved: true } } };
      }
      if (threadError) throw new Error(threadError);
      calls.cursors.push(params.cursor ?? null);
      const index = calls.cursors.length - 1;
      const hasNextPage = index + 1 < pages.length;
      return { repository: { pullRequest: { reviewThreads: {
        pageInfo: { hasNextPage, endCursor: hasNextPage ? `cursor-${index}` : null },
        nodes: pages[index] || [],
      } } } };
    },
  };
  return { github, calls };
}

async function withWarnings(run) {
  const warnings = [];
  const original = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    return { result: await run(), warnings };
  } finally {
    console.warn = original;
  }
}

test('resolves an unresolved thread the round confirmed addressed', async () => {
  const { github, calls } = reviewThreadApi([[botThread('THREAD_1', 4021)]]);
  const resolved = await resolveAddressedThreads({
    github, owner: 'o', repo: 'r', pullNumber: 7, addressedCommentIds: [4021], comments: [],
  });
  assert.deepEqual(resolved, [4021]);
  assert.deepEqual(calls.resolved, ['THREAD_1']);
});

test('reads every page of review threads', async () => {
  const { github, calls } = reviewThreadApi([[botThread('THREAD_1', 1)], [botThread('THREAD_2', 2)]]);
  assert.deepEqual(await resolveAddressedThreads({
    github, owner: 'o', repo: 'r', pullNumber: 7, addressedCommentIds: [2], comments: [],
  }), [2]);
  assert.deepEqual(calls.cursors, [null, 'cursor-0']);
  assert.deepEqual(calls.resolved, ['THREAD_2']);
});

test('reaches no API at all when the round confirmed nothing addressed', async () => {
  const github = { graphql: async () => assert.fail('an empty id list must not query threads') };
  for (const addressedCommentIds of [[], undefined]) {
    assert.deepEqual(await resolveAddressedThreads({ github, owner: 'o', repo: 'r', pullNumber: 7, addressedCommentIds }), []);
  }
});

test('skips a comment id that roots no thread on this pull request', async () => {
  const { github, calls } = reviewThreadApi([[botThread('THREAD_1', 4021)]]);
  const { result, warnings } = await withWarnings(() => resolveAddressedThreads({
    github, owner: 'o', repo: 'r', pullNumber: 7, addressedCommentIds: [9999], comments: [],
  }));
  assert.deepEqual(result, []);
  assert.deepEqual(calls.resolved, []);
  assert.match(warnings.join('\n'), /9999.*roots no review thread/);
});

test('skips a reply comment id, which roots no thread of its own', async () => {
  const { github, calls } = reviewThreadApi([[botThread('THREAD_1', 4021)]]);
  const { warnings } = await withWarnings(() => resolveAddressedThreads({
    github, owner: 'o', repo: 'r', pullNumber: 7, addressedCommentIds: [4022], comments: [],
  }));
  assert.deepEqual(calls.resolved, []);
  assert.match(warnings.join('\n'), /4022.*roots no review thread/);
});

test('skips a thread a human opened', async () => {
  const { github, calls } = reviewThreadApi([[rootedIn('THREAD_1', 4021, { login: 'octocat', reviewId: 901 })]]);
  const { result, warnings } = await withWarnings(() => resolveAddressedThreads({
    github, owner: 'o', repo: 'r', pullNumber: 7, addressedCommentIds: [4021], comments: [],
  }));
  assert.deepEqual(result, []);
  assert.deepEqual(calls.resolved, []);
  assert.match(warnings.join('\n'), /4021.*by octocat rather than in a review this workflow submitted/);
});

// github-actions[bot] is the login of every workflow using GITHUB_TOKEN, so
// the login alone would let a round resolve an unrelated workflow's thread.
test('skips a thread rooted in another workflow posting as the same bot', async () => {
  const { github, calls } = reviewThreadApi([[rootedIn('THREAD_1', 4021, { login: 'github-actions[bot]', reviewId: 777 })]]);
  const { result, warnings } = await withWarnings(() => resolveAddressedThreads({
    github, owner: 'o', repo: 'r', pullNumber: 7, addressedCommentIds: [4021], comments: [],
  }));
  assert.deepEqual(result, []);
  assert.deepEqual(calls.resolved, []);
  assert.match(warnings.join('\n'), /4021.*rather than in a review this workflow submitted/);
});

test('skips a thread rooted in a comment attached to no review', async () => {
  const { github, calls } = reviewThreadApi([[rootedIn('THREAD_1', 4021, { login: 'github-actions[bot]', reviewId: null })]]);
  assert.deepEqual((await withWarnings(() => resolveAddressedThreads({
    github, owner: 'o', repo: 'r', pullNumber: 7, addressedCommentIds: [4021], comments: [],
  }))).result, []);
  assert.deepEqual(calls.resolved, []);
});

test('skips a thread rooted in a pending bot review', async () => {
  const { github, calls } = reviewThreadApi([[botThread('THREAD_1', 4021)]], {
    reviews: [{ id: OUR_REVIEW_ID, user: { login: 'github-actions[bot]' }, submitted_at: null }],
  });
  assert.deepEqual((await withWarnings(() => resolveAddressedThreads({
    github, owner: 'o', repo: 'r', pullNumber: 7, addressedCommentIds: [4021], comments: [],
  }))).result, []);
  assert.deepEqual(calls.resolved, []);
});

test('skips a thread that is already resolved', async () => {
  const { github, calls } = reviewThreadApi([[botThread('THREAD_1', 4021, { isResolved: true })]]);
  const { result, warnings } = await withWarnings(() => resolveAddressedThreads({
    github, owner: 'o', repo: 'r', pullNumber: 7, addressedCommentIds: [4021], comments: [],
  }));
  assert.deepEqual(result, []);
  assert.deepEqual(calls.resolved, []);
  assert.deepEqual(warnings, []);
});

test('keeps a thread open when this round re-filed a finding at its line', async () => {
  for (const thread of [
    botThread('THREAD_1', 4021),
    botThread('THREAD_1', 4021, { line: null, originalLine: 4 }),
  ]) {
    const { github, calls } = reviewThreadApi([[thread]]);
    const { result, warnings } = await withWarnings(() => resolveAddressedThreads({
      github,
      owner: 'o',
      repo: 'r',
      pullNumber: 7,
      addressedCommentIds: [4021],
      comments: [{ path: 'src/a.ts', line: 4, body: 'Still unguarded.' }],
    }));
    assert.deepEqual(result, []);
    assert.deepEqual(calls.resolved, []);
    assert.match(warnings.join('\n'), /re-filed a finding at src\/a\.ts:4/);
  }
});

test('resolves a thread whose line this round did not re-file', async () => {
  const { github, calls } = reviewThreadApi([[botThread('THREAD_1', 4021)]]);
  assert.deepEqual(await resolveAddressedThreads({
    github,
    owner: 'o',
    repo: 'r',
    pullNumber: 7,
    addressedCommentIds: [4021],
    comments: [{ path: 'src/a.ts', line: 9, body: 'A different line.' }, { path: 'src/b.ts', line: 4, body: 'A different file.' }],
  }), [4021]);
  assert.deepEqual(calls.resolved, ['THREAD_1']);
});

test('resolves each confirmed thread once', async () => {
  const { github, calls } = reviewThreadApi([[botThread('THREAD_1', 4021), botThread('THREAD_2', 4022, { line: 9 })]]);
  assert.deepEqual(await resolveAddressedThreads({
    github, owner: 'o', repo: 'r', pullNumber: 7, addressedCommentIds: [4021, 4022, 4021], comments: [],
  }), [4021, 4022]);
  assert.deepEqual(calls.resolved, ['THREAD_1', 'THREAD_2']);
});

test('tolerates a thread page the API could not return', async () => {
  const { github, calls } = reviewThreadApi([]);
  github.graphql = async () => ({ repository: null });
  const { result, warnings } = await withWarnings(() => resolveAddressedThreads({
    github, owner: 'o', repo: 'r', pullNumber: 7, addressedCommentIds: [4021], comments: [],
  }));
  assert.deepEqual(result, []);
  assert.deepEqual(calls.resolved, []);
  assert.match(warnings.join('\n'), /4021.*roots no review thread/);
});

// The review is already published when this runs, so a GraphQL failure must
// not fail post-review and the aggregate check with it.
test('resolves nothing when reading the threads fails', async () => {
  const { github, calls } = reviewThreadApi([[botThread('THREAD_1', 4021)]], { threadError: 'API rate limit exceeded' });
  const { result, warnings } = await withWarnings(() => resolveAddressedThreads({
    github, owner: 'o', repo: 'r', pullNumber: 7, addressedCommentIds: [4021], comments: [],
  }));
  assert.deepEqual(result, []);
  assert.deepEqual(calls.resolved, []);
  assert.match(warnings.join('\n'), /reading the review threads.*#7 failed.*API rate limit exceeded/);
});

test('resolves nothing when listing the reviews fails', async () => {
  const { github } = reviewThreadApi([[botThread('THREAD_1', 4021)]]);
  github.paginate = async () => { throw new Error('Bad credentials'); };
  const { result, warnings } = await withWarnings(() => resolveAddressedThreads({
    github, owner: 'o', repo: 'r', pullNumber: 7, addressedCommentIds: [4021], comments: [],
  }));
  assert.deepEqual(result, []);
  assert.match(warnings.join('\n'), /reading the review threads.*Bad credentials/);
});

test('keeps going when one thread refuses to resolve', async () => {
  const { github, calls } = reviewThreadApi(
    [[botThread('THREAD_1', 4021), botThread('THREAD_2', 4022, { line: 9 })]],
    { resolveError: 'Resource not accessible by integration' },
  );
  const { result, warnings } = await withWarnings(() => resolveAddressedThreads({
    github, owner: 'o', repo: 'r', pullNumber: 7, addressedCommentIds: [4021, 4022], comments: [],
  }));
  assert.deepEqual(result, []);
  assert.deepEqual(calls.resolved, ['THREAD_1', 'THREAD_2'], 'a refused thread must not stop the ones after it');
  assert.match(warnings.join('\n'), /4021: resolving its thread failed.*Resource not accessible/);
  assert.match(warnings.join('\n'), /4022: resolving its thread failed/);
});
