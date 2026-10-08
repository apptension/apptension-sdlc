# E2E tests

Read at step 8 when its gate holds and the human answered `yes`.

## 1. Generate

Invoke the `apptension-e2e-testing` plugin's `generate` skill with the
issue reference. It judges which behaviours need a browser, drafts the plan
for the human's approval, writes the specs and runs them.

`generate` diffs against the default branch. On a git-flow repo that diff
can include integration-branch commits this issue never touched: record
that gap as a step 6 finding and keep going.

| `generate` result | Do |
|---|---|
| `passed`, or an empty approved plan | Step 8 is done |
| Anything else | [Triage](#2-triage) |

## 2. Triage

Invoke `triage-e2e-run` with `generate`'s report, the target path, the
integration branch, and that the diff under test is this session's own
unpushed work. It fixes bad specs itself and hands back every other case:

| Case handed back | Do |
|---|---|
| Infrastructure status or a pre-fix run stop | Report it and stop for the human |
| A bug in this diff | `superpowers:systematic-debugging`, then back to step 6, as step 7 does on red. Once the fix lands, ask `triage-e2e-run` to re-run the existing spec, with no new question |
| A pre-existing bug | Draft a follow-up issue and put it before the human per `issue-authoring`'s gate. Give its number to `triage-e2e-run`, which marks the case `.skip` |
| Session expired | Report the hint to the human verbatim, naming the case |
| A bad spec that used both fix attempts | Hand it to the human |

Done when every case is passed, skipped with its issue, or handed to the
human.

## 3. Record

Put every line `triage-e2e-run` hands back on the PR body's **Left undone**
line: a deferred spec, a filed follow-up, a lost session with its hint, or a
spec fix that used both attempts.
