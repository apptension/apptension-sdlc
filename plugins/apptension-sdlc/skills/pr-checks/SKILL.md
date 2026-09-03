---
name: pr-checks
description: Use right after opening a draft PR in this repo (the tail of dev-flow's draft-PR step) to start watching CI and review feedback and auto-fix what it can — or when setting up the equivalent automated-checks/review/autofix pattern in a different repo. Trigger on intent like "draft PR is open, keep watching", "monitor this PR", "watch CI and review comments", or "set up automated PR review for this repo".
requires:
  - id: verification-workflow
    label: Verification suite running on every pull request
    area: ci
    confirm: true
    detect:
      matches: 'pull_request(_target)?:'
      in: .github/workflows
    intent: >-
      Every pull request runs the repo's own build, lint, and test
      commands before a human reviews it, so mechanical failures are
      caught automatically instead of costing reviewer time or slipping
      into the default branch unnoticed.
    grants:
      - Read-only checkout access to build and run the repo's own
        commands — this workflow only reports pass/fail status, so it
        needs no write scope to the repository, its issues, or its pull
        requests.
  - id: automated-review-workflow
    label: Automated code review on pull requests
    area: ci
    confirm: true
    guest_filable: false
    detect:
      matches: 'claude-code-action|openai/codex-action|coderabbit|reviewdog|pr-agent'
      in: .github/workflows
    intent: >-
      Every pull request gets an automated first-pass code review before
      a human looks at it, surfacing likely issues early so reviewer
      time goes to judgment calls a machine cannot make.
    grants:
      - Read access to pull requests for an analysis job that calls the
        hosting API, plus write access isolated to the trusted publisher
        job — the analysis has to read the PR and the publisher has to
        post its findings, but the model-provider credential must never
        share a job with write authority.
      - An allowed-tools scope limited to exactly the commands the
        review step issues (e.g. viewing a PR, diffing a PR, checking
        auth, making an authenticated API call) — never a blanket shell
        allowance, since an unscoped shell tool can do far more than
        review.
      - The model-provider credential the review step calls (e.g. an
        API key), scoped to this workflow only.
---

# Automated PR checks: review and autofix

What happens between `dev-flow` opening a draft PR and a human merging
it: automated checks, automated review, and two flavours of autofix. This
process is repo-agnostic; every concrete value it needs comes from the
repo's `CLAUDE.md`, under "Dev flow bindings" (or a dedicated "PR checks
bindings" section if the repo keeps them separate).

If that section is absent, say so and suggest the `setup` skill
rather than guessing the values — a guessed default branch or
verification command is worse than a stopped flow.

## Automated checks

CI runs every affected command from the repository's verification binding. A
command whose inputs cannot have changed may report skipped, never passed.

## Automated review

Implement one provider-selected workflow, not separate independently triggered
review workflows. Store the provider choice in a repository setting and reject
an empty or unsupported value before either provider job starts. Provider jobs
are mutually exclusive and the final, always-run aggregate job has one stable,
provider-neutral name for branch protection.

Run review on PR creation, later pushes, and reopen, including while the PR is a
draft. Reject actors outside the repository's permitted set before selecting a
provider. Use a PR-number concurrency group with `cancel-in-progress: true`, a
bounded job timeout, an explicit model and effort setting, and a turn limit
where the provider supports one. Pin third-party actions to commit SHAs. Measure
actual model, duration, turns, cost, and permission denials before changing
those controls; aliases and nested reviewer models can change cost without a
workflow diff.

### Review rounds and prior feedback

Allow exactly three completed automated rounds. Count only submitted automated
reviews, not trigger events, pending reviews, or human reviews. Enforce the cap
both before provider execution and in the trusted publisher so configuration
cannot bypass it. Raising the cap requires automatic provider top-up plus an
explicit capacity and cost decision.

Later rounds receive prior automated review bodies, inline comments, and
replies as read-only context. Group replies by thread and require the result to
say whether each earlier finding was addressed or remains unresolved. Reasoned
implementer pushback counts as addressed; invalid pushback remains unresolved
and explains why. Never resolve review threads automatically. Record the exact
reviewed head and suppress a second review for the same head.

### Trusted analysis and publishing boundary

Execute the workflow from trusted base-branch code. On GitHub, use
`pull_request_target`; check out trusted prompts, schemas, validators, and
publisher code from the base revision, and inspect the PR merge result in a
separate full-history checkout with `persist-credentials: false`. Never execute
PR-controlled workflow code in a job holding a provider secret or write token.

Provider analysis is read-only. Give it only its own provider credential and
the minimum repository read permissions and tool allowlist needed to inspect
the complete diff. It emits a shared structured artifact with:

- the exact PR head SHA;
- an explicit `reviewed`, `skipped`, or `failed` outcome;
- findings restricted to added new-side diff lines; and
- an optional useful summary.

`reviewed` means the complete diff was inspected. `skipped` is only for a
deliberate gate such as an already-reviewed head. Missing data, denied tools, an
incomplete diff, or any other inability to finish is `failed` with an
explanation and no findings, never a successful empty review.

A separate trusted publisher alone receives pull-request write permission and
never receives a model-provider credential. It validates artifact shape, the
current head SHA, added-side locations, duplicate findings, provider outcome,
the three-round cap, and same-head duplication before posting exactly one
review. Reject malformed, stale, failed, duplicate, and off-diff output. If no
valid inline findings remain, publish the provider's useful summary or the
shared no-findings verdict. Preserve a useful later-round summary that explains
the status of earlier feedback.

### Provider paths

For Claude, use the selected bundled review plugin unless measured evidence
justifies a repository-authored replacement. Pass `github_token` explicitly
under `pull_request_target`, grant pull-request read permission, preflight the
commands the review actually needs, and copy the plugin command's narrow
allowed-tools declaration. Do not grant a blanket shell or commenting tool.
Override bundled skip behavior only as needed to review drafts and changed
heads; retain the same-head stop. Require schema-constrained output and run
without direct comment publishing. Claude reviews without waiting for the
verification workflow.

For Codex, load the prompt and output schema from the trusted base revision,
run against the uncredentialed PR checkout in a read-only sandbox, and describe
the actual runtime limitations in the prompt. Before analysis, wait for the
current head's verification run to finish and provide its conclusion and
failure output as read-only context. A failed verification run still proceeds
to review; a wait timeout fails the review path.

Give the Codex provider step a timeout below the job timeout and
`continue-on-error: true`. The provider writes its structured output before
teardown; the following trusted step accepts a complete output file even if
provider teardown timed out, and fails clearly when no complete output exists.
This prevents a wedged action from discarding a review it already produced.

On another CI system or code host, preserve the same contract: validate one
provider choice, execute trusted instructions, isolate credentials, generate
structured output read-only, validate and publish it in a separate write-scoped
step, cap rounds, and expose one stable aggregate check.

## Lightweight autofix (CI side)

`claude-code-action`'s `include_fix_links` option (default `true`) adds
"Fix this" links to review comments. Clicking one opens a Claude session
pre-loaded with the finding's context. This is manual — a human has to
click — not autonomous. The autonomous mechanism is the monitor/fix loop
below.

## Autonomous monitor/fix loop (session side)

**Trigger.** Immediately once `dev-flow`'s draft-PR step completes — in the
same session, right after it attempts the board-card or Jira-ticket move to
In review, whether or not that move actually happens. A missing board, an
`unknown` board row, and a Jira `Tracker statuses` row recording `In review`
as `none` are all no-op outcomes of that attempt, not reasons to wait for
one — the loop starts regardless. Not a separately-requested action.

**Prerequisites.** The loop's CI-failure and review-feedback branches are
`superpowers` skills, so `superpowers` must be available in the session —
its skills present in the session's skill listing. On the normal path
nothing extra runs here: the loop starts in the same session that ran
`dev-flow`, and `dev-flow`'s step 2 pre-flight is the check that covered
it, before that session cut a branch. Started on its own instead — pointed
at an existing PR in a fresh session, where no pre-flight ran — the loop
runs that same check itself before its first poll, and on a miss stops and
hands the human the install path for this harness from
[the prerequisites reference](../../references/prerequisites.md). A monitor
loop that starts without them watches CI successfully and then has nothing
to fix with.

**State**, kept in-session only, never persisted to disk: last-seen CI
conclusion per check name; last-seen review comment/review id or
timestamp.

**Mechanism.** Whatever the agent's harness offers for "do something
periodically without blocking the human" — a background loop that waits
and re-checks, a dynamic wake-up scheduler, or equivalent. Not
prescribed, since it varies by harness; the requirement is periodic,
non-blocking, and bounded by the stop conditions below.

**Cadence.** Every 2–5 minutes, not tighter — CI runs take longer than
that, and polling faster only burns API calls without new information.

**CI watch.** Poll check status on this cadence.
- All green → stays quiet, keeps watching (a later push restarts CI).
- Any failure → `superpowers:systematic-debugging`, produce a fix, verify
  locally, commit (Conventional Commits), push, resume watching.

**Review watch.** Poll for review comments/reviews newer than the
last-seen marker, same cadence.
- New feedback → `superpowers:receiving-code-review` to triage — its
  existing rigor applies unchanged, so it may push back rather than
  blindly implement a suggestion — then handle the round as a unit:
  apply every agreed change via
  `superpowers:test-driven-development`, verify once, split the result
  into commits at the granularity below, push once, advance the marker,
  resume watching.
- **Verify once per round, not once per commit.** The round's changes
  are implemented together and verified together, against the tree all
  of them produce. Verification sits before the commit split, never
  inside it: a six-comment round runs the suite once, not six times,
  which is the difference between a loop that keeps pace with the
  reviewer and one that costs more than the fixes did. The trade-off is
  explicit rather than hidden: what the single run covers is the round's
  final tree, and the per-comment commits leading up to it are not
  verified individually.
- **One commit per review comment addressed.** This carries
  `dev-flow`'s "one logical change per commit" into the post-PR loop: a
  round of feedback never lands as a single squashed "address review
  comments" commit covering unrelated points. The reviewer has to be
  able to check comment-by-comment that their feedback was applied, and
  a fix that turns out wrong has to be revertable without unpicking the
  others.
- **Exception: one fix, one commit.** When a single change genuinely
  resolves several comments, or several comments share a concrete
  common denominator — three comments all about inline imports, say —
  they land as one commit whose message names the group it covers.
  Splitting one fix across commits to match the comment count is as
  wrong as squashing unrelated fixes together.
- **Split by selective staging.** One verified working tree becomes
  several commits by staging a subset at a time, then committing it:
  `git add <path>` when the comment groups touch disjoint files,
  `git add -p` (`--patch`) to pick individual hunks when two groups
  share one. Patch mode diffs the worktree against the index, so a file
  the round newly created offers no hunks at all: `git add -p` reports
  `No changes.` and stages nothing. Run `git add -N <path>` first to put
  an empty version in the index and give patch mode something to diff
  against. The unstaged remainder stays in the tree between commits,
  so the split needs no branch juggling and no stash. Read
  `git diff --cached` before each commit to confirm the group is what is
  staged, and `git status` after the last one to confirm nothing was
  left behind.

### The pull request is the state

The in-session state above is a cache, not the record. **Everything the loop
needs is derivable from the pull request itself**, and a loop that starts
without that cache re-derives rather than gives up:

| What the cache held | Where it is re-derived from |
|---|---|
| Last-seen conclusion per check | The current check-run conclusions on the head commit |
| Last-handled review marker | The newest review comment with no answering commit or reply after it |
| What has already been fixed | The commits on the branch since the PR opened, and their messages |

So a loop **re-diagnoses before it acts**: read the PR's current state, decide
what it is, and only then choose a branch. Never assume the state that was true
when the loop last ran.

This matters in three situations that all reduce to the same one:

- the loop is pointed at an existing PR in a fresh session;
- the session that started it ended and a human resumed it later;
- a session was closed on idle while the loop was waiting on an answer nobody
  had given yet.

The third is the one that turns this from a nicety into a requirement. A session
closes after roughly fifteen minutes of inactivity, and an active poll is not
inactivity, so a loop that keeps polling reaches CI's verdict wherever it runs.
What ends a session early is silence while waiting on a person. That answer can
arrive after the session is gone, so re-derive state from the pull request rather
than depending on in-session memory.

**Where the PR does not answer the question, say so rather than guess.** A
resumed loop that cannot tell what a round of feedback was asking, or which of
several failures it was mid-fix on, states what it reconstructed and what it
could not, and asks. An inferred goal acted on silently is worse than a question.

### Safety rules the loop never breaks

These bind on every path, and none of them is a judgment call:

- **Never make CI green by weakening what it checks.** Deleting an assertion,
  loosening a threshold, skipping a test, or excluding a path turns a red signal
  into a green one without fixing anything, and it is the single most damaging
  thing an autofix loop can do. If the honest fix is not available, the failure
  is surfaced to the human. A test that is *itself* wrong may be changed, but
  that is a reasoned change stated as one, not a way to get to green.
- **Never autofix a pull request the session did not open.** Pointed at someone
  else's PR, the loop reviews and reports; it does not push to a branch whose
  author did not ask for it. Rewriting a colleague's branch under them is not a
  favour.
- **One writer per pull request.** Before acting on a PR the session did not
  just open, check whether something else is already working it — a recent
  agent-authored commit, an in-progress marker, an open loop elsewhere. Two
  loops fixing one PR produce conflicting pushes and duplicated commits. When in
  doubt, report instead of writing.
- **A stale branch is diagnosed, not debugged.** A failure caused by the base
  moving on rather than by the diff is not a bug in the change, and
  `systematic-debugging` will burn a cycle discovering that. Check whether the
  branch is behind its base first, and when it is, say so and let the human
  decide — updating a branch is a history change, and the non-goals below rule
  out doing that unasked.

### Not every finding is worth blocking on

A review round mixes findings that must be fixed with nits, low-severity
observations, and things that are genuinely out of scope for this PR. Treating
them alike makes the loop churn: it keeps working a PR that was ready, and the
reviewer waits on changes nobody needed.

So the loop **triages the round before working it**, which
`superpowers:receiving-code-review` already equips it to do. Blocking findings
are fixed in this PR. Non-blocking ones become **follow-up issues**, filed with
enough context to act on and linked from the PR, and they are named in the PR
body's `Left undone` field — which `dev-flow` already requires and which exists
for precisely this.

The reviewer still gets an answer to every comment; what changes is that some
answers are "filed as #N" rather than a commit. Deferring is a decision the loop
states, never a silence.

**Stop conditions**, deliberately simple, no auto-idle heuristics: the
human explicitly says stop; the PR is closed or merged; the session ends — with
the caveat above that a session ending is not the work ending, and a resumed loop
re-derives its state rather than starting over.

**Non-goals**, mirroring `dev-flow`'s existing ones: never merges; never
takes the PR out of draft; no force-push or history rewrite — plain
commit and push only; never applies feedback blindly.

**Error handling.** The repo's CLI being unauthenticated or rate-limited
→ surface to the human, pause rather than crash. A CI failure the agent
cannot fix (flaky infra, external outage) → bounded retries, then
surface to the human instead of looping forever. A push rejected by a
conflicting upstream change → stop and ask; never auto-merge or
force-push through it.

## Bindings this process needs per repo

| Binding | This repo's value |
|---|---|
| CI-status query | `gh pr checks <N>` |
| Review-comment query | `gh api repos/<owner>/<repo>/pulls/<N>/reviews` and `.../pulls/<N>/comments` |
| Automated reviewer | `AUTOMATED_REVIEWER=claude` — a repository Actions variable; `claude` and `codex` are the only supported values. Model and effort: `CLAUDE_REVIEW_MODEL` (empty → `sonnet`), `CLAUDE_REVIEW_EFFORT` (empty → omit `--effort`), `CODEX_REVIEW_MODEL` (empty → `gpt-5.6-luna`), `CODEX_REVIEW_EFFORT` (empty → `max`) |
| Claude CI review plugin | `code-review@claude-code-plugins`, used only when `AUTOMATED_REVIEWER=claude` |
| Codex CI review | Native `openai/codex-action` with structured JSON output, used only when `AUTOMATED_REVIEWER=codex` |
| Interactive review skill | `apptension-review:code-review` |
