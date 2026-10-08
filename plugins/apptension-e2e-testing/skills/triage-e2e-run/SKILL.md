---
name: triage-e2e-run
description: Triage a red E2E run that generate reported, for a caller whose diff under test is its own unpushed work. Classifies each non-passed case as a bad spec, a bug in the diff, a pre-existing bug or an expired session, fixes bad specs, and re-runs a spec after a fix. Called by implement-issue step 8; also for "why did the generated specs fail", "triage this E2E run".
---

# Triage an E2E run

`generate` reports a red run and stops, because it cannot tell a bad spec
from a real bug. This skill makes that call for a caller that can vouch the
diff under test is its own session's unpushed work.

`scripts/` below is `../generate/scripts/`, the `generate` skill's own
directory.

## Inputs

| Input | From |
|---|---|
| The run report | `generate`'s result, per case |
| `<target path>` | The path `generate` ran against |
| The diff is the caller's own unpushed work | The caller states it. Without it, report the cases and stop: a bug might not be ours to fix |
| `<integration branch>` | The branch the caller's work started from |
| `<suite>` | The bindings file's `### E2E bindings` `Location` row, else `e2e/web` |
| Bug issue | `generate`'s step 1 `bug`, or a plan case whose `_Traces to:_` starts with `Bug report`, in `.e2e-testing/test-plan-<N>.md` |

## 1. Sort the report

| Result | Do |
|---|---|
| Per-case `failed`, `flaky`, `skipped`, `missing`, `not-run` | Classify at [step 2](#2-classify-each-case). **`flaky` does not pass** |
| Infrastructure: `no-playwright`, `ambiguous`, `report-unreadable`, `timed-out`, `error`, a pre-run `invalid` or `not-listed` spec, or a boot-phase stop before any case (`no-base-url`, `deps-missing`, `timeout`, `no-start-command`) | Report it to the caller and stop, with no spec-fix attempt |
| A pre-fix run stop: a bug case that passes before the fix, a guard that fails, or an inconclusive pre-fix result | Report it to the caller and stop, with no spec-fix attempt. Whether the spec tests the bug is the human's call |

For `ambiguous`, first re-run `generate` naming `--location <the Playwright
package dir, holding package.json and playwright.config.ts>`, read from the
`Location` row when one exists, since a custom `testDir` can nest the spec
dir deeper.

Done when every case is either queued for step 2 or reported.

## 2. Classify each case

Read `sessionExpired` first. `run-specs` sets it when a test started logged
in and ended on the login page.

| Case | Verdict |
|---|---|
| `sessionExpired`, and the diff changed login or auth code | A bug in the diff |
| Any other `sessionExpired` case, or a case the diff leaves genuinely unclear | Take the [base re-run](#4-base-re-run): red there is pre-existing, green is ours |
| Otherwise | Bad spec, a bug in the diff, or a pre-existing bug, judged from the diff |

A non-auth `sessionExpired` case takes its verdict from the base re-run:

| Base re-run | Verdict |
|---|---|
| Green | A bug in the diff |
| Red, without `sessionExpired` | A pre-existing bug |
| Red, with `sessionExpired` | Session expired |

Done when every case has a verdict.

## 3. Act on each verdict

| Verdict | Do |
|---|---|
| Bad spec | Fix it with the `playwright-testing-patterns` skill, then [re-run it](#re-run-a-spec). **At most two attempts per spec file**, then stop and hand it to the human |
| A bug in the diff | Hand the case back to the caller, which debugs and fixes, then asks for a [re-run](#re-run-a-spec) of the existing spec |
| A pre-existing bug | Hand the case back to the caller, which files the follow-up issue. With its number, mark the case `.skip` (or the framework's equivalent) referencing that issue |
| Session expired | Hand back the entry's `hint` verbatim, naming the case, and leave the spec and the diff as they are |

Hand back one line per case for the PR record: a fixed spec, a spec fix
that used both attempts and stopped, a skipped case with its issue, or a
lost session with its hint.

Done when every bad spec passes or has used both attempts, and every other
verdict is with the caller.

### Re-run a spec

`generate` refuses to overwrite an existing spec (`refused-exists`) and
tears the app down after its run, so a re-run boots, runs and tears down:

```bash
node scripts/resolve-app-url.mjs <target path> --start [--suite-location <rel>]
node scripts/run-specs.mjs <target path> <spec path> [--location <rel>]
node scripts/resolve-app-url.mjs <target path> --stop  # e2e-location-default
```

Pass `--suite-location` and `--location` when `<suite>` sits outside
`e2e/web`.

### Once every case passes

On a bug issue whose plan has a bug case, a run that went red skipped
`generate`'s pre-fix run, since `generate` stopped first. So once a re-run
leaves every case handed back passing, and every other case already passed,
invoke `generate` to resume over the same spec paths, leaving out any spec
marked `.skip`, as its "Resuming after a stop" says. Its step 8 runs the
pre-fix run on a bug issue. Hand its report to the caller: a clean gate
means step 8 is done, and a stop is a pre-fix run stop, routed as
[step 1](#1-sort-the-report) says.

## 4. Base re-run

The same spec against the integration branch's app, in a throwaway
worktree. It is valid only when that worktree can run the suite and the
PR app is down. Once item 1 returns `added`, every exit runs item 6's
teardown before it reports: a failed install, a boot-phase stop and a spec
run that ends without a result all leave no worktree behind. In order:

1. Add the worktree, copying the generated spec and any page object the
   diff changed outside `<suite>`:

   ```bash
   node scripts/rerun-worktree.mjs add <target path> --commit origin/<integration branch> --copy <spec path>… [--suite-location <rel>]
   ```

   It also copies every `<suite>` file the diff changed (a fixture,
   `login.ts`), `<suite>/.env` and `<suite>/.auth/`, and deletes each
   `<suite>` file the diff deleted. `added` returns
   `path`: script calls below take it as `<base>`. `exists`: remove that
   `path` as item 6 does, then add again once. A second `exists` is a
   directory git does not own: report its `path` like an infrastructure
   status. `error`: report it like an infrastructure status. The script
   already removed any half-made worktree.
2. Install the base worktree's app and suite dependencies with the repo's
   package manager, as the caller's checkout was installed.
3. Stop the PR app:
   `node scripts/resolve-app-url.mjs <target path> --stop  # e2e-location-default`
4. Boot the base app:
   `node scripts/resolve-app-url.mjs <base> --start [--suite-location <rel>]`.
   Only `booted` proves the base app is up. `running` means an app this run
   did not start answers at that URL: ask the human to stop it, then boot
   again. On a boot-phase stop, tear down as item 6 does, then report the
   stop like any infrastructure status.
5. Run the spec: `node scripts/run-specs.mjs <base> <spec path> [--location <rel>]`,
   and read its result.
6. Tear down: `node scripts/resolve-app-url.mjs <base> --stop  # e2e-location-default`,
   then `node scripts/rerun-worktree.mjs remove <target path> --path <base>`.
   The next step re-boots the PR app when it needs one.

Done when the worktree is removed and the case has its verdict.
