---
name: maintain-verification-skill
description: Use when auditing a project's verification instructions and feature map, or when a scheduled verification maintenance run supplies a target skill and report path.
---

# Maintain a verification skill

Check every mapped feature against source and the live application. Limit
corrections to the selected skill directory, including its owned helpers.
Product regressions require separate work; preserve the expected behavior
and report the failure instead of rewriting it as success.

## 1. Resolve the run

Use the explicit target `SKILL.md` first, then the `Verification skill`
binding in the project's Dev flow bindings. Otherwise inspect
`.agents/skills/`, `.claude/skills/`, `.cursor/skills/`, `.codex/skills/`, and
`.opencode/skills/` for Launch and
Drive sections with a `features/README.md` index. Resolve symlinks, count
canonical directories once, and keep the target inside the repository.
Report an unreadable explicit target as blocked. Several candidates require
selection; a scheduled run reports blocked instead of guessing. No candidate
means blocked and a recommendation to invoke `create-verification-skill`.
An unreadable discovered candidate also blocks selection; resolve the read
failure rather than silently excluding a possible target.

Scheduled runs read `.github/verification-maintenance/config.json` for the
fixed target and integration branch. This instruction directory may be a
copy under `.github/verification-maintenance/instructions/`; it is not the
project skill being maintained. Installed runtime commands are available at
`.github/verification-maintenance/cli.py`; inspect its `--help` before use.
For missing installation, invoke `setup-verification-maintenance` only when
installation was requested. A maintenance run does not install itself.

For a human run, resolve the integration branch from the `Branching model`
binding. Use `Default branch` only when that binding is absent. An unresolved
binding blocks the run. Fetch the remote and record the integration branch's
remote revision before launch or edits; compare against that revision before
publication. Check open PRs for maintenance of this canonical target,
including the installed publisher's stable target branch when configured.
If one exists, leave its branch and PR intact, report its URL, and stop with
outcome `blocked`. A failed fetch or lookup also blocks the run.

A scheduled run can consume the trusted preflight snapshot at
`.verification-output/context.json` instead of making its own GitHub lookup.
The workflow's read-only preparation step records the base revision, provider,
and readiness after checking existing PRs. Require a ready snapshot from this
run whose base matches the checkout and whose provider matches configuration.
Missing, mismatched, or non-ready context blocks execution. Preserve this
snapshot unchanged; the agent has no GitHub credentials and cannot manufacture
preflight success. The publisher independently rechecks the base and PR state.

Record pre-existing working-tree changes; preserve user changes and stop if
they overlap the target. Code and instruction corrections stay inside the
target directory. Keep authored corrections inside that directory. The report, evidence and
temporary application state may live outside it; follow the project skill's
isolation and cleanup instructions for build output, profiles and fixtures. Finish this step with one target, a recorded base, and no competing
maintenance PR.

## 2. Read the complete feature map

Read the index and every feature file. Record their original paths before
editing. Repair missing, duplicate, and dead index links. For each feature,
trace the implementation and record a concrete source citation and one
live recipe. Keep source analysis separate from application driving. One
coordinator owns all live sessions, even if read-only source analysis is
delegated.

Inspect recent source changes for user-facing features missing from the
map. Add an entry only with a concrete source path and a user route.
Removed features still need coverage: cite the source evidence of removal
and drive the old route or its replacement to confirm what a user sees.
Complete this step when every original and final feature has source support
and a live recipe. A clean source review never waives the live pass.

## 3. Drive every feature

Follow the target's Launch model. Use one serially driven instance for a
server or UI, or a fresh isolated session per short-lived CLI drive.
Run doctor before the first drive, on every fresh session, and after any
failed or surprising drive. If doctor misses a wedged user interface, reset
to a known state or relaunch before proceeding.

If doctor fails because its instructions are stale, correct the owned
instructions or helper and retry once, restarting whatever the correction
invalidated. A second failure blocks the run. Re-drive every corrected
helper and affected recipe live before accepting its correction.

Exercise every feature, including new and removed entries. Capture actions,
results, and side effects under repository-root `.verification-evidence/`.
A feature qualifies as `verified-unreachable` only after attempting its
route and observing a concrete external prerequisite such as missing auth,
entitlement, platform support, or external state. Record the prerequisite,
attempted route, and evidence of the failure. Add an omitted prerequisite
to the instructions when that is documentation drift. This records the
observed access boundary, not successful feature behavior. An unattempted
route, tool failure without diagnosis, or product regression is incomplete
coverage and blocks the run.

Clean failed-iteration residue before the next attempt. Stop only instances
the run owns. Copy evidence out of temporary state before cleanup and check
every recorded artifact afterward. Final teardown happens after all drives
and re-proofs. Missing evidence blocks completion even when the drive passed.

## 4. Classify and report

Re-read every changed file and check the diff is confined to the target
directory. Keep run notes and evidence outside that diff. Match coverage
against the union of original and final feature files, excluding the index.
A renamed feature accounts for both paths. No feature disappears from the
coverage requirement because this run removed its documentation.

Write repository-root `.verification-report.json` for both human and
scheduled runs. Its fields are:

| Field | Value |
|---|---|
| `outcome` | `clean`, `blocked`, or `changed` |
| `summary` | Concrete corrections or the exact blocker; include an existing PR URL when applicable. |
| `coverage` | One entry per original or final feature path, with the fields below. |

Each coverage entry has `feature`, a repository-relative feature file path;
`source`, a nonempty citation string naming source paths and supporting
details; `live`, either `verified` or `verified-unreachable`; and `evidence`,
a list of existing repository-relative paths under `.verification-evidence/`.
For `verified-unreachable`, also include nonempty `prerequisite` and
`attempted_route` strings. Removed entries explain removal in `source` and
record the live route that confirmed it. A blocked report lists completed
coverage only and names unfinished features in its summary; never invent
successful entries to fill the list.

Choose the outcome after cleanup and diff review:

- `clean` requires complete source and live coverage with surviving evidence
  and no correction to ship. It opens no PR.
- `changed` requires a nonempty correction within scope, complete coverage,
  surviving evidence, and live re-proof of corrected instructions or helpers.
- `blocked` covers incomplete coverage, product regressions, missing proof,
  unsafe edits, and unresolved prerequisites that prevented even an observed
  access-boundary check. It opens no PR, even with a nonempty correction.

## 5. Publish only proven corrections

A scheduled agent writes the report and finishes. The installed workflow
collects the correction and evidence; its separate publisher validates the
result and creates at most one draft PR. The agent does not commit, push,
open a PR, or change the workflow and its configuration.

For a human-run `changed` outcome, run the project's required verification
commands and inspect their output. A failure changes the outcome to blocked.
Recheck the integration-branch revision and existing maintenance PRs before
publishing. If the base moved or a PR appeared, leave existing work intact
and report blocked. Otherwise commit only the proven target-directory diff
on a dedicated maintenance branch and open one draft PR. Its body names
the corrections, source and live coverage, unreachable prerequisites,
verification results, and evidence locations. Keep evidence available to
the reviewer without including credentials. Leave merging and marking ready
to the human. Empty diffs, clean results, and blocked results open no PR.

Adapted from [pstack maintain-verification-skill](https://github.com/cursor/plugins/blob/main/pstack/skills/maintain-verification-skill/SKILL.md).
Copyright 2026 Lauren Tan. See [LICENSE](LICENSE) for the MIT license.
