# Pre-fix run

Read at step 8 when every entry passed, the ticket is a bug issue, and the
plan has at least one bug case. Paths below are relative to the `generate`
skill's directory, as in `SKILL.md`.

A bug case that passes on the code before the fix does not catch the bug.
This run checks that: every generated spec runs again against the pre-fix
commit, in a throwaway worktree with its own app. Bug cases must fail there.
Guard cases must pass there too.

## Inconclusive

A pre-fix result that cannot answer the question is **inconclusive**: no
spec in the run is a bug case, the pre-fix commit cannot be resolved, the
install fails, the app does not boot, the run does not finish, or a bug
case fails before it reaches its assertion. A run has no bug case when
every bug case's spec was marked `.skip` or deleted, leaving guards only. An inconclusive result stops the run and says why. It is never a
pass.

## Steps

Before step 1, check that at least one spec path in the run is a bug
case's. None is inconclusive: say every bug case was left out of the run,
and stop.

From step 3 on, every exit runs step 7's teardown, including every stop.

1. **Resolve the pre-fix commit.** Pass step 1's `diffSource` as
   `--source`, `--issue <N>`, and as `--base` the branch the fix was cut
   from: the same `--base` step 1 used, or the caller's integration branch
   when it is not the default branch. With no `--base`, the script takes an
   open PR's base branch, then the default branch:

   ```bash
   node scripts/resolve-prefix-commit.mjs <target path> --source <git|gh-pr> [--issue <N>] [--base <branch>]
   ```

   `--issue <N>` is required with `gh-pr`. A Jira ticket passes no
   `--issue`, so it needs `--base` on a repo whose fixes branch from a
   branch other than the default.

   `resolved` carries `commit` and `method`: `merge-base` for an unmerged
   fix, `merge-commit`, `squash` or `rebase` for a merged pull request.
   `unresolved` is inconclusive: present `reason` and stop. A Jira ticket
   has a local diff only, so it always passes `--source git`.

2. **Stop the fix app.** The pre-fix app answers at the same
   `E2E_BASE_URL`:

   ```bash
   node scripts/resolve-app-url.mjs <target path> --stop  # e2e-location-default
   ```

3. **Add the worktree.** `--copy` takes every spec path step 8 ran and every
   page object step 6 wrote:

   ```bash
   node scripts/rerun-worktree.mjs add <target path> --commit <commit> --copy <path>… [--suite-location <rel>]
   ```

   It copies those paths, every suite file the fix changed, and the suite's
   `.env` and `.auth/`, and deletes each suite file the fix deleted, listed
   in `removed`. Pass `--suite-location` when the `Location` row
   names a suite outside `e2e/web`.

   | Status | Do |
   |---|---|
   | `added` | Record `path` as `<worktree>` and go on |
   | `exists` | A worktree from an earlier run. Run `rerun-worktree.mjs remove` on its `path`, then add again once. A second `exists` is a directory git does not own: name its `path` and stop. Inconclusive |
   | `error` | Present `message`, and `path` when present, then stop. Inconclusive. The script already removed any half-made worktree |

4. **Install the worktree's app and suite dependencies** with the repo's
   package manager, as the target checkout was installed. A failed install
   is inconclusive: present its output tail and stop.

5. **Boot the pre-fix app:**

   ```bash
   node scripts/resolve-app-url.mjs <worktree> --start [--suite-location <rel>] [--location <app path>]
   ```

   Pass `--location` with the app path step 4 chose when its detection
   came back `ambiguous`, so the pre-fix boot starts the same app.

   Only `booted` proves the pre-fix app is up. `running` means an app this
   run did not start answers at that URL, often the human's own: ask them
   to stop it, then boot again. Every other status is inconclusive: present
   it as step 4 of `SKILL.md` describes and stop.

6. **Run every generated spec,** bug cases and guards alike:

   ```bash
   node scripts/run-specs.mjs <worktree> <spec path>… [--location <rel>]
   ```

   A status other than `ran` is inconclusive. Otherwise apply
   [the gate](#the-gate).

7. **Tear down:**

   ```bash
   node scripts/resolve-app-url.mjs <worktree> --stop  # e2e-location-default
   node scripts/rerun-worktree.mjs remove <target path> --path <worktree>
   ```

   `stopped`, `already-stopped` and `not-running` are all fine for the
   first. `removed` and `not-present` are both fine for the second. The
   fix app stays down: step 9 then finds no pidfile, which is expected.

Done when the worktree is removed and the gate has a verdict for every case.

## The gate

A **bug case** is a plan case whose `_Traces to:_` starts with
`Bug report`. Every other case is a **guard**. Each case's verdict comes
from its pre-fix `result`:

| Case | Pre-fix result | Verdict |
|---|---|---|
| Bug | `failed`, on an assertion in the test body | Caught |
| Bug | `failed` in setup | Inconclusive: stop |
| Bug | `passed` or `flaky` | Does not catch the bug: stop |
| Bug | `skipped`, `missing`, `not-run` | Inconclusive: stop |
| Guard | `passed` | Holds |
| Guard | Anything else | Fails before the fix: stop |

**Setup** is decided by where the error was thrown and what called it. A
`failures` entry carries, when the runner reports them, `errorLocation`, the
file and line of the first error, and `specFrame`, the first line of the
spec file in that error's stack. `location` is only the test's declaration.
Open the spec at `specFrame`, and at `errorLocation` when it is the spec:

- `specFrame` inside this test's own callback: a catch. That covers an
  `expect` and an action in the callback, and a page object the callback
  called, such as a click on a button the pre-fix app lacks.
- `specFrame` inside a `beforeAll` or `beforeEach` hook, or no `specFrame`
  at all, as when a fixture or a seed or login helper threw: setup. A page
  object a fixture called lands here too.
- No `errorLocation` and no `specFrame`: setup, since the evidence cannot
  place it.

A catch whose entry carries a `networkFailures` row for a seed or login
request is setup too: the case ran on data the pre-fix app never wrote. A
failure in setup proves the pre-fix app could not run the case. A schema
the fix changed breaks seeding this way.

`flaky` stops because the case passed on a retry: on the pre-fix code it
does not fail reliably.

## Report

**Every case caught or holding, with at least one bug case caught.** One line per bug case, naming its spec
path and the pre-fix error's first line, then one line saying every guard
holds. The flow completes.

**Any stop.** Present each stopping case: `specPath`, `title` from the plan,
its verdict, its result on the fix (`passed`) and on the pre-fix commit,
and the pre-fix `failures`, `networkFailures` and `appLog` verbatim where
the entry carries them, the same way step 8 presents a red case. Name the
pre-fix commit and its `method` once. Then stop.

Do not edit, regenerate or re-run a spec here. A bug case that passes on
the pre-fix code asserts something the fix did not change, or the bug does
not reproduce in a browser. Telling those apart is the human's call. Once
they act, the run resumes as `SKILL.md`'s "Resuming after a stop" says,
which runs this file again.
