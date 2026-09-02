---
name: code-review
description: Use when the user wants a methodical code review of any changeset — uncommitted/staged changes, a commit range, a single commit, or a pull request. Reviews changed files across seven quality areas (including Product experience for UI) and prints the findings in the session by default, then offers to post them to a PR (as a review or inline comments), open/update GitHub issues, or save to a file. Trigger on intent like "review my changes", "review this PR", "review main..HEAD", or when a diff/commit/PR is offered for review.
---

# Code review

Perform a slow, methodical code review of a changeset and report the
findings. Quality matters more than speed.

The changeset can be anything the user points at: uncommitted work,
staged changes, a commit range, a single commit, or a pull request.
By default the review is printed in the current session — nothing is
posted anywhere unless the user asks for it.

## Prerequisites

- A git repository in the current working directory (for local
  targets).
- `gh` is needed only if the user later chooses a GitHub output (PR
  review, inline comments, or issues). The review itself runs without
  it.

## Resolve the review target

Figure out *what* to review before reading any code.

1. **Explicit input wins.** Use whatever the user named:
   - A PR (`#42`, `pull/42`, or a URL) → PR target.
   - A commit range (`main..HEAD`, `abc123..def456`,
     `HEAD~3..HEAD`) → range target.
   - A single commit SHA or `HEAD` → single-commit target.
   - "uncommitted", "my changes", "working tree", "what I have" →
     uncommitted target.
   - "staged", "what's staged", "index" → staged target.
2. **Nothing explicit → ask.** Don't guess. Ask the user to pick,
   offering the live options:

   > What should I review?
   > - uncommitted changes (working tree)
   > - staged changes only
   > - a commit range (e.g. `main..HEAD`)
   > - a pull request (number or URL)

   If the working tree is clean and the current branch has an open PR,
   mention that PR as a likely candidate — but still let the user
   confirm rather than assuming.

Record the target kind; later steps (especially output) depend on it.

## Step 1: Gather the diff and file list

Get the diff and the list of changed files for the resolved target.

**Uncommitted** (unstaged + staged vs `HEAD`):

```bash
git diff HEAD --stat
git diff HEAD
```

**Staged only:**

```bash
git diff --cached --stat
git diff --cached
```

**Commit range:**

```bash
git diff <base>..<head> --stat
git diff <base>..<head>
git log --oneline <base>..<head>   # context: what the commits claim to do
```

**Single commit:**

```bash
git show <sha> --stat
git show <sha>
```

**Pull request** — read the description so the review is anchored to
the stated intent:

```bash
gh pr view <pr> --json title,body,labels,author,baseRefName,headRefName,headRefOid,files
gh pr diff <pr>
```

Drop these from the file list before any later step touches them:

- Lock files (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`,
  `Cargo.lock`, `Gemfile.lock`, `poetry.lock`, `*.lock`).
- Files with `@generated` markers in their first ~5 lines.
- Files listed as `linguist-generated` in `.gitattributes` (if
  present).
- Common generated paths: `dist/`, `build/`, `node_modules/`,
  type-declaration files that are clearly auto-generated.
- Paths a root `CLAUDE.md`/`AGENTS.md`/`GEMINI.md` explicitly names as
  generated or "never hand-edit" — skim the repo root's convention file
  now (before the fuller read in Step 2) specifically for such a list.
  Exclude those paths entirely, don't just downweight findings in them —
  a file a repo generates on purpose can look deliberately broken (e.g.
  intentionally invalid syntax as a documented workaround) and isn't
  reviewable as ordinary code.

## Step 2: Read project conventions

At the repo root and inside each modified file's directory, read
whichever of these exist:

- `CLAUDE.md`
- `AGENTS.md`
- `GEMINI.md`

Use them to weight findings — a violation called out in one of these
files ranks higher than a generic style nitpick. Do not read the
user's global `~/.claude/CLAUDE.md`; scope is the target repo only.

## Step 3: Deep-read each changed file

For each remaining changed file:

1. Read the full file, not just the diff hunk. Surrounding context
   often matters more than the change itself.
2. If the file imports or calls functions whose correctness you
   can't judge from the file alone, read those files too.
3. Note the existing style and patterns so suggestions land
   consistent with the codebase rather than against it.

Never review a diff in isolation.

## Step 4: Methodical review

Walk each file through the seven areas below. Be thorough — every
function, every condition, every edge case. Area **4g** applies only
when changed files include user-facing UI.

**4a. Code Quality**

- Naming, single responsibility, DRY without premature abstraction.
- Error handling and edge cases (null, empty collections, boundary
  conditions).
- Readability and maintainability.
- Consistency with existing style.
- No dead code, unused imports, leftover debug statements.

**4b. Security**

- Injection vulnerabilities (SQL, command, XSS, template injection).
- Input validation at system boundaries.
- Authentication and authorization correctness.
- Secrets or credentials not hardcoded or logged.
- Safe handling of user-supplied data.

**4c. Performance**

- N+1 queries; missing indexes for new query patterns.
- Unbounded loops, large in-memory collections, missing pagination.
- Resource leaks (unclosed connections, file handles, streams).
- Expensive operations on hot paths.

**4d. Correctness & Logic**

- Off-by-one, boolean-logic errors, race conditions.
- Async / concurrency / error propagation handled.
- API contract consistency (shapes, status codes).
- Type safety and correct narrowing.
- Edge cases: empty inputs, very large inputs, unicode, timezones.

**4e. Testing**

- Are new code paths covered?
- Are edge cases tested?
- Do tests actually assert behavior, not just "runs without error"?
- Negative paths and error scenarios.

**4f. Documentation**

- Public APIs, complex logic, non-obvious decisions documented?
- Docstrings present where project convention expects them?
- Behavior changes or new features that need a docs update?

**4g. Product experience** *(UI files only)*

When changed files include user-facing UI (components, pages, styles,
sheets, forms, empty/loading chrome), also review:

**Completeness**
- Loading / empty / error / offline / success / conflict as applicable
- Skeletons match final layout; no empty-flash-then-content
- Sheets don’t double-open / remount around loading

**Interaction**
- Press feedback present; no hard-coded motion timings on interactive paths
- Reduced-motion considered for JS-driven motion
- Frequent actions don’t full-screen-spin for a single mutation

**Visual & content**
- Reuses design system / brand patterns; not one-off parallel chrome
- Supporting imagery for new surfaces or documented no-art
- Copy matches audience voice; no internal jargon
- No horizontal overflow at ~360px from inputs/toolbars

**Accessibility**
- ≥44×44 targets for primary controls
- Labels not placeholder-only
- Focus order / `aria-busy` / status announcements where relevant

Severity guidance:
- Missing critical error/empty for a primary flow → 🟡 Warning
  (or 🔴 if data-loss risk)
- Layout jump / double sheet open → 🟡 Warning
- Hard-coded motion / missing press on primary CTA → 🟢 Suggestion
  (escalate if widespread)
- Generic AI-slop visuals conflicting with brand docs → 🟢 Suggestion
  citing brand docs

When the `apptension-frontend-craft` plugin is available, prefer its
`checklists/REVIEW-4G.md` as a quick reviewer aid.

## Step 5: Collect findings

Record every finding as a structured item so it can be rendered into
any output format later:

- `path` — file path relative to repo root.
- `line` — line number in the **new** version of the file (the `+`
  side of the diff). Only flag changed or added lines.
- `severity` — one of:
  - 🔴 **Critical:** bugs, security holes, data-loss risks.
  - 🟡 **Warning:** likely-correctness issues, missing tests for
    non-trivial logic.
  - 🟢 **Suggestion:** improvements worth considering.
  - ℹ️ **Note:** informational; no action required.
- `body` — what's wrong, why it matters, and a concrete fix. When the
  target is a PR and the fix is small and self-contained (a handful of
  lines, no follow-up needed elsewhere), write it as a GitHub suggestion
  block (` ```suggestion `) so the author can apply it with one click.
  Otherwise, a plain code block or prose description — never a
  suggestion block for a fix that's incomplete on its own.

Make each finding specific. Vague findings waste the reader's time.

## Step 6: Print the review in the session (default)

This is the default output and always happens. Print a readable
markdown report directly in the conversation:

```markdown
## Code Review — <target description>

<one-paragraph summary + counts by severity>

### `path/to/file.py`
- 🔴 **Critical** (line 42): ...
- 🟡 **Warning** (line 88): ...

### `path/to/other.ts`
- 🟢 **Suggestion** (line 12): ...
```

Group findings by file, ordered by severity within each file. Use
`path:line` references so they're clickable. If there are no
findings, say so plainly and give the verdict.

End with a compact summary:

- Target reviewed and how many files.
- Findings count by severity.
- Top 1–3 most important issues (if any).
- Overall verdict: **looks good** / **needs minor changes** /
  **needs major changes**.

## Step 7: Offer to deliver the review elsewhere

After printing, offer to send the review somewhere durable. Present
only the options that apply to the resolved target:

- **Post to the PR** *(PR targets only)* — a single GitHub review
  with `event=COMMENT` containing the summary, plus inline comments
  on the flagged lines. See "Posting to a PR" below.
- **Inline comments only** *(PR targets only)* — same as above but
  with a terse summary body; the detail lives in the inline comments.
- **GitHub issue(s)** *(any target)* — create or update issues.
  When the user picks this, ask whether they want **one summary
  issue** (the whole report in a single issue, updated in place on
  re-runs) or **one issue per finding** (each finding tracked
  separately). See "Posting issues" below.
- **Save to a file** *(any target)* — write the markdown report to a
  file. Ask for a path, or default to
  `code-review-<short-target>.md` in the repo root.

Don't post anything until the user picks. If they're done after the
session printout, that's a complete, valid outcome.

### Posting to a PR

Confirm `gh auth status` first. Build a single review payload — every
finding becomes an inline comment plus a summary in the review body.
Allocate a scratch file with `mktemp` (avoids collisions on parallel
runs):

```bash
PAYLOAD_PATH=$(mktemp -t code-review.XXXXXX.json)
```

```json
{
  "body": "## Code Review Summary\n\n<overall summary with counts by severity>",
  "event": "COMMENT",
  "comments": [
    { "path": "services/api/src/example.py", "line": 42, "body": "🟡 **Warning:** ..." }
  ]
}
```

Submit once, then clean up:

```bash
gh api repos/<owner>/<repo>/pulls/<pr>/reviews --input "$PAYLOAD_PATH"
rm -f "$PAYLOAD_PATH"
```

Use `<owner>/<repo>` from `gh pr view`. The review must use
`event=COMMENT` — never `APPROVE` or `REQUEST_CHANGES`. The skill is
informational; humans decide whether to merge. Don't use
`gh pr comment` for general remarks — everything goes through the
single review payload's `body`.

### Posting issues

Confirm `gh auth status` first.

- **One summary issue:** title like `Code review: <target>`. Body is
  the full markdown report. On re-runs, look for an existing open
  issue with that title (or one the user names) and update it via
  `gh issue edit <n> --body-file ...` rather than opening a duplicate.
- **One issue per finding:** title is the finding's severity + a
  short description; body is the finding detail with the
  `path:line` reference. Skip 🟢 suggestions and ℹ️ notes unless the
  user wants them as issues too — issue-per-finding is for trackable
  work, not commentary.

## Hard rules

- Don't nitpick formatting — assume CI (linters, formatters,
  type-checkers) handles it.
- Don't comment on auto-generated or lock files.
- Don't repeat the same finding across multiple files; mention
  once, note where else it applies.
- Acknowledge good patterns when present. Don't invent issues for
  symmetry.
- Comment only on lines actually changed by the target. Real issues
  on unchanged lines are out of scope for inline comments — mention
  them in the summary instead.
- Priority order when ranking findings: critical bugs > security >
  correctness > performance > style.

## Error handling

Stop and tell the user what went wrong (do not silently fall back)
when any of the following is true:

- The resolved target has an empty diff (nothing to review).
- A named commit range, SHA, or PR doesn't exist or can't be
  resolved.
- The user chose a GitHub output but `gh` is missing or
  unauthenticated — the session printout still stands; only the
  posting step fails.
- *(PR targets, before posting)* The PR is closed, or the current `gh`
  actor (from `gh api /user --jq .login`) has already posted a review on
  the PR's current HEAD SHA. Compare HEAD from
  `gh pr view --json headRefOid` against existing reviews from
  `gh api repos/<owner>/<repo>/pulls/<pr>/reviews` to avoid duplicate
  reviews. A draft PR is not a stop condition — review and post to
  drafts the same as any open PR; some workflows keep a PR in draft for
  its entire review-and-fix cycle.
