---
name: implement-issue
description: Manual skill, run when the human names it or dev-flow invokes it. Working a ticket end to end is dev-flow. Takes a ticket's plan to a draft PR, and run on its own asks at most one question, the execution method, then nothing until the PR is open.
---

# Implement a ticket

Take a ticket's approved plan to a draft pull request. Every concrete
value (integration branch, verification commands, commit convention) comes
from the repo's "Dev flow bindings" section in `CLAUDE.md` or `AGENTS.md`,
read under the bindings rules `run-preflight` applies.

**The tracker skill** is `manage-github-issue` or `manage-jira-ticket`, per
the tracker `run-preflight` resolved for this ticket.

## Two ways to run

Under `dev-flow` when `dev-flow` invokes this skill and says so: run
[the execution method](#the-execution-method), step 3, and steps 6 to 10.
Otherwise the run is standalone, started by name: run steps 1 and 2, the
execution method, steps 3 and 4, and steps 6 to 10. Read
[references/standalone.md](references/standalone.md) before step 1.

## The plan

| Source | When |
|---|---|
| This session | `plan-issue` ran its gate in this session: the plan it approved and its track |
| The ticket's Plan handoff | Every other case: `plan-issue` picked up an existing handoff under `dev-flow`, or step 2 found it standalone. Read [references/plan-handoff.md](references/plan-handoff.md) |

## 1. Read the issue

Standalone only. Invoke `run-preflight` with the ticket reference, phase
`implement`, run shape `standalone`, and that this run performs step 4. It
resolves the tracker, reads the ticket through the tracker skill, runs step
2's shared checks in the same pass, and says any stop itself. If
`run-preflight` or the tracker skill is missing from the session, stop and
say `apptension-sdlc` has to be installed in this harness.

Done when `run-preflight` hands back the tracker, the ticket and the mode.
Under `dev-flow`, all three come from `plan-issue`'s run in this session.

## 2. Pre-flight

Standalone only. After `run-preflight` returns, and before any branch:

1. Invoke the tracker skill's `Find the plan handoff`. None found: stop.

   > No plan handoff on this ticket. Run `plan-issue` on it first.

2. Check the `pr-checks` skill is in the session's skill listing. Missing:
   stop before step 3 and say `apptension-sdlc` has to be installed in this
   harness.

Done when both pass.

## The execution method

Runs before step 3 when both hold:

- the plan came from `superpowers:writing-plans`: the design track, full
  mode, architectural;
- this run's mode is full.

Every other run skips this section. Other plans hold no task plan for an
execution skill to run, and reduced mode runs the plan inline per
[references/reduced-mode.md](references/reduced-mode.md).

Ask once, and wait for the answer:

> The plan is ready. Run it with subagent-driven development (a fresh
> subagent per task, reviewed between tasks) or inline in this session
> (`executing-plans`)? (subagent / inline)

Step 6 runs the plan under the answer: `superpowers:subagent-driven-development`
or `superpowers:executing-plans`. Done when the human has answered.

## 3. Workspace

Read [references/workspace.md](references/workspace.md) and follow it in
order: resolve the integration branch from the bindings' `Branching model`
row, prune merged worktrees, cut the branch off `origin/<integration
branch>` with `--no-track`, then add ignore rules for the planning working
files.

Name the branch `<type>/<slug>`. `<type>` is the work's commit type (`feat`,
`fix`, `docs`, `chore`, `refactor`, `ci`, `test`); `<slug>` derives from the
issue title. A Jira ticket adds its key, `feat/GA-240-stale-identity-after-deletion`,
so Jira links the branch. A GitHub issue reached under a Jira tracker has no
key and gets plain `<type>/<slug>`.

Done when the checkout is on the issue's branch and the ignore check printed
nothing or you named the lines you added.

## 4. Board to In progress and self-assign

Standalone only, before the first edit. Invoke the tracker skill's
`Assign to me`, then its `Move the ticket` to `In progress`. The tracker
skill carries every skip, announcement and stop. Under `dev-flow`,
`plan-issue` did both before the gate. Done when both operations returned.

## 6. Implement

Read the repo's bindings file (`CLAUDE.md` or `AGENTS.md`) before editing
and follow its rules on generated files, version bumps and layout.

Read a reference when its condition holds:

| Condition | Read |
|---|---|
| The change touches user-facing UI files | [references/ui-craft.md](references/ui-craft.md) |
| The track is micro | [references/micro-track.md](references/micro-track.md) |
| The mode is reduced | [references/reduced-mode.md](references/reduced-mode.md) |

Use `superpowers:test-driven-development` wherever the change is testable.
This bar holds on all three tracks.

- **Testable**: some automated check could observe the change fail (a
  return value, a rendered state, a generated artifact, an exit code).
  Write the test.
- **Not testable**: the only difference is visual (spacing, alignment,
  colour, ordering within one surface), or behaviour is unchanged by
  construction. Write a **QA note** under **Experience**: what you checked,
  how, at what viewport and theme, as observed ("checked at 360×640, light
  and dark; the cards no longer overlap at the breakpoint"). It replaces a
  test, never verification.

### Findings

Collect problems this issue never asked about, one line each: `path:line`
and what breaks. Step 10 offers the list once. Nothing reaches the tracker
before then, and filing needs the human's approval per `issue-authoring`.

A finding that blocks this issue: raise it now. Under `dev-flow`, tell the
human; standalone, per [references/standalone.md](references/standalone.md).

Done when every acceptance criterion has a passing test or a QA note.

## 7. Verify

Run the bindings' verification commands and read the output. A failure
goes to `superpowers:systematic-debugging`. **No PR opens on red.**

On the micro track, read [references/micro-track.md](references/micro-track.md)
first: it states which commands the touched paths bind. In reduced mode, read
[references/reduced-mode.md](references/reduced-mode.md): it states the
debugging discipline that replaces the skill.

If the optional `Verification skill` binding names a project-local
`SKILL.md`, drive the behaviour this change touches by its instructions, on
top of every `Verification` row command, and record the mapped features
exercised and surviving evidence with the results. A missing, unreadable or
out-of-repository path is a verification problem to resolve, not a skip.
An absent or `unknown` row: run the commands only. E2E suite authoring stays
with `apptension-e2e-testing`; live proof reuses existing project tools.

When UI files changed, affirm the craft checklist from
[references/ui-craft.md](references/ui-craft.md) under **Experience**.

Done when every command is green and its output read.

## 8. E2E tests

The `apptension-e2e-testing` plugin is optional. Without it, skip; the flow
continues under any `E2E` row value.

Run this step when all three hold:

- the bindings' `E2E` row names a spec dir, or is absent or `unknown` and
  the probe finds a scaffold (`not adopted` skips);
- the track is not micro;
- the run is not standalone.

Otherwise skip silently. A standalone run meeting the first two records its
Left undone line per [references/standalone.md](references/standalone.md).

The probe reads the bindings file's `### E2E bindings` `Location` row, else
the default `e2e/web/` with a Playwright config in any extension `e2e-setup`
accepts (`.ts`, `.js`, `.mjs`, `.cjs`). Found: run the step against that
suite. Not found: skip.

Once per issue, before anything else in this step, ask:

> This issue has E2E set up (`<spec dir>`) and isn't on the micro track.
> Write end-to-end tests for it? (yes / no — enter accepts no)

`no` skips the rest of the step and writes nothing; record "E2E tests —
skipped, human declined" on the PR body's **Left undone** line. `yes`: read
[references/e2e.md](references/e2e.md) and follow it.

Done when the step is skipped, declined, or `e2e.md` reaches its end.

## 9. Commit and push

Conventional Commits, one logical change per commit:

```bash
git commit -m "feat(scope): what changed"
git push -u origin HEAD
```

The subject is pure Conventional Commits on any tracker; the ticket reference
lives in the PR body. Done when the branch is pushed.

## 10. Draft PR, then board to In review

First, confirm the branch merges cleanly into the integration branch:

```bash
git fetch origin
git merge origin/<integration branch>
```

| Result | Do |
|---|---|
| `Already up to date` | Pass |
| Clean merge commit | Rerun step 7 on the merged tree, push, go on |
| Conflict | No draft PR while it stands. Resolve all, rerun step 7, commit the merge, push, go on |
| Conflict you cannot resolve | `git merge --abort`, report the conflicting paths, stop and ask |

Merge, never rebase, and never force-push.

Then the findings. Standalone: per
[references/standalone.md](references/standalone.md). Under `dev-flow`,
before the PR opens, show the human every step 6 finding at once, one line
each, in the order found:

```
Found along the way, none of it filed:
  1. `src/config.ts:88` — `timeout` is read as seconds, but every caller
     passes milliseconds.
  2. `docs/setup.md:12` — names a `make seed` target the Makefile lacks.

File any of these? (numbers to file, enter for none)
```

A picked number starts drafting: write the finding up in full (title,
body, label) and put it before the human per `issue-authoring`'s gate, a
second yes. An empty answer files nothing. Skipped findings go into Left
undone as collected. Approved ones are filed now, before the PR exists, and
noted next to Left undone once it opens.

Write the body per [references/pr-body.md](references/pr-body.md), which
picks its structure and decides the Agent context comment. The body must
carry every field below, whatever the structure's source:

| Field | Content |
|---|---|
| Ticket reference | What the tracker skill's `Ticket reference for a pull request` returns |
| Summary | What changed and why, ≤ 3 sentences |
| Design decision | Design track, full mode, architectural: the design in ≤ 2 sentences plus the spec reference: its local path, and in a standalone run a link to the Plan handoff comment, which a reviewer can open. Full mode bounded, or reduced mode: the two sentences only. Direct track: why it met all four criteria. Micro track: the named surface, and whether promotion fired |
| Experience | UI changes: states, imagery (or no-art), motion/a11y notes, 360×640 / theme checks. Otherwise "N/A — no user-facing UI" |
| Verification | `command → result` lines, no prose, per `superpowers:verification-before-completion` where available |
| Left undone | Deferred or out-of-scope work, every step 6 finding the human did not file, and a `Filed:` line per approved one (`#N` under GitHub, the full ticket URL under Jira), or "Nothing" |

The title stays pure Conventional Commits, with no ticket key. Write the
prose by `issue-authoring`'s Style rules (active voice, one name per thing,
one idea per sentence, plain words in the ASD-STE100 spirit).

Mark the issue Done or close it only when every acceptance criterion is
met **or** explicitly deferred. A deferred criterion goes to **Left
undone**, naming what was dropped and why. A follow-up issue for it is filed
only where the human approved that issue.

```bash
gh pr create --draft --base <integration branch> \
  --title "feat(scope): what changed" --body-file <path>
```

Always pass `--base` with step 3's integration branch, even when redundant.
Post the Agent context comment now if you decided on one.

Invoke the tracker skill's `Move the ticket` to `In review`. Then start the
`pr-checks` skill's monitor loop in this same session and run it to CI's
verdict. The PR stays in draft; a human takes it out.

Done when `pr-checks` reports CI's verdict.

## After the PR

Covered elsewhere:

- CI and review run; this session watches and fixes via `pr-checks`.
- A human merges. Under GitHub the closing keyword closes the issue and the
  card moves to Done; under Jira the client's integration or a human moves
  the ticket.
- Release and changelog.

Not part of this flow: auto-merge and any automatic ready-for-review flip.
