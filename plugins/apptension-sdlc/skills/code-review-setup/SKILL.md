---
name: code-review-setup
description: Use when installing automated code review in a repo — copying the bundled review workflow, scripts, prompt, and schema, substituting only the per-repo keys. Trigger on intent like "set up automated code review", "install the review workflow", "set up automated PR review for this repo", or when the setup skill offers it for the automated-review-workflow gap. Safe to re-run; a repo whose files already match is a no-op.
requires:
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

# Installing automated code review

This skill copies a working review workflow into a repo instead of
having the next engineer rebuild it from prose. The bundle in
`templates/` is the general shape; four `%%…%%` tokens carry everything
that differs per repo. The result: every pull request gets one
provider-selected automated review, posted by a trusted publisher,
capped per PR.

`pr-checks` is the other half: it watches the reviews this workflow
posts. It does not install anything, and this skill does not monitor
anything.

## What this installs

| Template | Target in the repo |
|---|---|
| `automated-code-review.yml` | `.github/workflows/automated-code-review.yml` |
| `automated-review.js` | `.github/scripts/automated-review.%%EXT%%` |
| `automated-review.test.js` | `.github/scripts/automated-review.test.%%EXT%%` |
| `automated-code-review.workflow.test.js` | `.github/scripts/automated-code-review.workflow.test.%%EXT%%` |
| `fetch-ci-results.js` | `.github/scripts/%%FETCH_SCRIPT%%.%%EXT%%` |
| `fetch-ci-results.test.js` | `.github/scripts/%%FETCH_SCRIPT%%.test.%%EXT%%` |
| `review-prompt.md` | `.github/codex/prompts/review.md` |
| `review-findings.schema.json` | `.github/schemas/review-findings.schema.json` |
| `scripts-package.json` | `.github/scripts/package.json` — `js` flavor only |

The workflow selects one provider per repo — Claude or Codex — and
fails closed on any other value. Claude reviews immediately; Codex
first waits for the repo's CI workflow on the same head and reads its
conclusion. Both emit the same structured findings, and one trusted
publisher validates and posts them. The tests ship with the machinery
and assert its load-bearing shape: the Codex action's SHA pin, the
permission split, the round cap.

`scripts-package.json` pins `.github/scripts/` to CommonJS so the `js`
flavor keeps running if the repo's root package.json ever declares
`"type": "module"`. It installs only with the `js` flavor: the `cjs`
extension already enforces CommonJS, and in an ESM-rooted repo the pin
would silently rescope any existing `.js` scripts in that directory.

## The per-repo keys

Resolve every token before writing anything. Detection proposes;
the human confirms. A value you cannot detect is a question, never a
guess.

| Token | How it resolves |
|---|---|
| `%%CI_WORKFLOW_FILE%%` | The workflow file that runs the repo's verification suite on pull requests (`verify.yml` here means nothing elsewhere — read `.github/workflows/` for files with `pull_request` triggers and ask which one is the suite). |
| `%%CI_RESULTS_FILE%%` | Filename the CI wait writes under `.review-context/`. Default `ci-results.md`; keep an existing install's name on re-run. |
| `%%FETCH_SCRIPT%%` | Basename of the CI-wait script. Default `fetch-ci-results`; keep an existing install's name on re-run. |
| `%%EXT%%` | `cjs` when the repo's root package.json declares `"type": "module"`, else `js`. Derived, not asked. |

Two more answers come from the human, not from tokens:

- **The reviewer**: `claude` or `codex`. Asked, never defaulted — it
  decides which API key the repo's owner pays for.
- **CI wiring** (optional): a CI step running
  `node --test .github/scripts` so the installed tests keep asserting
  the workflow's shape. Offered as its own approval row because it
  edits an existing workflow file; declining leaves the tests runnable
  locally.

## One schema across repos

Variables and secrets have the same names in every repo this skill
touches, so an operator who knows one install knows them all.

| Kind | Name | Value |
|---|---|---|
| Actions variable, required | `AUTOMATED_REVIEWER` | `claude` or `codex` |
| Actions variable, optional | `AUTOMATED_REVIEW_ROUNDS` | Completed-review cap per PR; unset means 3. The workflow fails closed on a non-integer. Raising it is a cost decision the operator makes knowingly. |
| Actions variable, optional | `CODEX_REVIEW_TIMEOUT_MINUTES` | Codex provider-step timeout; unset means 12. Must be a positive integer no greater than 352. The workflow derives a job timeout eight minutes higher so setup and publishing retain their margin. |
| Actions variables, optional | `CLAUDE_REVIEW_MODEL`, `CLAUDE_REVIEW_EFFORT`, `CODEX_REVIEW_MODEL`, `CODEX_REVIEW_EFFORT` | Model and effort overrides; unset uses the workflow's defaults |
| Secret | `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | Exactly the one matching the selector |
| Bindings row | `Automated reviewer` | The selector value, recorded in the repo's Dev flow bindings table |

## The install procedure

1. **Pre-flight.** `gh auth status` succeeds; the operator can set
   repository variables (needs admin); the repo's bindings table is
   located (`CLAUDE.md`, or `AGENTS.md` where that is the repo's
   agent-instruction file). Inventory `.github/workflows/` for existing
   automated review workflows, including a differently named prior
   install. A missing prerequisite is named to the human, not worked
   around.
2. **Resolve** the tokens and the reviewer, then render every template
   in memory — contents and target paths both.
3. **Compare against the repo.** Files alone do not decide the no-op:
   check the configuration beside them — `gh variable list` shows
   `AUTOMATED_REVIEWER` at the resolved value (and any approved
   optional variables at theirs), `gh secret list` shows the matching
   key's name, and the bindings table carries the `Automated reviewer`
   row. Every rendered file byte-equal to its target AND the
   configuration current, with no competing review workflow: report
   "already installed, nothing to write"
   and stop — the no-op re-run. Matching files with missing or
   different configuration — an interrupted install, or a re-run that
   changes the provider — proceed to the gate carrying only the
   configuration deltas. A target file that exists and differs: show
   the diff. A competing workflow: show its path and ask whether to
   remove it or stop; installing beside it is not an option because it
   would duplicate reviews and provider cost. Replacing a repo's review
   machinery is the human's call on a per-file basis, never silent.
4. **The gate.** Present one approval covering the full file list with
   rendered contents (or diffs), the variables to set, the
   `Automated reviewer` bindings-row diff in the located instruction
   file, every competing workflow approved for removal, and the
   optional CI-wiring row. Nothing is written or removed until the
   human approves; the CI-wiring row can be declined without declining
   the rest.
5. **Write** the approved template files and update the located
   instruction file's `Automated reviewer` row to the selected value.
   Remove each competing workflow the human approved. Leave every
   change uncommitted. No commit, no push, no pull request — the
   operator reviews and lands the change through the repo's own flow.
6. **Set variables** the human approved via
   `gh variable set AUTOMATED_REVIEWER --body <value>` (and the
   optional ones the same way). The API key is different: print the
   exact command — `gh secret set ANTHROPIC_API_KEY` or
   `gh secret set OPENAI_API_KEY`, matching the selector — for the
   operator to run themselves. The key's value never passes through
   this session.
7. **Check for residue.** `grep -rn '%%' <written files>` finds a
   token that survived substitution; any hit is a failed install to
   fix before reporting done.
8. **Report** what was written, which variables were set, the secret
   command still to run, and that branch protection can now require
   the aggregate check named `Automated Code Review`.

## The one code adaptation point

`%%FETCH_SCRIPT%%` renders CI results generically: failed job names
plus the failed-step log. That is the honest common denominator, and
most repos should keep it. A repo whose suite buries failures in noisy
logs can rewrite the renderer half of the script — the functions that
turn a completed run into markdown — to parse its own runner's output
into named failures. toolkit-dev's copy does this for pytest,
extracting `FAILED test_name - message` lines into per-test sections.
The polling half never changes; adapt only what renders.

## Security shape — copied, not edited

The workflow's value is that its security decisions are already made.
Every install keeps, unchanged:

- `pull_request_target` with prompts, schemas, validators, and the
  publisher checked out from the trusted base SHA — PR-controlled code
  never runs in a job holding a secret or write scope.
- The credential split: analysis jobs hold the model key and read-only
  permissions; the publisher holds `pull-requests: write` and no model
  key. Codex receives the key through the action's proxy rather than
  its environment, and explicit `drop-sudo` prevents the agent from
  inspecting the privileged proxy process.
- Findings land only on added new-side diff lines. The publisher fails
  closed when a provider names any other line, and also rejects
  stale-head, duplicate, malformed, and failed output.
- The Codex provider action pinned to a commit SHA. The Claude action
  and GitHub's first-party actions track major version tags — a
  deliberate trust call, not an oversight, and tightening it is the
  repo owner's decision.
- The round cap and same-head suppression run before the provider; the
  publisher repeats both checks before writing, so no configuration
  path skips them or spends model budget twice on one head.
- Draft pull requests are reviewed; a same-head repeat is suppressed.
- The Codex step carries its configurable timeout below the job's and
  `continue-on-error: true`, so a provider that writes a complete
  review and then hangs still gets that review published. The job keeps
  eight minutes beyond the step timeout for setup and publishing.
- A review contains at most 50 inline findings, the maximum GitHub
  accepts in one review request; larger provider output fails validation.

An edit to any of these is a security decision for the repo's owner,
not a substitution this skill performs.

## After the install

The operator commits the files through the normal flow; the first pull
request after that exercises the workflow. Watching its reviews — and
fixing what they find — is the `pr-checks` skill.
