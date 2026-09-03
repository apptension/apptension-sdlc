'use strict';

const SHA = /^[0-9a-f]{40}$/i;
const SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'error', 'warning', 'notice', 'info']);
const OUTCOMES = new Set(['reviewed', 'skipped', 'failed']);
const LIMITS = { findings: 50, path: 1000, body: 10000, summary: 20000 };

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
  assertKeys(review, new Set(['head_sha', 'outcome', 'findings', 'summary']), 'Review');
  assertRequired(review, ['head_sha', 'outcome', 'findings', 'summary'], 'Review');
  if (review.head_sha !== null && (typeof review.head_sha !== 'string' || !SHA.test(review.head_sha))) throw new Error('head_sha must be a 40-character hexadecimal SHA or null.');
  if (!OUTCOMES.has(review.outcome)) throw new Error('outcome is invalid.');
  if (!Array.isArray(review.findings)) throw new Error('findings must be an array.');
  if (review.findings.length > LIMITS.findings) throw new Error(`findings must contain at most ${LIMITS.findings} items.`);
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
    if (!modelSummary) throw new Error('A skipped review must explain why it was skipped.');
    return { comments: [], body: null };
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
  return { comments, body: summary && !comments.some(({ body }) => body === summary) ? summary : null };
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
function countAutomatedReviews(reviews, author = 'github-actions[bot]') {
  if (!Array.isArray(reviews)) return 0;
  return reviews.filter((review) => review?.user?.login === author && review?.submitted_at != null).length;
}
async function postReview({ github, owner, repo, pullNumber, eventHeadSha, reviewedHeadSha, comments, body, maxRounds = 3 }) {
  if (!Number.isInteger(maxRounds) || maxRounds <= 0) throw new Error('maxRounds must be a positive integer.');
  if (comments.length === 0 && !body) return;
  const { data: pull } = await github.rest.pulls.get({ owner, repo, pull_number: pullNumber });
  if (pull?.head?.sha !== eventHeadSha || pull.head.sha !== reviewedHeadSha) throw new Error('Refusing to post review: stale PR head SHA.');
  const reviews = await github.paginate(github.rest.pulls.listReviews, { owner, repo, pull_number: pullNumber, per_page: 100 });
  if (countAutomatedReviews(reviews) >= maxRounds) return;
  if (reviews.some((review) => review?.user?.login === 'github-actions[bot]' && review.commit_id === reviewedHeadSha)) return;
  await github.rest.pulls.createReview({ owner, repo, pull_number: pullNumber, commit_id: reviewedHeadSha, event: 'COMMENT', body: body || '', comments: comments.map(({ path, line, body: commentBody }) => ({ path, line, side: 'RIGHT', body: commentBody })) });
}
module.exports = { validateReview, loadReview, changedLinesFromFiles, countAutomatedReviews, postReview };
