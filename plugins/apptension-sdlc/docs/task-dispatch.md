---
title: Dispatching an issue to a task orchestrator
area: dev-flow
summary: How an issue is handed off to run unattended, and when that is the right call.
plugin: apptension-sdlc
requires:
  - id: task-orchestrator
    label: Task orchestrator recorded in the repo bindings
    area: dev-flow
    optional: true
    detect:
      matches: '\|\s*Task orchestrator\s*\|'
      in: CLAUDE.md
    intent: >-
      A developer can hand an issue off to an agent that takes it to a draft
      pull request without holding a session open, instead of every issue
      needing someone present for the whole of its run.
  - id: cezar-workflow
    label: Orchestrator workflow for the development flow
    area: dev-flow
    optional: true
    detect:
      path: .ai/cezar/workflows/apptension-dev-flow.yaml
    intent: >-
      A handed-off run follows this repo's own development process and is
      gated by this repo's own verification commands, rather than by whatever
      the person dispatching it happened to type.
---

# Dispatching an issue to a task orchestrator

[`./dev-flow.md`](./dev-flow.md) takes an issue to a draft pull request inside a
live session: someone starts it and stays with it. Dispatch is the other way of
running the same flow — hand the issue to an orchestrator, which runs it in its
own worktree while the session that dispatched it closes.

The orchestrator owns execution. This page owns the process: what a correct
hand-off is, what a dispatched run may do without a human, and where its result
and its failures land.

## Dispatch is never required

**The bindings' `Task orchestrator` row records that this repo *can* dispatch. It
never decides that a given issue *will*.** Which path an issue takes is the
developer's call, every time:

- open a session and run [`./dev-flow.md`](./dev-flow.md) directly, or
- hand the issue off, from this process, from the orchestrator's own interface,
  or from a bookmarklet on the issue page.

Nothing in this SDLC prefers one. `dev-flow` does not redirect here, and carries
no "consider dispatching this" nudge; its only mention of dispatch describes how
it behaves once already dispatched. A repo with an orchestrator configured is a
repo where working an issue in a live session is unchanged and always available.

This is worth stating plainly because a capability recorded in a binding table
reads, to a reader looking for instructions, like an instruction. It is not one.

## Where a dispatched run executes, and what it costs

**On a subscription, on hardware you control. Never in CI.**

An orchestrator shells out to the agent CLI already logged in on the machine it
runs on. Two placements, both the same billing:

| Placement | What it is |
|---|---|
| A developer's machine | the orchestrator started in the repo, cockpit on localhost |
| A server you own | the orchestrator installed as a service, reached from a browser or a phone |

Running dispatch inside a CI workflow would move execution onto API credentials
and change what the work costs. That is the reason this stage sits on the other
side of a line the rest of this SDLC also draws: [`./issue-intake.md`](./issue-intake.md)
and [`./sdlc-docs-check.md`](./sdlc-docs-check.md) are CI workflows and are
billed as such; dispatch is not, and should not be made into one.

A dispatched run is not free in tokens either. A three-line probe task measured
at roughly 45k tokens. A real issue costs what working it in a session costs,
plus the orchestrator's own framing.

## When to hand an issue off

A choice, not a default. Judge it per issue:

| Suits a hand-off | Stay in a live session |
|---|---|
| A change on the micro or direct track, where the work is already pinned down | Anything you would want to steer while it happens |
| A design-track issue when you will not be at a keyboard for a while | Anything touching the orchestrator's own configuration |
| Work you would otherwise not start today at all | Work where watching it run is how you learn the area |
| A backlog you want moving while you are elsewhere | An issue whose acceptance criteria you are not sure of |

The costs to weigh against it:

- **A question has a short answer window.** A dispatched run that needs a
  decision parks and waits, but the live session behind it closes after roughly
  fifteen minutes of silence. The work is not lost — the run is resumable — but
  answering an hour later means resuming a task, not replying to one.
- **It occupies a worktree and a slot.** Orchestrators cap how many tasks run at
  once; a dispatched issue can sit queued behind others.
- **You lose the interruption.** The cheapest moment to correct a wrong approach
  is the moment it starts, and dispatch trades that away for not having to be
  there.

## Reading the `Task orchestrator` binding

Three states, following the convention [`./setup.md`](./setup.md) records for
`Branching model` and `Board`:

| Row | What it means | What to do |
|---|---|---|
| Names an orchestrator | Dispatch is available here | Offer it; never require it |
| `none` | The team was asked and chose not to dispatch | Dispatch is not offered, and not mentioned again. This is a settled answer, not a gap |
| Absent | The bindings predate the row — nothing ever looked | Dispatch is not offered. Work the issue in a session, which is what this SDLC did before the row existed |
| `unknown` | Setup looked and could not tell, and no human named one | Dispatch is not offered. Say so once, and continue in a session |

Four states, where the other bindings rows have three, because this is the one
row a team can answer *"we don't want one"* to. `none` and `unknown` behave
identically — neither dispatches — but only `unknown` is worth raising again.
Re-offering dispatch to a team that already declined it is how a useful prompt
turns into noise.

A row naming something other than Cezar is recorded as written and honoured as a
decision. `task-dispatch` will stop on it, because no process here knows how to
drive it yet, and it says exactly that rather than pretending the repo is
unconfigured.

**An `unknown` row here does not stop anything**, and that is the opposite call
from `Branching model`'s. The reason is what a wrong answer costs. A branch cut
from the wrong place is invisible until review and expensive to unpick, so that
row stops and asks. An orchestrator that is merely unavailable costs nothing at
all, because the attended path is right there and does the same work. This row
follows `Board`'s reasoning, not `Branching model`'s.

## Enabled and configured are different facts

A repo can have decided to dispatch without being set up to, and the two facts
live in different places:

- **The binding row is the repo's decision.** It is committed, so it travels with
  every clone and every developer sees the same answer.
- **The orchestrator's configuration is this machine's state.** It is git-ignored,
  so it travels with nothing. Each developer's checkout starts without it.

**This is why the second developer matters.** The first names an orchestrator,
is configured, and commits the bindings. Everyone who clones afterwards inherits
the decision and none of the configuration, and their setup run finds the row
already answered — so nothing asks, and nothing would be done either if the row
were the only fact consulted. [`./setup.md`](./setup.md) checks both, and
configures whenever the row names one and the machine lacks it.

The two checklist entries this page declares track the two facts separately, and
both are `optional:` — a repo that does not dispatch is not a repo with a gap.

**Two limits of those probes, stated rather than discovered later.** The row
probe is anchored to the table cell (`| Task orchestrator |`) rather than the
bare words, because a `matches:` probe reads a file's whole text: unanchored, the
prose on this very page describing the row would mark the binding present in any
repo that vendored it, and setup would then skip the adoption question and hide
a real gap. And the probe names one file, so a repo whose bindings live in
`AGENTS.md` cannot be seen by it — there the entry resolves unresolved and the
human settles it at the gate, which is the correct outcome but a slower one.

| State | Binding row (repo) | Config (machine) | What happens |
|---|---|---|---|
| Not adopted | absent or `unknown` | absent | Attended path only. Nothing reported |
| Declined | `none` | absent | Attended path only. Nothing reported, ever |
| Enabled, machine not configured | names one | absent | Attended path works. Dispatch stops and names the configuring step. **Setup configures it on the next run** — this is the state every developer after the first starts in |
| Enabled and configured | names one | present | Both paths available |
| Enabled, machine stale | names one | present but disagrees with the bindings | Dispatch stops on the mismatch. Setup reconfigures and reports which values moved |

**The `cezar-workflow` entry is only meaningful once the row names an
orchestrator.** A checklist probe cannot express that condition — it just looks
for a file — so the rule lives here: when the `Task orchestrator` row is `none`,
absent, or `unknown`, a missing workflow is **not applicable** rather than
missing, and setup says nothing about it. Reporting a missing orchestrator
workflow to a team that declined an orchestrator is the same nagging the `none`
answer exists to stop.

The middle row is the one worth designing for: it is what a repo looks like
between deciding and finishing, and between one developer setting it up and the
next one cloning.

## The hand-off

### 1. Read the issue

[`./dev-flow.md`](./dev-flow.md) step 1, unchanged: title, body, labels, area,
any spec or plan it links, and every comment — including each `**Agent
context**` comment, which is where the execution detail lives.

The reading is not a formality here. It is what separates a hand-off from a
click: the confirmation in step 4 is only worth anything because an agent has
already read the issue when it is asked for.

### 2. Pre-flight

`dev-flow` step 2 in full — the plugin check, the issue open with no pull
request attached, acceptance criteria that read as requirements, dependencies
resolved, a clean tree and a fetched `origin`. Then three checks of this
process's own:

- the `Task orchestrator` row resolves to a **supported** orchestrator;
- that orchestrator is reachable;
- its configured base branch matches the `Branching model` row.

Read the row from the bindings file the repo actually uses — `CLAUDE.md`, or
`AGENTS.md` where [`./setup.md`](./setup.md) wrote there. Resolve the file
first; do not assume one.

**Check `none` before any of them.** A `none` row is a settled decision not to
dispatch, so it is not a failed check and must not be reported as one:

> This repo works its issues in live sessions — its bindings decline an
> orchestrator. Working #N here with `dev-flow`.

Then work the issue, or hand back. Never name `cezar-setup` on this path.
Re-offering setup to a team that already declined it is what the `none` state
exists to prevent, and a generic failure branch would do exactly that on every
invocation.

**A row naming an unsupported orchestrator is also not a setup gap.** Say what
it names and that no process here drives it, and offer the attended path. Do not
suggest configuring Cezar for a repo that chose something else.

**Any of the three checks failing stops this skill and nothing else.** Say which
failed, name `cezar-setup` as the remedy, and offer to work the issue here with
`dev-flow` instead. None of them is a reason the issue cannot be worked — they
are reasons it cannot be *handed off* right now, which is a much smaller claim.

The base-branch check earns its place: a mismatch is silent. The run opens a
pull request that exists, looks right, and targets a branch nobody expected.

### 3. Run the design gate

`dev-flow` step 5, unchanged, with all three of its outcomes.

### 4. State the call and wait

State the track and the reason in one line, and **wait for confirmation — on
every track, including micro.**

The micro track normally waives that confirmation, and this process
deliberately takes the waiver back. `dev-flow` grants it because the human named
the surface in the same breath as the request and can correct an attended run
the moment it goes wrong. A dispatched run cannot be corrected that way: the
correction arrives, if at all, after the work. So the waiver's justification
does not survive the hand-off, and the human is standing right here anyway,
which makes the round trip nearly free.

This is the whole human sanction for the run. Spending it costs one line.

### 5. Take ownership

Self-assign the issue and move its board card to In progress under `dev-flow`
step 4's three `Board` states.

Do this here rather than inside the run. The card should move when the work is
queued, not when a worker happens to pick it up, and `@me` resolves to a real
person in this session and to nobody in a dispatched one.

### 6. Dispatch, and return

Fire the orchestrator with **autonomous mode off**, passing a prompt that
carries the issue number, the resolved track, and the record of who sanctioned
it. Return where the run can be watched, and stop. The session may close.

### 7. Record the hand-off on the issue

**After** dispatching, post a comment recording the task id, the resolved
track, and who confirmed it.

**The order matters and is not cosmetic.** The task id does not exist until the
orchestrator has been given the work, so a comment written before step 6 cannot
carry the one field that makes it useful. This is the audit trail — it is what
makes a run that later dies without reporting anything still traceable — and an
audit trail missing its identifier is decoration.

If dispatch fails, there is no id and no run, so there is nothing to record:
undo step 5's ownership rather than leaving an assigned issue and a moved card
pointing at work that never started.

**Autonomous off is the load-bearing choice in this whole process.** Turned on,
the orchestrator injects an instruction to make reasonable assumptions and keep
going, and nudges the run past every point where it would have stopped. Turned
off, the run keeps `dev-flow`'s stops, and each one becomes a task waiting for
an answer: visible, attributable, and resumable from a phone. The stops did not
need designing away. They needed somewhere to land.

Offer running the same task as two or three parallel variants when the issue is
risky or design-track: the orchestrator runs them in separate worktrees and the
diffs are compared side by side. Variants share the task's agent backend.

## The design track, dispatched

A dispatched design-track issue does **not** run `superpowers:brainstorming`.

The reason is cadence, not principle. Brainstorming asks one question per
message, gates after each design section, and gates again on the written spec:
ten or more round trips. Attended, that is a good conversation. Dispatched, each
round trip is a task parked against an answer window measured in minutes, and
the whole thing degrades into a chain of expired sessions and a design nobody
finished.

So the dispatched design track is plan-first:

1. Read, pre-flight, explore.
2. Write the plan with `superpowers:writing-plans`, which is generative rather
   than a dialogue. The plan must carry an **Approaches considered** section and
   an **Assumptions** section — that is where brainstorming's analytical value is
   preserved, even though its conversation is not.
3. Post the plan as a comment on the issue, where it is durable and where the
   people who care about the issue already look.
4. End the turn with a structured question: proceed, revise, or stop.
5. Answered, it implements in the same session and continues into `dev-flow`
   steps 6 to 9. Unanswered, it sits as a task needing attention, and is picked
   up whenever.

**Do not have a second agent answer the questions.** An agent inventing product
intent, confidently, with nobody reading, is the failure this whole design is
arranged to avoid. A second agent is useful as a *critic* of a design, which is
a different job and one the orchestrator supports per step.

## Where a dispatched run's result and failures land

Three layers, none of them built by this toolkit:

1. **The orchestrator's waiting state.** Every `dev-flow` stop lands here,
   flagged as needing attention in the console and on a phone.
2. **A comment on the issue**, at every terminal state the run can reach: the
   pull-request link on success, the reason on a stop, the last error on a
   failure. This is the layer that does not depend on anyone opening the
   orchestrator, and it is why the hand-off comment in step 5 exists.
3. **The orchestrator's own notifications**, for a run that dies outright.

**One gap, stated rather than papered over:** a run killed by the machine, by a
cancel, or by a crash posts nothing on the issue, because nothing is left
running to post it. It is visible in the console, and the hand-off comment names
the task id, so it can be found. Closing that gap would mean building a
reconciler — which would mean owning the runner, which is exactly what this
process does not do.

## Opening the cockpit

The `cezar-cockpit` skill opens the orchestrator's console for the repo it is
configured in.

**It looks like a one-line wrapper and is not.** One cockpit serves *every*
registered repo, each at its own path, from a per-user registry outside the
repo. The port auto-picks the next free one when the default is busy. So
starting the cockpit blindly in a second repo does not focus that repo — it
starts a **second cockpit** on a different port, with an overlapping project
list, and now two URLs both look right and disagree about what is running.

Almost always the correct action is therefore to find the cockpit that is
already up and return this repo's URL within it.

1. **Read the `Task orchestrator` row**, from whichever bindings file the repo
   uses. `none`: this repo declined an orchestrator — say so and stop, without
   naming `setup` or `cezar-setup`; there is nothing to configure. Absent or
   `unknown`: say the repo is not enabled for one and name
   [`./setup.md`](./setup.md). An unsupported name: say what it names and that
   no process here drives it. All three are answers, not failures, and none of
   them starts a cockpit.
2. **Check the repo is configured.** No orchestrator configuration: point at
   `cezar-setup` rather than starting anything.
3. **Look for a running cockpit before starting one.** If one is up, make sure
   this repo is registered with it, and return **this project's** URL.
4. **Otherwise start it in the background** and report the URL. Never block the
   session on a server that runs until someone stops it.
5. **Resolve the binary** from what is installed, falling back to running it
   through the package runner.

The CLI surface this relies on: the default subcommand starts the cockpit, a
port flag overrides the default, a no-open flag suppresses the browser, and a
projects subcommand lists, adds and removes the repos one cockpit serves.

Nothing here obliges anyone to use the cockpit. Dispatch works headless, and the
console exists for watching, answering and reviewing when that is what you want.

## Configuring the orchestrator

Run once per repo, per machine, by the `cezar-setup` skill.

**Normally you never invoke it.** [`./setup.md`](./setup.md) runs this procedure
itself when its gate answer names an orchestrator, having named the write as one
of the effects that gate confirms — so adopting the SDLC and configuring dispatch
are one conversation, not two. Invoke the skill directly for the case setup
cannot cover: **re-running it after `Branching model` or `Verification` changes**,
so Cezar's copies of those values stop drifting from the bindings that own them.

**The reason this is a process step and not a paragraph of instructions: the
orchestrator stores values the bindings already own.**

| Orchestrator setting | The binding it duplicates | What drift costs |
|---|---|---|
| Base branch | `Branching model`'s integration branch | Task worktrees fork from, and pull requests target, the wrong branch. Nothing fails: the PR opens, looks correct, and goes to the wrong reviewers |
| The verification check | `Verification` | The gate that exists to be unfakeable is testing the wrong thing |

This is not hypothetical. Measured on a real dispatched run with no base branch
configured, the task worktree forked from **whatever branch happened to be
checked out**, not from the integration branch. So every value below is
*derived* from the bindings, never typed, and never carried over from an
example.

1. **Probe the prerequisites.** The orchestrator binary, an agent CLI that is
   logged in, and `gh` authenticated. Name whatever is missing rather than
   failing outright — the orchestrator degrades gracefully and so should this.
2. **Read the bindings.** Absent and `unknown` rows follow the three-state rules
   above.
3. **Write the orchestrator config**, taking its base branch from the
   `Branching model` row. If that row is `unknown`, stop and ask, exactly as
   [`./dev-flow.md`](./dev-flow.md) step 3 does — this is the one value here
   worth stopping for, and for the same reason. Record the **agent backend** the
   team actually uses rather than defaulting to one, and set the **team skills
   list** per the route this repo uses — both are covered below.
4. **Write the workflow**, taking the check step's command from `Verification`.
5. **Confirm the dispatched run can reach the skills, on the backend this repo
   will actually use.** A run that cannot load `dev-flow` will still start, and
   will improvise the process instead of following it, which is worse than not
   running at all. This is a per-backend fact, not a per-repo one: establishing
   it on one agent CLI says nothing about another.
6. **Record the `Task orchestrator` row** if it is not already there.
7. **Live-verify.** Dispatch one trivial task and confirm three things: it ran,
   the skill loaded, and the check step executed. A configuration that has never
   been exercised is a guess with a file behind it.

All of it behind one approval that names every file it will write.

### The run's agent is not always Claude Code

An orchestrator picks which agent CLI executes a step, and the toolkit supports
several harnesses on purpose — see [`./prerequisites.md`](./prerequisites.md),
which already carries a per-harness install path for every process here. Cezar
can drive Claude Code, Codex, OpenCode or pi, chosen per repo, per task, or per
workflow step.

**The question that decides everything else is: how does `dev-flow` reach the
dispatched run on this backend?** There are two routes, and which one applies is
a property of the harness, not of this process:

| Route | How it works | Where it applies |
|---|---|---|
| **Harness plugin** | The agent CLI loads the plugin from its own installation, and the run invokes `dev-flow` as a first-class skill | Verified on Claude Code. Any harness whose CLI loads the toolkit's plugin the same way |
| **Skills repo** | The orchestrator reads `SKILL.md` files out of a git repo and supplies them to the run | Every harness, including those with no plugin mechanism the orchestrator can reach |

`cezar-setup` establishes which route this repo uses **before** writing the
workflow, and its live-verify step is what proves it — a run that cannot load
`dev-flow` still starts, and improvises the process instead of following it,
which is the worst of the available outcomes.

Two backend differences worth knowing, because they invalidate reasoning carried
over from Claude Code:

- **Tool allowlists are not portable.** Codex ignores an allowlist entirely,
  OpenCode auto-approves every permission, and pi maps it onto its own
  mechanism. So "the default allowlist is fine" is a finding about one backend,
  not a property of dispatch. Where a step needs a tool restriction to be real,
  check what the chosen backend actually enforces.
- **The orchestrator's own control markers are portable.** The parking and
  question markers are handled by the orchestrator above the backend seam, so
  the human-in-the-loop behaviour this process depends on is the same whichever
  agent runs.

**Record the backend in the config rather than defaulting to it silently.** A
repo whose team works in Cursor or Codex should not have a Claude Code default
written into its orchestrator config by a setup run that never asked.

### Why the vendor team skills list is emptied

Cezar ships a **default team skills repo**, and that repo is not a set of
utilities. It is a complete, differently-opinionated SDLC: dozens of skills
implementing its own ticket lifecycle, its own mutually-exclusive pipeline
label state machine, a claim protocol, a QA gate, its own config surface, and
a skill that squash-merges an approved pull request.

Leaving it enabled puts two SDLCs side by side in one cockpit, one of which
auto-merges — something [`./dev-flow.md`](./dev-flow.md) rules out in as many
words. Nothing injects those skills into a run this process starts, because the
workflow names no `skill:`. The exposure is a human picking one from the
catalogue, or a workflow built by drag-ordering skills in the console, and
finding a parallel process sitting next to this one with no sign of which is
which.

So `cezar-setup` **removes the vendor default**. What it writes in its place
depends on the route from the section above, and this is the part to get right:

| Route this repo uses | Team skills list |
|---|---|
| Harness plugin | Empty. The run gets `dev-flow` from the plugin, so no skills repo is needed at all |
| Skills repo | **The toolkit**, and only the toolkit. Emptying it here would remove the run's only route to `dev-flow` |

Emptying the list unconditionally is the trap: on a harness that has no plugin
route the orchestrator can reach, the skills repo *is* how the process arrives,
and a blanket empty turns a working dispatch into a run that improvises. Remove
the rival SDLC; do not remove the one you are trying to run.

This is a **default, not a prohibition.** A team that wants those skills can
add the repo back deliberately; what they should not get is a second SDLC by
accident, because a config file they never opened shipped with one. Their
process ideas are worth reading — some of them are things this SDLC does not do
yet — and borrowing an idea is different from installing a rival pipeline.

**Do not run the repo's verification suite as part of this.** Configuring an
orchestrator is a two-file write, and a full lint-and-test run is out of
proportion to it — on a large repo that is minutes of someone's time for a
result that expires almost immediately. It would also be measuring the wrong
thing: this runs in a working tree that may carry uncommitted work, so a red
result says nothing about the baseline a dispatched run would fork from. The
suite gets run by the dispatched run itself, which is where a failure carries
its own output and its own context.

Instead, **echo the check command in the approval**, so the human sees what will
gate every dispatched run before agreeing to it:

> Dispatched runs will be gated by: `npm run lint && npm test`

### The workflow

```yaml
name: apptension-dev-flow
description: Take a GitHub issue to a draft PR under the Apptension SDLC.
steps:
  - id: dev-flow
    name: Issue to draft PR
    prompt: |
      Invoke the apptension-sdlc:dev-flow skill and follow it to completion
      for: {{task}}
  - id: verify
    name: Verify
    command: "<the Verification row's commands, joined with &&>"
    onFail: { retry: dev-flow, max: 2 }
```

**The check step is verification the agent cannot fake — after the fact, not
instead of the flow's own.** `dev-flow` step 7 already requires verification,
but its evidence is the agent's own report of its own work. Here the
orchestrator runs the command itself and loops back on a non-zero exit.

Be precise about when it runs. Steps execute in order, and `dev-flow` opens the
draft pull request at its own step 9 — so the check step runs **after the pull
request already exists**. It does not prevent a red pull request; `dev-flow`
step 7's "no PR opens on red" is still the only thing that does. What it catches
is a run that reported green and was not, and its remedy is the bounded retry
loop that sends the failing output back for another attempt.

**The retry only works because `dev-flow` treats that re-entry as a resume.**
Sending a run back into `dev-flow` after it has opened a pull request would
otherwise hit its own pre-flight — "the issue is open and has no pull request
already attached" — and stop, making the repair unreachable and every failed
check a dead run. `dev-flow`'s "Running dispatched" section carries the rule
that closes this: re-entry that finds *its own* branch's pull request hands off
to `pr-checks` rather than restarting or stopping. A retry configured against a
flow without that rule repairs nothing.

### When every dispatched run fails at the check step

The failure mode worth recognising, because it does not look like what it is: a
verification suite that is **already red for reasons unrelated to any change**
fails the check step of every dispatched run. Each run then looks like the
dispatched change broke something, the retry loop burns its two attempts trying
to fix a fault the change did not cause, and the run ends failed.

It reads as "dispatch is broken". It is not.

The tell is that every run fails the same way regardless of what it changed.
Confirm it in one step — run the check command yourself on a clean checkout of
the integration branch:

```bash
git stash --include-untracked        # or use a scratch worktree
<the check command from the workflow>
```

Red there means the suite is the problem and no amount of dispatching will get
past it. Fix the suite, then dispatch.

Configuration does not pre-empt this by running the suite for you: that would
cost minutes on every setup for a result that expires almost immediately, and
would measure a working tree rather than the branch a run forks from.

**One agent step plus any number of check steps is deliberately not a chain.**
Adding a second *agent* step would make it one, and a chain gives each step its
own session — which costs the continuity this flow depends on, since `dev-flow`
carries state from pre-flight all the way to the pull-request body.

**No skill field, and no tool allowlist — on the Claude Code backend.** Both
were measured rather than assumed, and the measurement was taken on that backend
only; see "The run's agent is not always Claude Code" below before assuming it
transfers. The plugin already puts `dev-flow` in the dispatched session, so
injecting a second copy of it as a system prompt would compete with the real
one; and the orchestrator's default tool allowlist is a *permission* list that
does not gate skill invocation at all. Adding either would be cargo.

## What a dispatched run does differently

One thing, and only one: the design gate's confirmation was given at hand-off, so
the run reads the resolved track instead of stopping to ask for it. Everything
else — pre-flight, the craft checklist, test-driven development, verification,
the commit convention, the pull-request body — is unchanged. See
[`./dev-flow.md`](./dev-flow.md), "Running dispatched".

A dispatched run that hits one of `dev-flow`'s stops still stops. It ends its
turn without claiming completion, and the orchestrator surfaces that as a task
needing attention. A stop is never a licence to guess just because nobody is
watching.
