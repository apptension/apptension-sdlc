'use strict';

const SHA = /^[0-9a-f]{40}$/i;
const SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'error', 'warning', 'notice', 'info']);
const OUTCOMES = new Set(['reviewed', 'skipped', 'failed']);
const LIMITS = { findings: 50, addressed: 50, path: 1000, body: 10000, summary: 20000 };
const REVIEW_AUTHOR = 'github-actions[bot]';

const REVIEW_THREAD_PAGE = `query($owner: String!, $repo: String!, $pullNumber: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pullNumber) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          path
          line
          originalLine
          comments(first: 1) { nodes { databaseId author { login } pullRequestReview { databaseId } } }
        }
      }
    }
  }
}`;
const RESOLVE_REVIEW_THREAD = `mutation($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) { thread { id isResolved } }
}`;

function assertKeys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${label} has unknown key "${key}".`);
}
function assertRequired(value, required, label) {
  for (const key of required) if (!Object.hasOwn(value, key)) throw new Error(`${label} ${key} is required.`);
}
function stringField(value, name, max, { trim = false } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || (trim && value.trim().length === 0)) throw new Error(`${name} must be a non-empty string of at most ${max} characters.`);
}
function validateShape(review) {
  if (!review || typeof review !== 'object' || Array.isArray(review)) throw new Error('Review must be an object.');
  assertKeys(review, new Set(['head_sha', 'outcome', 'findings', 'addressed_comment_ids', 'summary']), 'Review');
  assertRequired(review, ['head_sha', 'outcome', 'findings', 'addressed_comment_ids', 'summary'], 'Review');
  if (review.head_sha !== null && (typeof review.head_sha !== 'string' || !SHA.test(review.head_sha))) throw new Error('head_sha must be a 40-character hexadecimal SHA or null.');
  if (!OUTCOMES.has(review.outcome)) throw new Error('outcome is invalid.');
  if (!Array.isArray(review.findings)) throw new Error('findings must be an array.');
  if (review.findings.length > LIMITS.findings) throw new Error(`findings must contain at most ${LIMITS.findings} items.`);
  if (!Array.isArray(review.addressed_comment_ids)) throw new Error('addressed_comment_ids must be an array.');
  if (review.addressed_comment_ids.length > LIMITS.addressed) throw new Error(`addressed_comment_ids must contain at most ${LIMITS.addressed} items.`);
  for (const id of review.addressed_comment_ids) if (!Number.isInteger(id) || id <= 0) throw new Error('Each addressed comment id must be a positive integer.');
  if (review.summary !== null) stringField(review.summary, 'summary', LIMITS.summary);
  for (const finding of review.findings) {
    if (!finding || typeof finding !== 'object' || Array.isArray(finding)) throw new Error('Each finding must be an object.');
    assertKeys(finding, new Set(['path', 'line', 'body', 'severity']), 'Finding');
    assertRequired(finding, ['path', 'line', 'body', 'severity'], 'Finding');
    stringField(finding.path, 'path', LIMITS.path);
    if (!Number.isInteger(finding.line) || finding.line <= 0) throw new Error('line must be a positive integer.');
    stringField(finding.body, 'body', LIMITS.body, { trim: true });
    if (finding.severity !== null && !SEVERITIES.has(finding.severity)) throw new Error('severity is invalid.');
  }
}
function validateReview({ review, headSha, changedLines, noFindingsSummary = null }) {
  validateShape(review);
  const modelSummary = review.summary?.trim() || null;
  if (review.outcome === 'failed') {
    if (review.findings.length > 0) throw new Error('A failed review cannot include findings.');
    if (!modelSummary) throw new Error('A failed review must explain why it could not be completed.');
    throw new Error(`Automated review failed: ${modelSummary}`);
  }
  if (typeof headSha !== 'string' || !SHA.test(headSha)) throw new Error('headSha must be a 40-character hexadecimal SHA.');
  if (typeof review.head_sha !== 'string') throw new Error('A reviewed or skipped result requires head_sha.');
  if (review.head_sha !== headSha) throw new Error('Review output targets a stale PR head SHA.');
  if (!(changedLines instanceof Map)) throw new Error('changedLines must be a Map.');
  if (review.outcome === 'skipped') {
    if (review.findings.length > 0) throw new Error('A skipped review cannot include findings.');
    if (review.addressed_comment_ids.length > 0) throw new Error('A skipped review cannot confirm addressed comments.');
    if (!modelSummary) throw new Error('A skipped review must explain why it was skipped.');
    return { comments: [], body: null, addressedCommentIds: [] };
  }
  const seen = new Set(); const comments = [];
  for (const finding of review.findings) {
    const key = `${finding.path}\u0000${finding.line}\u0000${finding.body}`;
    if (seen.has(key)) continue;
    if (!changedLines.get(finding.path)?.has(finding.line)) {
      throw new Error(`Finding targets a line outside the current patch: ${finding.path}:${finding.line}.`);
    }
    seen.add(key); comments.push({ path: finding.path, line: finding.line, body: finding.body });
  }
  const summary = comments.length > 0 ? modelSummary : (modelSummary || noFindingsSummary);
  return {
    comments,
    body: summary && !comments.some(({ body }) => body === summary) ? summary : null,
    addressedCommentIds: [...new Set(review.addressed_comment_ids)],
  };
}
function loadReview(input) { try { return typeof input === 'string' ? JSON.parse(input) : input; } catch (error) { throw new Error(`Invalid review JSON: ${error.message}`); } }
function changedLinesFromFiles(files) {
  const changed = new Map();
  for (const file of files || []) {
    if (!file || typeof file.filename !== 'string' || typeof file.patch !== 'string') continue;
    const lines = new Set(); let newLine = 0; let inHunk = false;
    for (const line of file.patch.split('\n')) {
      if (line === '' || line === '\\ No newline at end of file') continue;
      const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunk) { newLine = Number(hunk[1]); inHunk = true; continue; }
      if (!inHunk) continue;
      if (line.startsWith('+')) { lines.add(newLine++); continue; }
      if (line.startsWith('-')) continue;
      if (line.startsWith(' ')) newLine++;
    }
    changed.set(file.filename, lines);
  }
  return changed;
}
function automatedReviews(reviews, author = REVIEW_AUTHOR) {
  if (!Array.isArray(reviews)) return [];
  return reviews.filter((review) => review?.user?.login === author && review?.submitted_at != null);
}
function countAutomatedReviews(reviews, author = REVIEW_AUTHOR) {
  return automatedReviews(reviews, author).length;
}
async function postReview({ github, owner, repo, pullNumber, eventHeadSha, reviewedHeadSha, comments, body, maxRounds = 3 }) {
  if (!Number.isInteger(maxRounds) || maxRounds <= 0) throw new Error('maxRounds must be a positive integer.');
  if (comments.length === 0 && !body) return false;
  const { data: pull } = await github.rest.pulls.get({ owner, repo, pull_number: pullNumber });
  if (pull?.head?.sha !== eventHeadSha || pull.head.sha !== reviewedHeadSha) throw new Error('Refusing to post review: stale PR head SHA.');
  const reviews = await github.paginate(github.rest.pulls.listReviews, { owner, repo, pull_number: pullNumber, per_page: 100 });
  if (countAutomatedReviews(reviews) >= maxRounds) return false;
  if (reviews.some((review) => review?.user?.login === REVIEW_AUTHOR && review.commit_id === reviewedHeadSha)) return false;
  await github.rest.pulls.createReview({ owner, repo, pull_number: pullNumber, commit_id: reviewedHeadSha, event: 'COMMENT', body: body || '', comments: comments.map(({ path, line, body: commentBody }) => ({ path, line, side: 'RIGHT', body: commentBody })) });
  return true;
}
async function fetchReviewThreads({ github, owner, repo, pullNumber }) {
  const threads = []; let cursor = null;
  for (;;) {
    const page = (await github.graphql(REVIEW_THREAD_PAGE, { owner, repo, pullNumber, cursor }))?.repository?.pullRequest?.reviewThreads;
    if (!page) break;
    for (const thread of page.nodes || []) if (thread?.id) threads.push(thread);
    if (!page.pageInfo?.hasNextPage || !page.pageInfo.endCursor) break;
    cursor = page.pageInfo.endCursor;
  }
  return threads;
}
// Threads keyed by the REST id of the comment rooting each one, carrying
// whether that comment belongs to a review this workflow submitted. The
// review set is the one the round cap already counts, so "our own review"
// has a single definition across the publisher.
async function threadsByRootComment({ github, owner, repo, pullNumber }) {
  const reviews = await github.paginate(github.rest.pulls.listReviews, { owner, repo, pull_number: pullNumber, per_page: 100 });
  const ourReviewIds = new Set(automatedReviews(reviews).map(({ id }) => id).filter((id) => Number.isInteger(id)));
  const roots = new Map();
  for (const thread of await fetchReviewThreads({ github, owner, repo, pullNumber })) {
    const root = thread.comments?.nodes?.[0];
    if (!Number.isInteger(root?.databaseId)) continue;
    roots.set(root.databaseId, {
      thread,
      author: root.author?.login,
      ours: ourReviewIds.has(root.pullRequestReview?.databaseId),
    });
  }
  return roots;
}
// A round names an addressed thread by the REST id of the comment rooting
// it, so nothing in the untrusted output resolves anything by itself. Every
// check runs here, in the only job holding write scope: an invented id roots
// no thread, a thread that does not root in one of this workflow's own
// submitted reviews is refused, and a finding this round re-filed keeps its
// thread open however the prompt was answered. Nothing in here throws: the
// review is already published by this point, so neither a bad id nor a
// GraphQL failure is worth turning post-review red.
async function resolveAddressedThreads({ github, owner, repo, pullNumber, addressedCommentIds, comments = [] }) {
  const ids = [...new Set(addressedCommentIds || [])];
  if (ids.length === 0) return [];
  let roots;
  try {
    roots = await threadsByRootComment({ github, owner, repo, pullNumber });
  } catch (error) {
    console.warn(`Resolving no threads: reading the review threads of pull request #${pullNumber} failed (${error.message}).`);
    return [];
  }
  const refiled = new Set(comments.map(({ path, line }) => `${path} ${line}`));
  const resolved = [];
  for (const id of ids) {
    const entry = roots.get(id);
    if (!entry) { console.warn(`Skipping comment ${id}: it roots no review thread on pull request #${pullNumber}.`); continue; }
    const { thread, author, ours } = entry;
    if (!ours) { console.warn(`Skipping comment ${id}: its thread roots in a comment by ${author || 'an unknown author'} rather than in a review this workflow submitted.`); continue; }
    if (thread.isResolved) continue;
    const refiledLine = [thread.line, thread.originalLine].find((line) => line != null && refiled.has(`${thread.path} ${line}`));
    if (refiledLine != null) { console.warn(`Skipping comment ${id}: this round re-filed a finding at ${thread.path}:${refiledLine}.`); continue; }
    try {
      await github.graphql(RESOLVE_REVIEW_THREAD, { threadId: thread.id });
    } catch (error) {
      console.warn(`Skipping comment ${id}: resolving its thread failed (${error.message}).`);
      continue;
    }
    resolved.push(id);
  }
  return resolved;
}
module.exports = { validateReview, loadReview, changedLinesFromFiles, countAutomatedReviews, postReview, resolveAddressedThreads };
