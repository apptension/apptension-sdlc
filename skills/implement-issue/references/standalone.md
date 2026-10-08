# Standalone run

Read before step 1 when `dev-flow` did not invoke this run.

A standalone run asks at most one question before the draft PR is open:
the execution method, before step 3, when the plan came from writing-plans
and the mode is full.
After that answer, a stop is a report, never a question: it ends the run
with what stopped it and what the human does next.

## What ends the run

- Any stop `run-preflight` or the tracker skill says.
- Step 2's two stops: no Plan handoff, no `pr-checks`.
- A step that would stop and ask, such as step 3's `Branching model` rows:
  put the question in the report.
- Step 6: a finding that blocks this issue. Stop and report it.
- Step 6: a micro change leaving its named surface, per
  [the promotion stop](#the-promotion-stop).
- Step 7: red verification after debugging.
- Step 10: a merge conflict you cannot resolve.

## Asking nobody, step by step

| Step | Standalone |
|---|---|
| 8 | Skipped. Where the gate's first two conditions hold, Left undone reads "E2E tests: not run in an unattended implementation run" |
| 10 | Nothing filed. Each step 6 finding is one Left undone line |

## The promotion stop

On the micro track, a change leaving its named surface:

1. Commit the work so far, a Conventional Commit saying what it does.
2. Leave the branch local and unpushed.
3. Stop and report what left the surface.

The human then runs `plan-issue` on the ticket, then `implement-issue`,
each started by name. That run [resumes](#resuming-a-stopped-run).

## Resuming a stopped run

A ticket with a local branch from a promotion stop: the next run switches
to that branch at step 3, runs step 4 (the ticket may sit in Ready after
`plan-issue`), continues from step 6, and judges the stop's commit
against the newest Plan handoff with the rest of the change.
