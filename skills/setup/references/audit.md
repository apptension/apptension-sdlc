# Audit

Read at step 2, for the probes that need more than the probe table, and at
step 5 for the candidate questions.

## Entry flags

Read every flag off the entry in `checklist.json`. An entry added later is
decided by what it declares.

| Flag | Effect |
|---|---|
| `confirm: true` | A probe hit resolves to `candidate`, never `present`. A miss is `missing`, as for any entry. See [Candidates](#candidates) |
| `writes: true` | A gap is fixed in place, never filed: at step 4 for the bindings table, at [Set up E2E](e2e.md) for `e2e-scaffold` |
| `optional: true` | Absence is reported under `Reported, not filed`, never filed |
| `guest_filable: false` | On step 0's `solo` answer, the gap is held back from the issue table and reported under `Reported, not filed`. An entry that omits the key is guest-filable. Entries carrying `writes:` or `optional:` never produce an issue and carry no `guest_filable` |

`unknown` is its own state. A probe that did not run (for example a
`labels` probe with `gh` unauthenticated) learned nothing, and recording it
as `missing` files a bogus issue.

## `labels` probes

Read `detect.min_count` first.

**With `min_count: N`**, the question is whether the repo has an area
taxonomy of its own. `present` when the repo has at least N labels that
classify issues by area of work, `missing` otherwise. `detect.labels` is
the declaring repo's own set, an example of a taxonomy's shape and never
the bar. A repo with `backend` / `frontend` / `infra` passes.

Count the labels the repo added. GitHub's defaults (`bug`,
`documentation`, `duplicate`, `enhancement`, `good first issue`, `help
wanted`, `invalid`, `question`, `wontfix`) classify kind of work, not area,
and counting them passes every repo. `issue-intake`'s dedup path creates
`duplicate`, so it appears in repos with no taxonomy.

A `missing` result files an issue that proposes a taxonomy from the target
repo's own structure (its top-level directories, its stack, the areas its
issues already discuss), with `detect.labels` at most as an illustration.
The repo names its own areas.

**Without `min_count`**, `present` only when every label in
`detect.labels` exists. A partial match is `missing`.

## `release_age` probes

Run Check in [release-age.md](release-age.md#check), and map its roll-up:

| Roll-up | Entry state |
|---|---|
| `present` | `present` |
| `missing` | `missing`. Keep the per-root list for the issue body |
| `not applicable` | Not applicable in this repo, so step 6 reports it nowhere |
| `unknown` | `unknown`, naming the file Check could not read |

## Project verification discovery

For `project-verification-skill`, the path probe is a candidate search
only: an unrelated skill is no evidence the project can be driven.

1. Resolve the optional `Verification skill` row in `CLAUDE.md` or
   `AGENTS.md` first.
2. Otherwise inspect `.agents/skills`, `.claude/skills`, `.cursor/skills`,
   `.codex/skills` and `.opencode/skills`. A usable candidate has
   frontmatter with `name` and `description`, Launch and Drive sections, a
   `features/README.md` index, and at least one feature file. Resolve
   aliases and symlinks, and count each canonical repository-local
   directory once.

Use the installed verification-maintenance runtime's `discover --root`
command when available; `setup-verification-maintenance` says how to locate
it. Discovery is read-only and does not invoke that installer. Without the
runtime, run the same checks directly.

| Result | Audit and binding action |
|---|---|
| One usable skill | Present. Skip the creation issue and propose its canonical path in `Verification skill` |
| None | Missing. Draft the creation issue in [issues.md](issues.md#project-verification-skill) |
| Several | Candidate. Present the paths and ask for a selection at the gate |
| Explicit path missing or invalid, unreadable candidate, or path outside the repo | Unknown, with the exact problem. Preserve the binding and file no creation issue until it is resolved |

For `verification-maintenance-workflow`, confirm the configured target,
integration branch, provider, bootstrap commands and credentials as well as
the workflow file. A missing credential or stale configuration needs the
installer even when the filename matches. Report unsupported CI providers:
the GitHub Actions templates do not apply to them.

## Candidates

A `matches` probe greps the whole file, so a hit anywhere counts: the
trigger, a `permissions:` block, a job name, a comment. A `pull_request`
workflow that only lints satisfies `verification-workflow`. A workflow
declaring `issues: read` with no `issues:` trigger satisfies
`intake-workflow`. `automated-review-workflow` names review tools, so a
triage job on the same action matches. `docs-drift-workflow` names common
docs-check shapes, so a repo's own docs check reaches the gate as a
candidate and counts once confirmed. The regex is a cheap probe, never
evidence of intent, so the human decides.

A false `present` hides a gap until the process that needed it misbehaves.
A false `missing` costs one word to drop at the gate. That asymmetry is why
candidates default to `n`.

Ask one question per candidate, naming the matched file, before drawing up
the issue table. Ask about candidates step 0 held back too: the answer
decides whether step 6 reports them as `Present` or as a gap to raise with
the owner. Print the opening once:

```
Two files here are candidates: setup found text in them that looks right,
and text alone cannot tell whether the file does the job, so it asks you
rather than crediting them itself. y counts the file as already doing the
job, and nothing further is reported about it. n treats the job as still
missing: it becomes a row in the issue list below, which you can still
drop there, or, for the jobs this run is not filing in a repo that is not
yours, a line in the summary for you to raise with whoever owns the repo.

  verification-workflow: CI running this repo's own checks on every
  pull request
  ci.yml mentions "on: pull_request". Does it actually run this repo's
  build, lint and test commands? (y / n, enter accepts n, which keeps
  this on the list of gaps)

  intake-workflow: labelling and duplicate-checking newly opened issues
  stale.yml mentions "on: issues". Is that triaging new issues? (y / n,
  enter accepts n)
```

| Answer | Result |
|---|---|
| `y` | `present`, no issue |
| `n`, or no answer | `missing`: filed like any gap, or reported under `Reported, not filed` when step 0 held it back |

The answer to one candidate never carries to another. The table the human
approves is the table after this pass. A `candidate` counts as neither
present nor missing for step 3's escalation threshold.
