---
name: plan-issue
description: Manual skill, run when the human names it or dev-flow invokes it. Working a ticket end to end is dev-flow. Plans a ticket through the design gate, and run on its own posts the plan to the ticket for a later implement-issue run.
---

# Plan a ticket

Take a ticket through the design gate to a plan the human approved.
`implement-issue` takes that plan to a draft PR. This skill only plans:
it leaves every commit and every execution skill to `implement-issue`.

## Two ways to run

The run is under `dev-flow` when `dev-flow` invokes this skill and says so,
and standalone otherwise. Standalone, read
[references/standalone.md](references/standalone.md) before step 1.

| Step | Under `dev-flow` | Standalone |
|---|---|---|
| [1](#1-read-the-issue), [2](#2-pre-flight) | Run | Run |
| [4](#4-board-to-in-progress-and-self-assign) | Run, before the gate | Skip |
| [5](#5-the-design-gate) | Run, unless [a plan already exists](#a-plan-already-exists) | Run |
| After the gate | [Keep the plan in this session](#after-the-gate) | Post the plan handoff, then move to Ready |

## 1. Read the issue

Invoke `run-preflight` with the ticket reference, phase `plan`, the run
shape (`dev-flow` or `standalone`), and whether this run performs step 4
(yes under `dev-flow`, no standalone). It resolves the tracker and reads the
ticket through the tracker skill. If `run-preflight` or the tracker skill is
missing from the session, stop and say `apptension-sdlc` has to be installed
in this harness.

## 2. Pre-flight

`run-preflight` runs the pre-flight checks and decides the mode in the same
call. Done when it hands back the tracker, the ticket and the mode (full or
reduced). A stop it raises ends the run.

### A plan already exists

Under `dev-flow` only. Invoke the tracker skill's `Find the plan handoff`.
When the ticket has one, a standalone `plan-issue` run already planned it:
say so once and keep going, without waiting.

> This ticket already has a Plan handoff (<track>, <date>). Using it and
> skipping the design gate. Say "replan" to run the gate again.

Then run step 4, skip step 5, and keep the handoff in this session for
`implement-issue`. A "replan" answer runs step 5 as usual. No handoff:
run step 5.

## 4. Board to In progress and self-assign

Under `dev-flow` only, before the gate. Invoke the tracker skill
(`manage-github-issue` or `manage-jira-ticket`, per the tracker
`run-preflight` resolved) to `Assign to me`, then to `Move the ticket` to
`In progress`. Done when both operations return. A stop either raises ends
the run before the gate.

## 5. The design gate

Check the tracks in this order and take the first whose criteria all hold.
The default when uncertain is the design track.

| Order | Track | Takes it when | Then read |
|---|---|---|---|
| 1 | Micro | The four direct-track criteria and the four micro criteria all hold | [references/micro-track.md](references/micro-track.md) |
| 2 | Direct | The four direct-track criteria all hold | [references/direct-track.md](references/direct-track.md) |
| 3 | Design | Anything else, or you are uncertain | [references/design-track.md](references/design-track.md), and in reduced mode also [references/reduced-mode.md](references/reduced-mode.md) |

The direct-track criteria:

- acceptance criteria are concrete enough to implement against as written:
  no "design X", no open questions;
- no new user-facing behaviour or public interface: mechanical, additive,
  or a bugfix with a known cause;
- one subsystem only: no new dependency, no new CI workflow, no schema or
  manifest-shape change;
- the change can be stated in one sentence without hedging.

The micro criteria, all required on top of those four:

- the human names the exact file or component;
- the change stays inside that named surface;
- no exported signature, prop contract, or public behaviour change;
- no new dependency.

The eight form a closed list. A change failing any of them, such as a vague
issue that names one file, is judged as a direct-track or design-track
change. **The named surface** is what the human pointed at, at that
granularity: the file they named, or the component they named and the file
it lives in. It excludes what that file imports.

An issue whose ask is literally "run `superpowers:brainstorming` to design
X" takes the design track, whatever the criteria say.

The criteria are the same in both modes. The mode picks the design track's
vehicle only; reduced mode never sanctions the direct or micro track.

The craft checklist is never waived: `implement-issue` runs the
product-experience craft checklist at its step 6 for user-facing UI, on
every track. The gate decides only whether to write a spec and plan.

Done when the track's reference file reports its own completion: the call
stated (micro), the human's confirmation (direct), or the human's explicit
approval of the plan (design).

## After the gate

| Run shape | What happens |
|---|---|
| Under `dev-flow` | Keep the plan (the call, the approved text, the spec and plan, or the Plan handoff found at step 2) in this session and return to `dev-flow`, which invokes `implement-issue`. After a micro-track promotion, the run resumes at `implement-issue` step 6 on the existing branch |
| Standalone | Post the plan handoff, move the ticket to Ready and stop, per [references/standalone.md](references/standalone.md) |
