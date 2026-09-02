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
---

# Dispatching an issue to a task orchestrator

[`./dev-flow.md`](./dev-flow.md) takes an issue to a draft pull request inside a
live session: someone starts it and stays with it. Dispatch runs **that same
flow**, unchanged, in an orchestrator's own worktree, while the session that
started it closes.

**Dispatch is a place to run the process, not a variant of it.** `dev-flow` is
one flow with one design gate and three tracks, and none of them asks where the
run is executing. Nothing is waived, nothing is overridden, and no step behaves
differently because nobody is watching. What dispatch changes is where a
question waits: a stop becomes a task flagged for attention instead of a session
holding a prompt, and it is answered whenever someone gets to it — from a phone
if that is where they are.

The orchestrator owns execution. This page owns the surrounding facts: when a
hand-off suits, what it costs, how a repo records and configures one, and where
a run's result and its failures land.

## Dispatch is never required

**The bindings' `Task orchestrator` row records that this repo *can* dispatch. It
never decides that a given issue *will*.** Which path an issue takes is the
developer's call, every time:

- open a session and run [`./dev-flow.md`](./dev-flow.md) directly, or
- start the same flow in the orchestrator's own interface, or from a bookmarklet
  on the issue page.

Nothing in this SDLC prefers one. `dev-flow` does not redirect here and carries
no "consider dispatching this" nudge — it does not mention dispatch at all,
because there is nothing it would need to say. A repo with an orchestrator
configured is a repo where working an issue in a live session is unchanged and
always available.

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
decision. Nothing here knows how to configure it, so `cezar-setup` says exactly
that rather than pretending the repo is unconfigured — and the attended path is
unaffected either way.

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

Only the repo's decision is a checklist entry, and it is `optional:` — a repo
that does not dispatch is not a repo with a gap. The machine's configuration is
deliberately not one: a checklist records artifacts a commit can add to a repo,
and git-ignored machine state is not one of those. [`./setup.md`](./setup.md)
reads it directly instead.

**Two limits of that probe, stated rather than discovered later.** It is
anchored to the table cell (`| Task orchestrator |`) rather than the bare words,
because a `matches:` probe reads a file's whole text: unanchored, the prose on
this very page describing the row would mark the binding present in any repo
that vendored it, and setup would then skip the adoption question and hide a
real gap. And the probe names one file, so a repo whose bindings live in
`AGENTS.md` cannot be seen by it — there the entry resolves unresolved and the
human settles it at the gate, which is the correct outcome but a slower one.

| State | Binding row (repo) | Config (machine) | What happens |
|---|---|---|---|
| Not adopted | absent or `unknown` | absent | Attended path only. Nothing reported |
| Declined | `none` | absent | Attended path only. Nothing reported, ever |
| Enabled, machine not configured | names one | absent | Attended path works. `cezar-cockpit` names the configuring step rather than starting anything. **Setup configures it on the next run** — this is the state every developer after the first starts in |
| Enabled and configured | names one | present | Both paths available |
| Enabled, machine out of step | names one | present, but different from what the bindings derive | Attended path is unaffected. `cezar-setup` brings it back into step and reports which values moved |

The middle row is the one worth designing for: it is what a repo looks like
between deciding and finishing, and between one developer setting it up and the
next one cloning.

## Starting a run

A person starts a run in the orchestrator's own interface: pick `dev-flow` from
its skill list, pass the ticket, and go. The ticket reference is the whole of
the input, and `dev-flow` reads the ticket itself, runs pre-flight, passes the
design gate and asks its own questions, exactly as it does attended.

**Which references are accepted is [`./dev-flow.md`](./dev-flow.md) step 1's
rule, not this page's.** It is a property of the argument and the repo's
`Issue tracker` binding, and it is worth knowing before typing one: a bare
number is this repo's GitHub issue under a GitHub tracker, and a **stop** under
a Jira one — where `400` is a perfectly good GitHub issue number that would
fetch a real, existing, wrong ticket. Under Jira, pass the key or a URL.

So the flow's own first two steps are where a badly-formed issue gets caught, on
this path as on the other. An issue whose acceptance criteria read as an open
question fails pre-flight, and the run stops with a question for whoever started
it.

**The design gate runs inside the run.** It is the same gate with the same three
tracks: the run states its call and waits, and the answer arrives through the
orchestrator's interface. The micro track keeps its own narrow waiver, as
[`./dev-flow.md`](./dev-flow.md) grants it, and promotion still ends that track
the moment the change leaves the named surface.

**Autonomous mode is the only lever over how much a run asks.** Left off, every
stop the flow makes becomes a task flagged for attention and answered by a
person. Turned on, the orchestrator injects its own instruction to make
reasonable assumptions and keep going, which nudges a run past points where it
would have stopped — including the design gate. That is a real setting with a
real cost, and it belongs to whoever starts the run. No skill here turns it on,
and no skill here reads it.

**Parallel variants suit a risky or design-track issue.** The orchestrator runs
the same issue two or three times in separate worktrees, and the diffs are
compared side by side. Variants share the task's agent backend.

**A second agent is a critic, never an answerer.** An agent inventing product
intent, confidently, with nobody reading, is the failure this whole design is
arranged to avoid. Reviewing a design is a different job, and one the
orchestrator supports per step.

## How a question reaches a person

The orchestrator turns the harness's own question mechanism into something a
person can answer in its interface. On the Claude Code backend it detects
`AskUserQuestion` and renders it directly.

**This is per-backend, not a property of dispatch.** Other backends have their
own equivalents and the orchestrator does not translate all of them yet, so a
run on one of those can stop in a way that is visible but not answerable in the
interface. Check it on the backend a repo actually uses — `cezar-setup`'s
live-verify is where that gets established.

No skill here emits a marker, a sentinel, or any other text meant to be parsed
by the orchestrator. A skill asks its question through the harness, and
translating it is the orchestrator's job. Text-parsed markers are fragile in a
way that matters here: a stray character turns a question into prose, the turn
ends, and a run carries on without the answer it was waiting for.

## Where a dispatched run's result and failures land

Three layers, none of them built by this toolkit:

1. **The orchestrator's waiting state.** Every `dev-flow` stop lands here,
   flagged as needing attention in the console and on a phone.
2. **The issue itself**, which the flow updates as it goes: the board card moves,
   the draft pull request carries its closing keyword, and `dev-flow` step 9's
   body records what was decided. This is the layer that does not depend on
   anyone opening the orchestrator.
3. **The orchestrator's own notifications**, for a run that dies outright.

**One gap, stated rather than papered over:** a run killed by the machine, by a
cancel, or by a crash leaves the issue wherever the flow had got to, because
nothing is left running to move it on. It is visible in the console, and the
orchestrator's task list holds the run, so it can be found and resumed. Closing
that gap would mean building a reconciler — which would mean owning the runner,
which is exactly what this process does not do.

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
2. **Check the repo is configured, and still in step.** No orchestrator
   configuration: point at `cezar-setup` rather than starting anything. A
   configuration that differs from what the bindings now derive — most often a
   `Branching model` that moved after it was written: say which values differ,
   name `cezar-setup`, and go on to open the cockpit anyway.

   **Report, do not refuse — and be clear what this does not cover.** A base
   branch that has drifted is the silent failure this page keeps returning to:
   the run forks from the wrong branch, and the pull request opens, looks
   correct, and goes to the wrong reviewers. Saying so at the door is worth
   one line. But the door is not a gate: a run is launched in Cezar's own
   interface, so nothing here can stop that launch, and the cockpit is opened
   to answer a question or watch a run at least as often as to start one.
   Refusing to open it would block the answering and still not prevent the
   launch.
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
cannot cover: **re-running it after `Branching model` changes**, so Cezar's copy
of that value stops drifting from the binding that owns it.

**The reason this is a process step and not a paragraph of instructions: the
orchestrator stores a value the bindings already own.**

| Orchestrator setting | The binding it duplicates | What drift costs |
|---|---|---|
| Base branch | `Branching model`'s integration branch | Task worktrees fork from, and pull requests target, the wrong branch. Nothing fails: the PR opens, looks correct, and goes to the wrong reviewers |

This is not hypothetical. Measured on a real dispatched run with no base branch
configured, the task worktree forked from **whatever branch happened to be
checked out**, not from the integration branch. So every value below is
*derived* from the bindings, never typed, and never carried over from an
example.

**It converges; it does not migrate.** Every run brings the repo to the state
these steps describe, whatever state it starts in, and re-running is the
ordinary case rather than a repair. That is why there is nothing here about
previous shapes: the procedure is defined by where it lands, so a repo
configured under any earlier scheme reaches the same place on its next run.

1. **Probe the prerequisites.** The orchestrator binary, an agent CLI that is
   logged in, and `gh` authenticated. Name whatever is missing rather than
   failing outright — the orchestrator degrades gracefully and so should this.
2. **Read the `Task orchestrator` row, and stop unless it sanctions this.**
   Convergence applies to the configuration, never to the repo's decision — the
   row is an input here, not a value this procedure derives:

   | Row | What this procedure does |
   |---|---|
   | Names Cezar | Configure |
   | `none` | **Stop.** Configure nothing and write nothing. The row is a settled decision, and it is not this procedure's to revisit |
   | Names another orchestrator | **Stop.** Say what it names and that nothing here configures it |
   | Absent or `unknown` | The request to configure Cezar is itself the answer, but the row is committed — so confirm it as part of the one approval below, then configure |

   The two stops matter because this procedure is safe to re-run, which means
   it will be re-run in repos nobody thought about when they typed the command.
   A run that configured Cezar because someone asked it to would quietly
   reverse a team's decision not to dispatch, or point a repo that chose
   another tool at this one. Adopting an orchestrator is
   [`./setup.md`](./setup.md)'s gate, and it stays there.

   Every other row follows the three-state rules above.
3. **Write the orchestrator config** — `.ai/cezar/config.json`, and nothing
   else. Its base branch comes from the `Branching model` row; if that row is
   `unknown`, stop and ask, exactly as [`./dev-flow.md`](./dev-flow.md) step 3
   does — this is the one value here worth stopping for, and for the same
   reason. Record the **agent backend** the team actually uses rather than
   defaulting to one, and point the **team skills list** at the toolkit's
   published repo. Both are covered below.
4. **Account for everything else in `.ai/cezar/`.** That directory should hold
   this one config file plus the orchestrator's own run state, which its
   `.gitignore` enumerates. Anything else is either scaffolding — Cezar's own
   `init` writes an example workflow and skill — or something the team wrote.
   Name what is there and let the human say which it is. Remove only what they
   release, and never anything they claim. Asked as a question it costs one line
   on a re-run; reported as a finding it would be nagging.
5. **Confirm the run can reach the skills, on the backend this repo will
   actually use.** A run that cannot load `dev-flow` will still start, and will
   improvise the process instead of following it, which is worse than not
   running at all. This is a per-backend fact, not a per-repo one: establishing
   it on one agent CLI says nothing about another.
6. **Bring the `Task orchestrator` row up to date with what was configured** —
   the command that starts a run, and where the config lives. Step 2 has
   already established that the row sanctions Cezar, so this rewrites *how*
   this repo reaches its orchestrator and never *which* orchestrator it chose.
   A row that names Cezar keeps naming Cezar.
7. **Live-verify, with a task that asks something.** Start one trivial task and
   confirm three things: it ran, the skill loaded and was followed, and **a
   question it asked arrived in the interface and its answer got back to the
   run**. Give the probe a reason to ask one; do not hope it does.

   A task that asks nothing exercises none of the transport, and passes on a
   backend where the transport does not work — after which the first real run
   reaches its design gate and hangs on a question nobody can see, with the
   configuration reporting success. That is the half worth proving, because it
   is the half this whole process depends on: every stop the flow makes is a
   question, and a stop that cannot be answered is a dead run. A configuration
   that has never been exercised is a guess with a file behind it, and one
   exercised by a silent task is a guess about the part that matters.

**Name what the harness must install for itself.** A skills repo supplies only
what it carries, so the plugins a run depends on are the operator's job — and
`superpowers` above all, whose skills `dev-flow` invokes by name at the design
gate, at implementation and on every failure route. See
[`./prerequisites.md`](./prerequisites.md) for the per-harness install path.
Saying this at configuration time is the difference between a run that stops on
a missing plugin at pre-flight and a person wondering why dispatch is broken.

**Do not run the repo's verification suite as part of this.** This writes one
small config file, and a full lint-and-test run is out of proportion to it — on
a large repo that is minutes of someone's time for a result that expires almost
immediately. It would also measure the wrong thing: this runs in a working tree
that may carry uncommitted work, so a red result says nothing about the branch a
run would fork from. The suite gets run by the flow itself at
[`./dev-flow.md`](./dev-flow.md) step 7, and again by CI on the pull request,
which is where a failure carries its own output and its own context.

All of it behind one approval that names every file it will write, remove and
edit, and reports which values moved.

### The run's agent is not always Claude Code

An orchestrator picks which agent CLI executes a step, and the toolkit supports
several harnesses on purpose — see [`./prerequisites.md`](./prerequisites.md),
which already carries a per-harness install path for every process here. Cezar
can drive Claude Code, Codex, OpenCode or pi, chosen per repo or per task.

**How `dev-flow` reaches a run is two mechanisms working together, not a choice
between them.** A skills repo is both a lookup and an injector, and the two
halves answer different questions:

| The repo's job | What it does |
|---|---|
| **Lookup** | The interface's skill list is read from the skills repo. A skill the repo does not carry cannot be picked, whatever the harness has installed |
| **Injector** | For a run whose harness lacks the skill, the orchestrator supplies the `SKILL.md` out of the repo |

So the repo is configured on **every** backend, including one whose harness
already has the plugin installed: without it there is nothing in the list to
pick. And because the injector can only supply what the repo carries, a skill
that invokes another plugin's skills still needs those installed in the harness
— which is what the note on the operator's own installs above is about.

`cezar-setup`'s live-verify step is what proves the whole path — a run that
cannot load `dev-flow` still starts, and improvises the process instead of
following it, which is the worst of the available outcomes.

One backend difference worth knowing, because it invalidates reasoning carried
over from Claude Code: **tool allowlists are not portable.** Codex ignores an
allowlist entirely, OpenCode auto-approves every permission, and pi maps it onto
its own mechanism. So "the default allowlist is fine" is a finding about one
backend, not a property of dispatch. Where a step needs a tool restriction to be
real, check what the chosen backend actually enforces.

**Record the backend in the config rather than defaulting to it silently.** A
repo whose team works in Cursor or Codex should not have a Claude Code default
written into its orchestrator config by a setup run that never asked.

### What the team skills list points at

Cezar reads its skill list from one or more repos, plus any local skill
directories the repo carries. This repo's list names **the toolkit's published
marketplace repo, `apptension/apptension-sdlc`**, and Cezar's own default —
`open-mercato/skills` — is removed from it.

That default is not a set of utilities. It is a complete,
differently-opinionated SDLC: dozens of skills implementing its own ticket
lifecycle, its own mutually-exclusive pipeline label state machine, a claim
protocol, a QA gate, its own config surface, and a skill that squash-merges an
approved pull request.

Leaving it in place puts two SDLCs side by side in one interface, one of which
auto-merges — something [`./dev-flow.md`](./dev-flow.md) rules out in as many
words. The exposure is a person picking one out of the list and finding a
parallel process sitting next to this one with no sign of which is which. That
is a bad outcome to arrive at by accident, from a config file nobody opened.

It is a **default, not a prohibition.** A team that wants those skills can add
the repo back deliberately. Their process ideas are worth reading — some of them
are things this SDLC does not do yet — and borrowing an idea is different from
installing a rival pipeline.

Anything else a team has added to the list is theirs and stays. What this
procedure guarantees is that the toolkit is in the list and the rival SDLC is
not.

### What a consuming team gets

The published repo is **generated, never hand-maintained**: a `v*` tag builds it
from `marketplace.yaml` and replaces its contents. So pointing Cezar at it
imports whatever the last release published, and nothing a person edited by
hand.

The release itself has its own page,
[`./release-publish.md`](./release-publish.md) — site-only, and not bundled into
this plugin, so an agent reading this copy has the sentence above and nothing
else to follow.

Two consequences worth knowing before adopting it:

- **The plugin boundary does not survive the import.** Cezar has no concept of a
  plugin — it scans the repo for skill files and presents what it finds as one
  flat list. A team that wants `dev-flow` also sees every other skill the
  release published, in the same list, with no grouping.
- **The publish set is what bounds that list.** Which plugins a release publishes
  is decided in `marketplace.yaml`, so the length of the list is a decision made
  there rather than a property of Cezar.

Alternatives were weighed and rejected. Pointing Cezar at this development repo
would import every skill it tracks, released or not, including work in progress.
Skipping the skills list entirely works only for a harness that already has the
plugin, and it leaves the interface's own list empty — so nothing can be picked,
which is the path a person actually uses.
