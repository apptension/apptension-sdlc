---
title: "Automated PR checks: review and autofix"
area: ci
summary: What happens between a draft PR opening and a human merging it — automated checks, automated review, and two flavours of autofix.
plugin: apptension-sdlc
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
verification command is worse than a stopped flow. See
[`./setup.md`](./setup.md).

## Automated checks

CI must run the repo's own verification suite on every PR. A command
whose inputs cannot have changed may be skipped — the skip must report
as skipped, not passed — but every command that can be affected still
runs. Nothing here is Apptension-specific: every repo already has some
notion of "the commands that must pass," and this process assumes CI
already runs them.

In this repository, pull requests always run `npm run test:node`. They
run `uv run pytest` only when the diff touches `plugin-tools/`,
`tools/generator/`, `tests/`, `pyproject.toml`, or `uv.lock`. Pushes to
`main` always run pytest.

## Automated review

Every PR from a permitted actor has **one selected automated reviewer**. On
GitHub, permitted actors are human users and `claude[bot]`; the validation job
rejects other bot actors before provider selection. The repository Actions
variable `AUTOMATED_REVIEWER` is the selector: its only valid values are
`claude` and `codex`. A small validation job reads it before either provider
job starts, and the provider jobs are mutually exclusive. An empty or
unsupported value is a configuration failure, with an error that says how to
fix it; it must not silently skip review or fall back to a provider. Each
provider reads its own model and effort from repository Actions variables —
`CLAUDE_REVIEW_MODEL` and `CLAUDE_REVIEW_EFFORT` for Claude,
`CODEX_REVIEW_MODEL` and `CODEX_REVIEW_EFFORT` for Codex — so flipping
`AUTOMATED_REVIEWER` is the only switch. Empty variables fall back to `sonnet`
with no Claude `--effort`, and to `gpt-5.6-luna` at `max` effort for Codex.

Do not retain a second, independently triggered review workflow alongside
this selector. It produces two active reviewers, duplicate feedback, and an
ambiguous branch-protection result. One provider-selected workflow runs on
`opened`, `synchronize`, and `reopened` pull-request events, including when
the PR is a draft, so each push can receive feedback while the change is
being developed. Its posting path records the reviewed head SHA and does not
post twice for the same head.

The workflow permits exactly three completed automated review rounds. A round
counts only a submitted review authored by `github-actions[bot]`; pending
reviews, human reviews, and trigger events do not consume the cap. The
provider-cost guard and the trusted publisher both enforce this fixed cap, so
the publisher cannot be configured to raise it. Later rounds read prior
automated review bodies and inline comments through read-only context. They
group those comments by thread (`id` / `in_reply_to_id`), read replies under
each earlier finding, and report whether it was addressed or remains
unresolved, with its location and reason. Valid implementer pushback counts
as addressed even with no code change; invalid pushback stays unresolved and
names why the reply fails. The model-provider analysis remains read-only;
only the separate trusted publisher may post the single review, and the
workflow never resolves review threads automatically.

Any future increase above three rounds requires an automatic provider
top-up first, with the resulting provider capacity and cost explicitly
confirmed before changing the cap.

Start with the bundled review capability supplied by the selected vendor.
Move to a repo-authored review skill only once you can name what the bundled
one gets wrong about the repo — and only if you are willing to pay for it.

The tradeoff is real in both directions, and it is a cost tradeoff before
it is a quality one:

- A repo-authored skill knows the repo's conventions, and can be told to
  review drafts and pushes and to skip a duplicate review on an unchanged
  HEAD SHA.
- A bundled skill knows neither *a priori*. Mature vendor skills may default
  to skipping draft, closed, trivial, or already-reviewed PRs and may read
  the repo's `CLAUDE.md`/`AGENTS.md` for conventions. This repository's
  review prompt overrides the draft condition and the already-commented
  condition only when the prior review is on an older head; it retains the
  same-head stop, and the trusted publisher also suppresses a duplicate
  review for that head.
- A hand-authored skill is the thing you keep paying for. Mandatory
  full-file reads and unbounded related-file follows are easy to write and
  expensive to run, and nothing in the workflow file makes that cost
  visible. Measure a real run before assuming the repo skill is worth its
  price.

**Measure before choosing, and after.** The run log is the only honest
source. For the Claude path, `claude-code-action` prints an SDK `init` block
naming the model actually used and a `result` block with `duration_ms`,
`num_turns`, `total_cost_usd` and `permission_denials_count`:

```bash
gh run view <run-id> --log \
  | grep -E '"model"|"duration_ms"|"num_turns"|"total_cost_usd"|permission_denials_count'
```

Read the model off `init` rather than off the workflow file — `--model
sonnet` is an alias resolved at runtime, so the effective model changes
silently when a new Sonnet ships. And treat a non-zero
`permission_denials_count` as a cost bug, not noise: each denial burns a
turn plus whatever recovery the model attempts next.

### Provider-neutral GitHub workflow

Keep provider credentials isolated and execute the workflow from the trusted
base branch with `pull_request_target`; a `pull_request` workflow would let a
PR replace its own write-scoped inline steps. The selector and aggregate jobs
have no provider credential. The Claude job receives only
`ANTHROPIC_API_KEY`; the read-only Codex generation job receives only
`OPENAI_API_KEY`. It checks out the PR merge result without credentials, but
loads its prompt and output schema from the trusted base revision. The
separate Codex posting job has `pull-requests: write`, but no model-provider
credential and checks out the trusted base revision. This division means
untrusted model output can never use the credential that generated it to post,
and a job that can post cannot call the model or execute PR-controlled workflow
instructions.

Both provider paths need a bounded timeout and the PR-number concurrency
group with `cancel-in-progress: true`. The final, always-run aggregate job
has one stable name — for example, `Automated Code Review` — and succeeds
only when the selected path completed or intentionally skipped review. A
provider that cannot access required data or otherwise finish must emit a
failed outcome, which the trusted publisher rejects so the aggregate check is
red rather than a misleading successful no-findings result. Protect that one
provider-neutral check instead of a provider-specific job name, so changing
`AUTOMATED_REVIEWER` does not require changing branch protection.

Choose model settings deliberately and set them explicitly. The selector
chooses the provider; it is not a cost-control default. For this repository,
empty `CLAUDE_REVIEW_MODEL` / `CLAUDE_REVIEW_EFFORT` /
`CODEX_REVIEW_MODEL` / `CODEX_REVIEW_EFFORT` fall back to `sonnet` with no
Claude `--effort` and a 40-turn ceiling, and to `gpt-5.6-luna` at `max`
effort. Another repository may set those four variables after measuring
representative reviews, but must record the model and effort (or equivalent
provider controls), a turn limit where available, and a timeout rather than
relying on vendor defaults.

#### Claude

For `AUTOMATED_REVIEWER=claude`, point `plugin_marketplaces` and `plugins`
at the vendor's bundled review plugin, and let the plugin own the prompt:

```yaml
      - name: Run Claude Code Review
        uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
          plugin_marketplaces: 'https://github.com/anthropics/claude-code.git'
          plugins: 'code-review@claude-code-plugins'
          prompt: '/code-review:code-review ${{ github.repository }}/pull/${{ github.event.pull_request.number }}'
```

To use the repo's own skill instead, swap both fields — any repo with a
`.claude-plugin/marketplace.json` is already a valid marketplace,
referenced by its own git URL, with no separate hosting needed:

```yaml
          plugin_marketplaces: '<this repo's git URL>'
          plugins: '<review-plugin>@<this repo's marketplace name>'
          prompt: '/<review-plugin>:<review-skill> ${{ github.repository }}/pull/${{ github.event.pull_request.number }}'
```

**Cap every run, whichever you pick.** These are independent of the
choice and cost nothing:

```yaml
concurrency:
  group: automated-code-review-pr-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  claude-review:
    timeout-minutes: <a few minutes above your measured worst case>
```

plus `--max-turns <n>` in `claude_args`. Without a job `timeout-minutes`
the only ceiling is the Actions 6h default, so a wedged run bills six
hours before anyone notices; without the `concurrency` group a superseded
in-flight review keeps running against a HEAD nobody is looking at.

### Shared analysis and publishing boundary

The selected provider runs only the **analysis** half of review. Claude and
Codex both inspect the PR merge result with full history in an uncredentialed
checkout (`persist-credentials: false`) and emit the same JSON artifact:
`head_sha`, an explicit `reviewed` / `skipped` / `failed` outcome, added-line
findings, and an optional summary. `reviewed` means the diff was actually
inspected; `skipped` is reserved for a deliberate gate such as an already
reviewed commit; `failed` requires an explanation and no findings. Claude
receives `contents: read`, `issues: read`, and `pull-requests: read`; its
`--allowedTools` list grants `git log` and
`git rev-parse` for real PR history and SHA resolution, alongside narrow
GitHub read commands. It has neither a comment tool nor `pull-requests: write`.

One base-revision **publisher** job alone has `pull-requests: write`. It
validates the selected artifact against the current PR head and added-side diff
before posting, rejects a failed outcome, and suppresses duplicate same-head
reviews. This keeps
untrusted PR content and model output away from direct write authority. Claude
is instructed to return `No issues found` for a completed review with no
findings, while Codex may omit that summary. The shared publisher uses that
verdict only when the provider supplies no useful summary; a later-round
summary explaining whether earlier findings were addressed is preserved even
when no current inline findings remain. When a provider supplies useful
summary context alongside findings, the publisher preserves that summary
according to the existing validation rules.

Caveats:

- **Under `pull_request_target`, `github_token` is mandatory, not
  optional.** The action's default GitHub auth requests an OIDC token and
  exchanges it at Anthropic's server for a `claude[bot]` app token — and
  that exchange rejects tokens minted under `pull_request_target` with
  `401 Invalid OIDC token`, while the same action in the same repo
  exchanges fine from `pull_request` and `issue_comment`. Passing
  `github_token: ${{ secrets.GITHUB_TOKEN }}` short-circuits the exchange
  entirely — the action uses the provided token and never requests OIDC —
  so the job drops `id-token: write` too. The Claude job must explicitly grant
  that token `pull-requests: read`; `issues: read` does not authorize
  `gh pr view` or `gh pr diff`. Verify `gh pr view` in a preflight step so a
  scope regression fails before spending model tokens. The shared publisher posts review comments as
  `github-actions[bot]`. `GITHUB_TOKEN` events never trigger other workflows
  — a loop guard here, not a loss, since nothing downstream keys on review
  comments re-triggering CI.
- **A bundled skill will likely skip draft PRs**, which collides head-on
  with a draft-first flow like `dev-flow`'s. Anthropic's `code-review`
  plugin stops at its first gate on a draft, so a PR opened as a draft
  would get no review until it is marked ready — leaving the monitor loop
  below with no review feedback to watch during exactly the phase it
  exists for. Override it in the prompt rather than living with it: the
  `prompt` input is free text wrapped around the slash command, so append
  an instruction naming the one gate to disable and confirming the others
  still apply. Disable the draft condition, and override the
  already-commented condition only when its review targets an older head;
  retain that stop when it targets the current head.
- **Check what the duplicate guard actually keys on.** A repo-authored
  skill can compare against the head SHA and re-review once the code moves.
  Anthropic's `code-review` ordinarily keys on whether Claude has commented
  on the PR *at all*, so the prompt must narrow that stop: an older-head
  review is a new round, while a current-head review still stops. The trusted
  publisher remains the authoritative same-head duplicate guard before it
  creates a review, so a model-side decision cannot create a duplicate.
- **A bundled skill picks its own subagent models.** Anthropic's
  `code-review` fans out to four parallel review agents plus one validator
  per candidate issue, and pins them per step — haiku for the skip gate,
  sonnet for convention compliance, opus for the two bug agents. The
  workflow's own `--model` sets the orchestrator only, so it does not cap
  what the review spends underneath. Do not assume "bundled" means
  "cheaper" without a measured run.
- **Do not let an analysis job post.** Run Claude without `--comment`, require
  its schema-constrained output, and publish it only through the shared trusted
  validator. A model result is untrusted input even when the model itself is
  authenticated.
- This installs the plugin from whatever ref the marketplace URL
  resolves to (typically the default branch), so a PR that itself edits
  the review skill is reviewed by the previous version of that skill,
  not its own edit.
- `claude-code-action` refuses to run at all on a PR that modifies the
  workflow file it's defined in — a security guard against a PR
  rewriting its own CI to exfiltrate secrets. The action itself reports a
  successful no-op ("Workflow validation failed... your workflow will begin
  working once you merge your PR"), so the shared artifact validator must fail
  the aggregate check when no completed result exists. A PR that changes
  `.github/workflows/automated-code-review.yml` itself, including the PR that
  first sets up this wiring, cannot use itself as a live test — the wiring
  only proves out on the next PR after merge.
- Only if the marketplace repo is private — a vendor's bundled one will
  not be — plan on embedding credentials in the URL
  (`https://x-access-token:${{ github.token }}@github.com/...`).
  `claude-code-action`'s own marketplace-add step doesn't inherit the
  git auth it sets up for itself — a still-open upstream bug
  ([anthropics/claude-code-action#850](https://github.com/anthropics/claude-code-action/issues/850))
  — so a plain `https://` URL to a private repo fails every run with
  `fatal: unable to get password from user`. Don't work around it by
  pointing `plugin_marketplaces` at a local path (e.g. the job's own
  checkout) instead — that would resolve against the PR's own untrusted
  content rather than the default branch, defeating the trust boundary
  in the caveat above.
- Pass an explicit `claude_args: --allowedTools "..."`, scoped to
  whatever Bash calls the review skill's diff-gathering and posting
  steps actually issue. For a bundled plugin, copy its command's own
  `allowed-tools` front-matter verbatim; for a repo skill, list what its
  steps run (e.g. `gh pr view`, `gh pr diff`, `gh auth status`, `gh api`,
  `mktemp`, `rm`). `--allowedTools` is passed straight through to the
  SDK — the action adds no base set of its own — though read-only tools
  (`Read`, `Grep`, `Glob`) are auto-approved and need no entry. Without
  it, this non-interactive run has no one to approve tool use, so every
  Bash call is silently permission-denied. Require the model to emit `failed`
  whenever denied access prevents completion, and reject that outcome in the
  trusted publisher; otherwise the action can complete and cost real tokens
  while doing no review. The bundled review command also needs
  commit history and SHAs when it links findings, so the workflow grants
  only `Bash(git log:*)` and `Bash(git rev-parse:*)`; both are read-only,
  and no mutable Git command is approved. Also pass `--model` explicitly (e.g.
  `sonnet`); left unset, the action defaults to the slowest, most
  expensive model for what is routine review duty.

#### Codex and the shared publisher

For `AUTOMATED_REVIEWER=codex`, run `openai/codex-action` against the PR
merge result in a read-only sandbox. Load the native review prompt and shared
JSON Schema from the trusted base revision, while Codex's working directory
remains the uncredentialed PR merge checkout. The prompt must require the
exact PR head SHA and findings that point only at added new-side lines in the
PR diff; the output file is the same interface Claude supplies to the trusted
posting job, not a review comment to publish verbatim. Its prompt follows the
same outcome contract and must report `failed`, not an empty successful review,
when it cannot inspect the complete diff.

Trusted Codex prompts must also declare the reviewer's actual execution
environment: the read-only filesystem and unwritable temporary directories,
which runtimes and commands are unavailable, and which inspection commands
remain usable. Keep that declaration factual and update it when the runner
capabilities change, so the reviewer does not spend its budget probing a known
limitation.

Codex waits for this pull request's head SHA `verify.yml` (Verify
marketplace) run to complete (success, failure, or cancelled) before the
model starts. That wait does not include the Docs workflow; a still-running
`docs` job does not hold Codex. A new push waits on that SHA's marketplace
verify run, not the previous one. A wait timeout fails the wait job
instead of reviewing a pending run. A failing verify run still starts Codex,
with the failure log. Claude does not wait; its path does not read verify
results.

A trusted step then writes the `verify` workflow run's conclusion —
including failing test names and their output — into
`.review-context/verify-results.md`. The Codex prompt names that file.
The review job does not run the suite: it stays `sandbox: read-only` and
does not add a writable `TMPDIR`.

The posting job downloads that file and deterministically rejects malformed
shape, a failed outcome, a stale head SHA, a previously reviewed head SHA,
duplicate findings, and lines outside the current added-side PR diff. It submits
the remaining
inline findings in exactly one `COMMENT` review. If there are no valid inline
findings, the publisher posts the provider's useful summary or falls back to
the shared `No issues found` verdict, unless the review is skipped or failed;
valid inline findings remain the primary review content. This keeps a model hallucination or an
out-of-date run from becoming a misleading comment, and gives reviewers one
coherent result rather than one review per finding.

**Pin the provider action to a commit SHA, not a floating major tag.**
`@v1` moves under you. `openai/codex-action` v1.12 rewrote its Linux
privilege-isolation launch path, and the step began producing a complete
review and then never returning, so it idled until the job timeout killed
it and every later step was skipped — including the upload that hands the
result to the publisher
([openai/codex-action#150](https://github.com/openai/codex-action/issues/150)).
Runs that had already paid for a valid review posted nothing. Pin the SHA
and name the tag it belongs to in a trailing comment, so an upgrade
arrives as a diff someone reviewed rather than overnight.

**Never let a wedged provider discard a result it already wrote.** Given
an explicit `output-file`, the action passes `--output-last-message` to
`codex exec`, so the CLI writes the review the moment the turn ends,
before any teardown can wedge. Give the provider step its own
`timeout-minutes` below the job's and `continue-on-error: true`, then let
the next step decide: publish when the output file holds a JSON object,
and fail with an error naming the step's outcome when it does not. The job
timeout alone is the wrong guard, because cancelling a job skips the
remaining steps rather than running them, which is exactly how a finished
review gets thrown away.

**On any other CI system or git host:** preserve the same contract with that
host's primitives: validate one explicit provider selection, isolate each
provider's credential, generate structured output read-only, validate it in a
separate write-scoped step, post one review, and expose one stable aggregate
check.

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
`superpowers` skills, so it needs every plugin listed in
[`./prerequisites.md`](./prerequisites.md). On the normal path nothing extra
runs here: the loop starts in the same session that ran `dev-flow`, and
[`dev-flow`'s step 2 pre-flight](./dev-flow.md) is the check that covered it,
before that session cut a branch. Started on its own instead — pointed at an
existing PR in a fresh session, where no pre-flight ran — the loop runs that
same check itself before its first poll, and stops the way
`prerequisites.md` describes if a plugin is missing. A monitor loop that
starts without them watches CI successfully and then has nothing to fix with.

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

The third is the one that turns this from a nicety into a requirement, and it is
worth knowing the mechanism. **A session closes after roughly fifteen minutes of
inactivity, and an active poll is not inactivity** — so a loop that keeps
polling reaches CI's verdict on its own, wherever it is running. What ends a
session early is silence: a loop that has stopped to ask something and is
waiting on a person. That answer can arrive long after the session is gone, so a
loop whose correctness depends on in-session memory degrades exactly where it is
most needed. Re-deriving costs one extra read per resume and removes the whole
class of problem, in every harness, without persisting anything to disk.

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
human explicitly says stop; the PR is closed or merged; the session
ends — with the caveat above that a session ending is not the work
ending, and a resumed loop re-derives its state rather than starting
over.

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
| Claude CI review plugin | `code-review@claude-code-plugins` (Anthropic's bundled one, used only when `AUTOMATED_REVIEWER=claude`) |
| Codex CI review | Native `openai/codex-action`, structured JSON output; model and effort from `CODEX_REVIEW_MODEL` / `CODEX_REVIEW_EFFORT` (used only when `AUTOMATED_REVIEWER=codex`) |
| Interactive review skill | `apptension-review:code-review` — still the one to run by hand; only the CI path uses the bundled plugin |
