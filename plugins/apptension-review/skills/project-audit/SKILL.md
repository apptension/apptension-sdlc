---
name: project-audit
description: Use when the user wants a full audit of the project's current state — runs the code-review methodology over the whole codebase and the infra-review audit in parallel, scores each area 0–100, and writes one combined, versioned report to .apptension-audit/. Trigger on intent like "audit the project", "project health check", "full audit", "how healthy is this repo", "run an audit" — NOT for reviewing a specific changeset or PR (that's code-review) or infra-only questions (that's infra-review).
---

# Project audit

Audit the project's whole current state and produce one combined,
scored report an audit reviewer can triage in minutes. The skill
dispatches two auditors in parallel — a code auditor applying the
sibling `code-review` methodology across the codebase, and an infra
auditor running the sibling `infra-review` as written — scores 11
areas 0–100, and writes a single versioned report.

The skill is **read-only except for writing into `.apptension-audit/`**.
It never posts to GitHub, never runs `gh`, never asks the user
questions mid-run, and never changes code. It produces findings and
reports only. Any actual fixing is normal follow-up work the skill
merely offers at the end.

On re-runs the audit is **incremental** and **comparable**: it reviews
only what changed since the last audit, re-verifies the prior report's
open findings, and renders per-area deltas so project health can be
tracked over time.

## Prerequisites

- Current working directory is the repository root to be audited.
- The directory is a git repository with at least one commit.
- No `gh` is needed — the audit never touches GitHub.

## Step 1: Resolve baseline & mode

Establish whether this is a first audit (full mode) or a re-run
(incremental mode), and against which commit.

1. **Confirm the repo.** `git rev-parse --git-dir` fails → **stop**
   with "not a git repository". `git rev-parse HEAD` fails → **stop**
   with "empty repository, nothing to audit".
2. **Check the working tree.** `git status --porcelain` non-empty →
   set a **dirty** flag. The audit still runs against `HEAD`; the
   report header records `dirty: true` and the `HEAD` sha it ran
   against.
3. **Find the baseline.** The baseline is the newest file in
   `.apptension-audit/` matching `????-??-??-*.md` whose frontmatter
   has `code_audit: ok` — sort candidates by their `YYYY-MM-DD` date
   prefix, break ties by file mtime. Directory absent, empty, or no
   qualifying file → **full mode** (skip to Step 2).
4. **Pick the mode.** Parse `commit:` from the baseline's frontmatter.
   - `git merge-base --is-ancestor <commit> HEAD` succeeds →
     **incremental mode**, range `<commit>..HEAD`.
   - It fails (rebase, force-push, or unknown sha) → print a warning
     that the baseline commit is not in history and fall back to
     **full mode**.

Record the mode, the range (incremental only), the baseline filename,
and the baseline commit — later steps depend on them.

## Step 2: Dispatch the two auditors in parallel

Send **one message with two Task-tool calls** (`general-purpose`
subagents), so they run concurrently. Both prompts share these
instructions: work read-only; never interact with the user; never
post to GitHub or run `gh`; never write files; return your complete
markdown report as your final message, ending with the
machine-readable summary block specified below.

Resolve `../code-review/SKILL.md` and `../infra-review/SKILL.md`
relative to this skill's own directory to absolute paths before
dispatch, and pass those absolute paths in the prompts.

### Code auditor prompt

Tell the subagent to read the sibling `code-review` SKILL.md (absolute
path) and apply its **Steps 2–5 methodology**: the six scored areas
(code quality, security, performance, correctness & logic, testing,
documentation), the severity vocabulary 🔴 critical / 🟡 warning /
🟢 suggestion / ℹ️ note, and its findings structure. When the codebase
includes user-facing UI, also apply `code-review` area **4g Product
experience** during the review — but **bucket every 4g finding under
`code-quality`** in `findings_summary` (do not invent a seventh summary
key). Project-audit scoring stays at six code areas so reports remain
comparable across versions. **Skip** its target-resolution, PR-posting,
and output-offering steps — those are changeset/interaction machinery,
not part of a whole-project audit.

- **Full mode:** review the entire codebase, excluding the
  generated/lock files listed in `code-review`'s Step 1 and the
  `.apptension-audit/` directory.
- **Incremental mode:** review `git diff <baseline-commit>..HEAD` per
  the same methodology, **and** re-verify every code finding in the
  previous report. Pass the baseline report's absolute path; its code
  findings live in the "Full code review report" section. Classify
  each prior finding as:
  - `resolved` — the issue is no longer present,
  - `still_open` — the issue is still present,
  - `stale` — the referenced code/file no longer exists, so the
    finding is moot.

Return contract — the report ends with **exactly** this fenced block.
Counts are **currently-open** findings (new ones plus still-open prior
ones), so incremental scores stay comparable to full-mode scores:

```yaml
findings_summary:
  code-quality: {critical: 0, warning: 0, suggestion: 0, note: 0}
  security: {critical: 0, warning: 0, suggestion: 0, note: 0}
  performance: {critical: 0, warning: 0, suggestion: 0, note: 0}
  correctness: {critical: 0, warning: 0, suggestion: 0, note: 0}
  testing: {critical: 0, warning: 0, suggestion: 0, note: 0}
  documentation: {critical: 0, warning: 0, suggestion: 0, note: 0}
reverification:            # incremental mode only
  resolved: ["<short finding title>", ...]
  still_open: [...]
  stale: [...]
```

### Infra auditor prompt

Tell the subagent to read the sibling `infra-review` SKILL.md
(absolute path) and **execute it as written in chat mode** — a full
run every time, never incremental. Additionally, bucket every severity
finding into exactly one of five areas:

- `iac` — its category 5b (Infrastructure as Code quality),
- `twelve-factor` — its category 5c (12-factor compliance),
- `cicd` — its category 5d (CI/CD pipeline),
- `environments-secrets` — its category 5e (environments & secrets),
- `observability` — its category 5f (observability & operations).

The 12-factor scorecard stays in the report exactly as `infra-review`
renders it. For the summary block, each violated or partial factor
surfaces as **one severity finding** under `twelve-factor`, at the
severity `infra-review`'s Step 6 already assigns (e.g. partial
compliance on an important factor = 🟡), so every area reports plain
severity counts in the uniform format.

Return contract — the report ends with **exactly** this fenced block:

```yaml
findings_summary:
  iac: {critical: 0, warning: 0, suggestion: 0, note: 0}
  twelve-factor: {critical: 0, warning: 0, suggestion: 0, note: 0}
  cicd: {critical: 0, warning: 0, suggestion: 0, note: 0}
  environments-secrets: {critical: 0, warning: 0, suggestion: 0, note: 0}
  observability: {critical: 0, warning: 0, suggestion: 0, note: 0}
```

## Step 3: Score

Compute a 0–100 score for every area from its `findings_summary`
counts, using this fixed rubric verbatim — the constants do not change
run to run:

- **Per area, uniformly:**
  `score = max(0, 100 − 25×critical − 10×warning − 3×suggestion)`.
  ℹ️ notes deduct nothing. (The weights are chosen so one critical
  lands at 75 → ⚠️ and two land at 50 → ❌, matching the bands below.)
- **Overall:** `round(mean of all available area scores)` — the
  unweighted mean across every area that was scored.
- **Status markers (fixed bands):** ✅ ≥ 85, ⚠️ 60–84, ❌ < 60.
- **Incremental deltas:** for each area, diff its score against the
  baseline frontmatter's `scores:` map and render `▲ +N` / `▼ −N` /
  `—`. Use `—` when unchanged, in full mode, or when the area is
  absent from the baseline.
- **A failed auditor:** its area group gets **no** scores — matrix
  rows show `—` and "audit failed"; `overall` is computed from the
  surviving areas and labeled "(partial)". Never fabricate scores.

The area count is 11: six code areas + five infra areas. Product
experience (code-review 4g) is reviewed when UI is present but is not
a twelfth score row — those findings roll into `code-quality`. Never
adjust the weights ad hoc to make a score look right. Never add
`findings_summary` keys beyond the eleven listed in the return
contracts above.

## Step 4: Compose & write the report

1. **Ensure the store exists.** Create `.apptension-audit/` if missing
   and write `.apptension-audit/.gitignore` containing a single line
   `*` (the directory ignores itself; no tracked-file edits, no
   repo-level `.gitignore` change).
2. **Path.**
   `.apptension-audit/<YYYY-MM-DD>-<git rev-parse --short HEAD>.md`.
   If the same date + same commit file already exists, **overwrite**
   it — an identical re-run supersedes.
3. **Layout, in this order:**

   **Frontmatter** — exactly these keys. They are the machine
   interface future runs parse (Step 1 baseline resolution, delta
   computation), so the key names and shape must stay stable:

   ```yaml
   ---
   date: <YYYY-MM-DD>
   commit: <full sha of HEAD>
   mode: full | incremental
   dirty: true                      # only when the tree was dirty
   baseline: <baseline filename>    # incremental only
   baseline_commit: <full sha>      # incremental only
   code_audit: ok | failed
   infra_audit: ok | failed
   scores:                          # only areas that were scored
     overall: <int>
     code-quality: <int>
     security: <int>
     performance: <int>
     correctness: <int>
     testing: <int>
     documentation: <int>
     iac: <int>
     cicd: <int>
     twelve-factor: <int>
     environments-secrets: <int>
     observability: <int>
   ---
   ```

   **One-pager** —
   - a verdict line from the overall band: ✅ Healthy /
     ⚠️ Needs attention / ❌ At risk;
   - a scoring matrix table with columns **Area | Score | Δ | Status**,
     rows in this fixed order: Code quality, Security, Performance,
     Correctness & logic, Testing, Documentation, IaC, CI/CD,
     12-factor, Environments & secrets, Observability & ops, then
     **Overall**;
   - a 3–5 sentence executive summary;
   - a top critical findings list.

   **Full code review report** — the code auditor's markdown, minus
   its `findings_summary` block.

   **Full infra review report** — the infra auditor's markdown, minus
   its `findings_summary` block.

   **Fixed since last audit** *(incremental only)* — the resolved /
   still open / stale lists from the code auditor's `reverification`
   block.

## Step 5: Tell the user

In chat, in this order:

1. Print the one-pager (verdict + scoring matrix + executive summary).
2. Print the absolute path to the new report.
3. Print a short numbered list of the top findings — all 🔴 criticals,
   plus the top 🟡 warnings up to ~5 items total — ending with an
   offer to investigate or fix them.

The skill performs no fixes itself; the offer stays an offer.

## Hard rules

- **Findings and reports only.** The skill never modifies anything
  outside `.apptension-audit/`, never posts to GitHub, never runs
  `gh`, never changes code.
- **Never ask mid-run.** The audit runs to completion without
  interactive questions.
- **A dead or failed auditor degrades, never fabricates.** Report the
  surviving half, mark the other area group "audit failed" in the
  matrix, compute `overall` from the surviving areas and label it
  "(partial)". Never invent scores or counts.
- **The rubric is fixed.** Never adjust the 25/10/3 weights or the
  band thresholds ad hoc to make a score look better.
- **No memory or conversation citations in the composed report.** The
  report must not mention agent memory, prior conversations, or any
  source the reader cannot access. Memory may inform what to
  investigate; every finding must be expressible from repo state
  alone. (Inherited from `infra-review`.)
- **Present rules as standards, not skill internals.** Phrase
  conventions as industry / team / common standards with their *why*,
  never as "the rubric says", "per Step 3", "this skill checks for".
  (Inherited from `infra-review`.)

## Error handling

- **Not a git repository** (`git rev-parse --git-dir` fails) → stop
  with a clear message.
- **Empty repository** (`git rev-parse HEAD` fails) → stop: nothing to
  audit.
- **Baseline commit not in history** (rebase / force-push / unknown
  sha) → warn and fall back to full mode.
- **A pre-existing `.apptension-audit/` file without the expected
  frontmatter keys** (hand-written or foreign) → treat as
  non-qualifying for baseline resolution → full mode. No heuristics
  beyond the defined keys.
- **A subagent dies, or returns a report with a malformed/missing
  `findings_summary` block** → treat that auditor as failed for
  scoring (matrix `—` / "audit failed") while still embedding whatever
  markdown report it returned. Same rule as a dead subagent — never
  guess counts.
- **The Task tool cannot run both subagents concurrently** → run them
  sequentially, code auditor first. The report contract is unchanged;
  only wall-clock time suffers.
