const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.join(__dirname, '..', 'workflows', 'automated-code-review.yml');
const legacyWorkflowPath = path.join(__dirname, '..', 'workflows', 'claude-code-review.yml');
const schemaPath = path.join(__dirname, '..', 'schemas', 'review-findings.schema.json');

function assertCodexEnvironment(prompt) {
  assert.match(prompt, /read-only sandbox/i);
  assert.match(prompt, /`\/tmp`/);
  assert.match(prompt, /`\/var\/tmp`/);
  assert.match(prompt, /`\/usr\/tmp`/);
  assert.match(prompt, /unwritable/i);
  assert.match(prompt, /`pytest` and `uv`[\s\S]*exit 127/i);
  assert.match(prompt, /npm run <script>.*node_modules.*tsx: not found/is);
  assert.match(prompt, /python -m unittest.*No usable temporary directory/is);
  assert.match(prompt, /do not repeatedly probe.*python.*suite/is);
  assert.match(prompt, /node --test/);
  assert.match(prompt, /python 3\.12\.3.*node\s+v24\.19\.0.*npm 11\.17\.0/is);
  assert.match(prompt, /git.*rg.*sed.*nl.*jq.*find.*yamllint.*python -c.*compile/is);
}

function job(source, name) {
  const match = source.match(new RegExp(`^  ${name}:\\n[\\s\\S]*?(?=^  [\\w-]+:\\n|(?![\\s\\S]))`, 'm'));
  assert.ok(match, `expected ${name} job`);
  return match[0];
}

test('automated review workflow keeps its round cap, provider, permission, and completion contract', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.equal(fs.existsSync(legacyWorkflowPath), false, 'the legacy independent Claude review workflow must not run beside the selector');
  assert.match(workflow, /^name: Automated Code Review$/m);
  assert.match(workflow, /pull_request_target:\n(?:[^\n]*\n)*?    types: \[opened, synchronize, reopened\]/);
  assert.match(workflow, /concurrency:\n  group: automated-code-review-pr-\$\{\{ github\.event\.pull_request\.number \}\}\n  cancel-in-progress: true/);
  assert.match(workflow, /AUTOMATED_REVIEWER: \$\{\{ vars\.AUTOMATED_REVIEWER \}\}/);
  assert.match(workflow, /openai\/codex-action@[0-9a-f]{40} {2}# v[0-9.]+\n/, 'codex-action must be pinned to a commit SHA, not a floating tag (openai/codex-action#150)');
  assert.match(workflow, /sandbox: read-only/);
  assert.match(workflow, /safety-strategy: drop-sudo/, 'Codex must not retain sudo access to the API-key proxy process');

  const round = job(workflow, 'review-round');
  assert.match(round, /permissions:\n      pull-requests: read/);
  assert.doesNotMatch(round, /pull-requests: write/);
  assert.match(round, /outputs:\n      can_review: \$\{\{ steps\.review-round\.outputs\.can_review \}\}/);
  assert.match(round, /codex_timeout: \$\{\{ steps\.review-round\.outputs\.codex_timeout \}\}/);
  assert.match(round, /codex_job_timeout: \$\{\{ steps\.review-round\.outputs\.codex_job_timeout \}\}/);
  assert.match(round, /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.match(round, /HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(round, /gh api --paginate "\/repos\/\$GITHUB_REPOSITORY\/pulls\/\$PR_NUMBER\/reviews" --jq '[^\n]*' \| wc -l/);
  assert.doesNotMatch(round, /--slurp[\s\S]*--jq/, 'gh api does not support combining --slurp with --jq');
  assert.match(round, /select\(\.user\.login == "github-actions\[bot\]"\)/);
  assert.match(round, /select\(\.submitted_at != null\)/, 'pending bot reviews must not exhaust the cap');
  assert.match(round, /select\(\.commit_id == \\\"\$HEAD_SHA\\\"\)/, 'a submitted review on this head must suppress the provider before it runs');
  assert.match(round, /same_head_count" -gt 0/);
  assert.match(round, /review_count" -lt "\$MAX_ROUNDS"/);
  assert.match(round, /MAX_ROUNDS: \$\{\{ vars\.AUTOMATED_REVIEW_ROUNDS \|\| 3 \}\}/);
  assert.match(round, /CODEX_TIMEOUT: \$\{\{ vars\.CODEX_REVIEW_TIMEOUT_MINUTES \|\| 12 \}\}/);
  assert.match(round, /CODEX_REVIEW_TIMEOUT_MINUTES must be a positive integer/);
  assert.match(round, /CODEX_REVIEW_TIMEOUT_MINUTES must not exceed 352/);
  assert.match(round, /codex_job_timeout=\$\(\(CODEX_TIMEOUT \+ 8\)\)/);
  assert.match(round, /must be a positive integer/, 'a malformed cap variable must fail closed');
  assert.match(round, /can_review=true/);
  assert.match(round, /can_review=false/);
  assert.doesNotMatch(round, /vars\.(?!(?:AUTOMATED_REVIEW_ROUNDS|CODEX_REVIEW_TIMEOUT_MINUTES))/, 'the trusted guard reads only the cap and Codex timeout variables');

  const claude = job(workflow, 'claude-review');
  assert.match(claude, /needs: \[validate-provider, review-round\]/);
  assert.doesNotMatch(claude, /wait-for-ci/);
  assert.match(claude, /needs\.review-round\.outputs\.can_review == 'true'/);
  assert.match(claude, /permissions:\n      contents: read/);
  assert.match(claude, /pull-requests: read/);
  assert.doesNotMatch(claude, /pull-requests: write/);
  assert.match(claude, /github_token: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.doesNotMatch(claude, /id-token: write/, 'the Claude job authenticates with GITHUB_TOKEN, not the OIDC app-token exchange, which rejects pull_request_target tokens');
  assert.match(claude, /anthropic_api_key: \$\{\{ secrets\.ANTHROPIC_API_KEY \}\}/);
  assert.equal((workflow.match(/ANTHROPIC_API_KEY/g) || []).length, 1, 'only the Claude job may reference ANTHROPIC_API_KEY');
  assert.equal((workflow.match(/secrets\.GITHUB_TOKEN/g) || []).length, 7, 'only the read-only round guard, wait-for-ci, and provider context fetches use secrets.GITHUB_TOKEN');
  assert.match(claude, /ref: refs\/pull\/\$\{\{ github\.event\.pull_request\.number \}\}\/merge/);
  assert.match(claude, /fetch-depth: 0/);
  assert.match(claude, /persist-credentials: false/);
  assert.match(claude, /name: Verify Claude can read pull request data/);
  assert.match(claude, /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.match(claude, /gh pr view "\$PR_NUMBER" --repo "\$GITHUB_REPOSITORY" --json headRefOid,state/);
  assert.match(claude, /name: Fetch prior automated review context/);
  assert.match(claude, /gh api --paginate "\/repos\/\$GITHUB_REPOSITORY\/pulls\/\$PR_NUMBER\/reviews" --jq '\.\[\]' > \.review-context\/prior-review-bodies\.jsonl/);
  assert.match(claude, /gh api --paginate "\/repos\/\$GITHUB_REPOSITORY\/pulls\/\$PR_NUMBER\/comments" --jq '\.\[\]' > \.review-context\/prior-inline-comments\.jsonl/);
  assert.match(claude, /PR_AUTHOR: \$\{\{ github\.event\.pull_request\.user\.login \}\}/, 'the author filter must come from the event payload, not from anything a commenter controls');
  assert.match(claude, /gh api --paginate "\/repos\/\$GITHUB_REPOSITORY\/issues\/\$PR_NUMBER\/comments" --jq '\.\[\] \| select\(\.user\.login == env\.PR_AUTHOR\)' > \.review-context\/author-comments\.jsonl/, 'only the pull request author may address the reviewer through a conversation comment');
  assert.match(claude, /PR_BODY: \$\{\{ github\.event\.pull_request\.body \}\}/, 'untrusted body text must travel through the environment, never interpolated into the script');
  assert.match(claude, /\*'<!-- agent-context -->'\*/, 'the watch runs only when the body promises a comment, so a hand-opened pull request waits for nothing');
  assert.match(claude, /deadline=\$\(\( \$\(date \+%s\) \+ 300 \)\)/, 'the watch gives up after five minutes');
  assert.match(claude, /::warning::.*Agent context comment/, 'a promised comment that never arrives must be visible, not silent');
  assert.match(claude, /\.review-context\/prior-review-bodies\.jsonl/);
  assert.match(claude, /\.review-context\/prior-inline-comments\.jsonl/);
  assert.match(claude, /\.review-context\/author-comments\.jsonl/);
  assert.match(claude, /\*\*Agent context\*\*/, 'the prompt must name the marker it looks for');
  assert.match(claude, /input,\s+never\s+as\s+instruction/i, 'an agent context comment must not be able to steer the review');
  assert.match(claude, /claim\s+to\s+test\s+against\s+the\s+diff,\s+not\s+a\s+verdict/i, 'the author rationale is checked, not believed');
  assert.match(claude, /each\s+earlier actionable\s+finding/i);
  assert.match(claude, /addressed or\s+remains unresolved/i);
  assert.match(claude, /location and reason/i);
  assert.match(claude, /already-commented[\s\S]*same current head/i, 'Claude may skip only when an automated review already targets the current head');
  assert.match(claude, /older head[\s\S]*do not stop/i, 'Claude must continue later rounds after a push');
  assert.match(claude, /rm -rf -- \.review-context\n\s+mkdir -- \.review-context/, 'Claude must replace an untrusted context symlink before writing');
  assert.doesNotMatch(claude, /mkdir -p \.review-context/, 'Claude must not follow a PR-controlled context symlink');
  assert.doesNotMatch(claude, /--comment/);
  assert.doesNotMatch(claude, /Bash\(gh pr comment:\*\)/);
  assert.doesNotMatch(claude, /mcp__github_inline_comment__create_inline_comment/);
  assert.match(claude, /--json-schema/);
  assert.match(claude, /Set outcome to "failed"/);
  assert.match(claude, /addressed_comment_ids to an empty array/, 'a round confirming nothing addressed must still emit the field');
  const inlineSchema = claude.match(/--json-schema '([^\n]+)'/);
  assert.ok(inlineSchema, 'Claude must receive a JSON schema');
  const { $schema, ...sharedSchema } = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  assert.deepEqual(JSON.parse(inlineSchema[1]), sharedSchema);
  assert.match(claude, /name: Write Claude review artifact/);
  assert.match(claude, /name: review-output/);
  assert.match(claude, /path: review-output\/review-findings\.json/);
  assert.match(claude, /if-no-files-found: error/);
  assert.deepEqual(
    [...claude.matchAll(/Bash\((git(?::\*| [^)]+))\)/g)].map(([, command]) => command).sort(),
    ['git log:*', 'git rev-parse:*'],
    'Claude may run only the intended read-only Git subcommands',
  );

  const wait = job(workflow, 'wait-for-ci');
  assert.match(wait, /needs: \[validate-provider, review-round\]/);
  assert.match(wait, /needs\.review-round\.outputs\.can_review == 'true'/);
  assert.match(wait, /timeout-minutes: 20/);
  assert.match(wait, /permissions:\n      actions: read/);
  assert.match(wait, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(wait, /persist-credentials: false/);
  assert.match(wait, /HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(wait, /%%FETCH_SCRIPT%%\.%%EXT%%/);
  assert.match(wait, /--wait/);
  assert.match(wait, /--head-sha "\$HEAD_SHA"/);
  assert.doesNotMatch(wait, /--out /);
  assert.doesNotMatch(wait, /docs\.yml/);

  const codex = job(workflow, 'codex-review');
  assert.match(codex, /needs: \[validate-provider, review-round, wait-for-ci\]/);
  assert.match(codex, /needs\.review-round\.outputs\.can_review == 'true'/);
  assert.match(codex, /permissions:\n      actions: read\n      contents: read\n      pull-requests: read/);
  assert.doesNotMatch(codex, /pull-requests: write/);
  assert.match(codex, /issues: read/, 'reading the author conversation comments needs the issues scope, because a pull request comment is an issue comment');
  assert.match(codex, /openai-api-key: \$\{\{ secrets\.OPENAI_API_KEY \}\}/);
  assert.match(codex, /safety-strategy: drop-sudo/);
  assert.equal((workflow.match(/OPENAI_API_KEY/g) || []).length, 1, 'only the Codex job may reference OPENAI_API_KEY');
  assert.doesNotMatch(codex, /allow-bots: true/);
  assert.match(codex, /allow-bot-users: 'claude\[bot\]'/);
  assert.match(codex, /allow-users: '\*'/);
  assert.match(codex, /ref: refs\/pull\/\$\{\{ github\.event\.pull_request\.number \}\}\/merge/);
  assert.match(codex, /fetch-depth: 0/);
  assert.match(codex, /persist-credentials: false/);
  assert.match(codex, /path: pull-request/);
  assert.match(codex, /name: Fetch prior automated review context/);
  assert.match(codex, /gh api --paginate "\/repos\/\$GITHUB_REPOSITORY\/pulls\/\$PR_NUMBER\/reviews" --jq '\.\[\]' > pull-request\/\.review-context\/prior-review-bodies\.jsonl/);
  assert.match(codex, /gh api --paginate "\/repos\/\$GITHUB_REPOSITORY\/pulls\/\$PR_NUMBER\/comments" --jq '\.\[\]' > pull-request\/\.review-context\/prior-inline-comments\.jsonl/);
  assert.match(codex, /PR_AUTHOR: \$\{\{ github\.event\.pull_request\.user\.login \}\}/, 'the author filter must come from the event payload, not from anything a commenter controls');
  assert.match(codex, /gh api --paginate "\/repos\/\$GITHUB_REPOSITORY\/issues\/\$PR_NUMBER\/comments" --jq '\.\[\] \| select\(\.user\.login == env\.PR_AUTHOR\)' > pull-request\/\.review-context\/author-comments\.jsonl/, 'only the pull request author may address the reviewer through a conversation comment');
  assert.match(codex, /PR_BODY: \$\{\{ github\.event\.pull_request\.body \}\}/, 'untrusted body text must travel through the environment, never interpolated into the script');
  assert.match(codex, /\*'<!-- agent-context -->'\*/, 'the watch runs only when the body promises a comment, so a hand-opened pull request waits for nothing');
  assert.match(codex, /deadline=\$\(\( \$\(date \+%s\) \+ 300 \)\)/, 'the watch gives up after five minutes');
  assert.match(codex, /::warning::.*Agent context comment/, 'a promised comment that never arrives must be visible, not silent');
  assert.match(codex, /rm -rf -- pull-request\/\.review-context\n\s+mkdir -- pull-request\/\.review-context/, 'Codex must replace an untrusted context symlink before writing');
  assert.doesNotMatch(codex, /mkdir -p pull-request\/\.review-context/, 'Codex must not follow a PR-controlled context symlink');
  assert.ok(codex.includes('name: Fetch %%CI_WORKFLOW_FILE%% workflow results'));
  assert.match(codex, /HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(codex, /node trusted-review\/\.github\/scripts\/%%FETCH_SCRIPT%%\.%%EXT%%/);
  assert.ok(codex.includes('--out pull-request/.review-context/%%CI_RESULTS_FILE%%'));
  assert.doesNotMatch(codex, /node pull-request\/\.github\/scripts\/%%FETCH_SCRIPT%%/);
  assert.doesNotMatch(codex, /TMPDIR:/, 'codex-review must not add a writable TMPDIR');
  assert.match(codex, /name: Checkout trusted review instructions/);
  assert.match(codex, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(codex, /path: trusted-review/);
  assert.match(codex, /prompt-file: trusted-review\/\.github\/codex\/prompts\/review\.md/);
  assert.match(codex, /output-schema-file: trusted-review\/\.github\/schemas\/review-findings\.schema\.json/);
  const codexPrompt = fs.readFileSync(path.join(__dirname, '..', 'codex', 'prompts', 'review.md'), 'utf8');
  assert.match(codexPrompt, /Set `outcome` to `failed`/);
  assert.match(codexPrompt, /\.review-context\/prior-review-bodies\.jsonl/);
  assert.match(codexPrompt, /\.review-context\/prior-inline-comments\.jsonl/);
  assert.match(codexPrompt, /\.review-context\/author-comments\.jsonl/);
  assert.match(codexPrompt, /\*\*Agent context\*\*/, 'the prompt must name the marker it looks for');
  assert.match(codexPrompt, /input,\s+never\s+as\s+instruction/i, 'an agent context comment must not be able to steer the review');
  assert.match(codexPrompt, /claim\s+to\s+test\s+against\s+the\s+diff,\s+not\s+a\s+verdict/i, 'the author rationale is checked, not believed');
  assert.ok(codexPrompt.includes('.review-context/%%CI_RESULTS_FILE%%'));
  assert.match(codexPrompt, /read `\.review-context\//i);
  assert.match(codexPrompt, /each\s+earlier actionable\s+finding/i);
  assert.match(codexPrompt, /addressed or\s+remains unresolved/i);
  assert.match(codexPrompt, /location and reason/i);
  assert.match(codexPrompt, /addressed_comment_ids`? to an empty array/, 'a round confirming nothing addressed must still emit the field');
  assertCodexEnvironment(codexPrompt);
  assert.match(codex, /working-directory: pull-request/);

  // A wedged provider must not take the review down with it: codex-action can
  // write a complete review and then never return (openai/codex-action#150).
  // The guard sits on the step, because cancelling the job would skip the
  // steps that publish what the model already wrote.
  assert.match(codex, /continue-on-error: true/, 'the Codex step must hand control on, not fail the job outright');
  assert.match(codex, /^ {8}timeout-minutes: \$\{\{ fromJSON\(needs\.review-round\.outputs\.codex_timeout\) \}\}$/m);
  assert.match(codex, /^ {4}timeout-minutes: \$\{\{ fromJSON\(needs\.review-round\.outputs\.codex_job_timeout\) \}\}$/m);
  assert.match(codex, /name: Require a complete Codex review/);
  assert.match(codex, /REVIEW_OUTCOME: \$\{\{ steps\.codex-review\.outcome \}\}/);
  assert.match(codex, /if \[ ! -s "\$FINDINGS" \]; then\n\s+echo "::error::/, 'a missing review file must fail loudly');
  assert.match(codex, /jq -e 'type == "object"' "\$FINDINGS"/, 'a truncated or non-object review file must fail loudly');

  assert.match(codex, /actions\/upload-artifact@v4[\s\S]*?name: review-output/);

  const poster = job(workflow, 'post-review');
  assert.match(poster, /if: \$\{\{ always\(\) &&/);
  assert.match(poster, /needs: \[validate-provider, review-round, claude-review, codex-review\]/);
  assert.match(poster, /needs\.review-round\.outputs\.can_review == 'false'/);
  assert.match(poster, /if: needs\.review-round\.outputs\.can_review == 'true'/);
  assert.match(poster, /timeout-minutes: 5/);
  assert.match(poster, /permissions:\n      contents: read\n      pull-requests: write/);
  assert.equal((workflow.match(/pull-requests: write/g) || []).length, 1, 'post-review is the sole write-scoped job');
  assert.match(poster, /name: Checkout trusted validator/);
  assert.match(poster, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.doesNotMatch(poster, /refs\/pull\/\$\{\{ github\.event\.pull_request\.number \}\}\/merge/);
  assert.match(poster, /actions\/download-artifact@v4[\s\S]*?name: review-output/);
  assert.match(poster, /actions\/github-script@v7/);
  assert.match(poster, /require\('\.\/\.github\/scripts\/automated-review\.%%EXT%%'\)/);
  assert.doesNotMatch(poster, /codex-review\.js/);
  assert.match(poster, /PROVIDER: \$\{\{ needs\.validate-provider\.outputs\.provider \}\}/);
  assert.match(poster, /github\.paginate\(github\.rest\.pulls\.listFiles/);
  assert.match(poster, /const eventHeadSha = context\.payload\.pull_request\.head\.sha/);
  assert.match(poster, /noFindingsSummary: 'No issues found'/);
  assert.doesNotMatch(poster, /noFindingsSummary: process\.env\.PROVIDER/);
  assert.match(poster, /\n              eventHeadSha,/);
  assert.match(poster, /reviewedHeadSha: review\.head_sha/);
  assert.match(poster, /MAX_ROUNDS: \$\{\{ vars\.AUTOMATED_REVIEW_ROUNDS \|\| 3 \}\}/);
  assert.match(poster, /maxRounds: Number\(process\.env\.MAX_ROUNDS\)/);
  assert.match(poster, /^\s+resolveAddressedThreads,$/m, 'the publisher must import the thread resolver');
  assert.match(poster, /const posted = await postReview\(/);
  assert.match(poster, /if \(posted\) \{\n\s+await resolveAddressedThreads\(\{/, 'a round that published no review must resolve nothing');

  const aggregate = job(workflow, 'review-complete');
  assert.match(aggregate, /if: \$\{\{ always\(\) \}\}/);
  assert.match(aggregate, /needs: \[validate-provider, review-round, claude-review, codex-review, post-review\]/);
  assert.match(aggregate, /name: Automated Code Review/);
  assert.match(aggregate, /\[ "\$VALIDATE_RESULT" = 'success' \] \|\| exit 1/);
  assert.match(aggregate, /\[ "\$CLAUDE_RESULT" = 'success' \] \|\| exit 1/);
  assert.match(aggregate, /\[ "\$CODEX_RESULT" = 'success' \] \|\| exit 1/);
  assert.match(aggregate, /\[ "\$POST_RESULT" = 'success' \] \|\| exit 1/);
  assert.match(aggregate, /REVIEW_ROUND_RESULT: \$\{\{ needs\.review-round\.result \}\}/);
  assert.match(aggregate, /CAN_REVIEW: \$\{\{ needs\.review-round\.outputs\.can_review \}\}/);
  assert.match(aggregate, /\[ "\$REVIEW_ROUND_RESULT" = 'success' \] \|\| exit 1/);
  assert.match(aggregate, /\[ "\$CAN_REVIEW" = 'false' \] && exit 0/);

  const validator = job(workflow, 'validate-provider');
  assert.match(validator, /permissions: \{\}/);
  assert.match(validator, /name: Reject untrusted bot actors/);
  assert.match(validator, /ACTOR: \$\{\{ github\.actor \}\}/);
  assert.match(validator, /\[\[ "\$ACTOR" == \*'\[bot\]' && "\$ACTOR" != 'claude\[bot\]' \]\]/);
  assert.ok(validator.indexOf('name: Reject untrusted bot actors') < validator.indexOf('id: provider'), 'bot guard must run before provider validation and the wildcard action allowlist');
  assert.match(aggregate, /permissions: \{\}/);
  assert.equal(
    (workflow.match(/resolveAddressedThreads/g) || []).length,
    (poster.match(/resolveAddressedThreads/g) || []).length,
    'only the write-scoped publisher resolves review threads',
  );
});

test('each review provider interpolates only its own model and effort variables', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const claude = job(workflow, 'claude-review');
  const codex = job(workflow, 'codex-review');

  assert.match(claude, /--model \$\{.*vars\.CLAUDE_REVIEW_MODEL \|\| 'sonnet'/);
  assert.match(claude, /--max-turns 40/);
  assert.match(
    claude,
    /vars\.CLAUDE_REVIEW_EFFORT && format\('--effort \{0\}', vars\.CLAUDE_REVIEW_EFFORT\) \|\| ''/,
  );
  assert.doesNotMatch(claude, /^\s*--effort\s+\S/m, 'Claude --effort is omitted unless CLAUDE_REVIEW_EFFORT is set');
  assert.doesNotMatch(claude, /vars\.CODEX_REVIEW_/);
  assert.doesNotMatch(claude, /vars\.REVIEW_(?:MODEL|EFFORT)\b/);

  assert.match(codex, /model: \$\{.*vars\.CODEX_REVIEW_MODEL \|\| 'gpt-5\.6-luna'/);
  assert.match(codex, /effort: \$\{.*vars\.CODEX_REVIEW_EFFORT \|\| 'max'/);
  assert.doesNotMatch(codex, /vars\.CLAUDE_REVIEW_/);
  assert.doesNotMatch(codex, /vars\.REVIEW_(?:MODEL|EFFORT)\b/);
});

test('later-round review prompts judge thread replies as evidence', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const claude = job(workflow, 'claude-review');
  const codexPrompt = fs.readFileSync(path.join(__dirname, '..', 'codex', 'prompts', 'review.md'), 'utf8');

  assertLaterRoundThreadPushback(claude, 'Claude later-round prompt');
  assertLaterRoundThreadPushback(codexPrompt, 'Codex later-round prompt');
});

function assertLaterRoundThreadPushback(prompt, label) {
  assert.match(prompt, /in_reply_to_id/, `${label} must group prior comments by thread`);
  assert.match(prompt, /group[\s\S]*thread/i, `${label} must group prior comments by thread`);
  assert.match(prompt, /read[\s\S]*thread/i, `${label} must read thread replies under each earlier finding`);
  assert.match(prompt, /valid pushback/i, `${label} must evaluate implementer pushback`);
  assert.match(prompt, /no code change/i, `${label} must treat valid pushback as addressed without a code change`);
  assert.match(prompt, /invalid pushback/i, `${label} must keep invalid pushback unresolved`);
  assert.match(prompt, /why the reply fails/i, `${label} must name why invalid pushback fails`);
  assert.match(prompt, /addressed_comment_ids/, `${label} must name the threads it confirms addressed`);
  assert.match(prompt, /rooting each thread whose finding this round confirms addressed/i, `${label} must name a thread by the comment rooting it`);
  assert.match(prompt, /trusted\s+publisher resolves exactly those threads/i, `${label} must leave the resolving to the trusted publisher`);
  assert.match(prompt, /Re-filing a\s+finding is the opposite\s+verdict/i, `${label} must treat a re-filed finding as the opposite verdict`);
  assert.match(prompt, /leave\s+its thread open for the author/i, `${label} must leave a re-filed finding's thread open`);
}

test('review schema requires every object property and models optional values as nullable', () => {
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const finding = schema.properties.findings.items;

  function assertAllPropertiesRequired(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'object') {
      assert.deepEqual(
        [...node.required].sort(),
        Object.keys(node.properties).sort(),
        'every declared object property must be required',
      );
    }
    for (const value of Object.values(node)) assertAllPropertiesRequired(value);
  }

  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.outcome.enum, ['reviewed', 'skipped', 'failed']);
  assert.deepEqual(schema.properties.head_sha.type, ['string', 'null']);
  assert.equal(schema.properties.addressed_comment_ids.maxItems, 50);
  assert.deepEqual(schema.properties.addressed_comment_ids.items, { type: 'integer', minimum: 1 });
  assert.equal(finding.additionalProperties, false);
  assert.equal(finding.properties.body.pattern, '\\S');
  assert.deepEqual(schema.properties.summary.type, ['string', 'null']);
  assert.deepEqual(finding.properties.severity.type, ['string', 'null']);
  assert.ok(finding.properties.severity.enum.includes(null));
  assertAllPropertiesRequired(schema);
});
