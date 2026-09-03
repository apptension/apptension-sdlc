---
name: cezar-setup
description: Use when configuring Cezar as a repo's task orchestrator — deriving its base branch from the repo's bindings, writing .ai/cezar/config.json, and verifying a run can reach the SDLC skills. Trigger on intent like "set up Cezar here", "configure the orchestrator", or when the setup skill offers it. Safe to re-run at any time; re-run it whenever the branching model changes.
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

# Configuring Cezar for this repo

`cezar-setup` runs once per repository per machine and is safe to re-run.
Setup normally invokes it after the adoption gate. Direct invocation is
for reconverging after `Branching model` changes.

**This brings the repo to the state this skill describes, whatever state
it starts in.** Re-running is the ordinary case, not a repair, so work
from where the configuration should land rather than from what is
already there. The target is current state, not a migration from any
previous config shape.

**Convergence covers the configuration, never the repo's decision.**
Read the `Task orchestrator` row first and stop unless it sanctions
this: a row reading `none` is a settled decision not to dispatch, and a
row naming another orchestrator is a choice of a different tool. Neither
is a gap, and neither is yours to reverse — say so and stop, without
configuring or writing anything. Adopting an orchestrator is the `setup`
skill's gate. Where the row is absent or `unknown`, the request to
configure Cezar is the answer, but the row is committed, so confirm it
in the same approval as everything else.

## The procedure

1. Probe the Cezar binary, an authenticated agent CLI, and authenticated
   `gh`. Name missing prerequisites rather than failing outright.
2. Read `Task orchestrator` before writing anything. Resolve which file
   holds the bindings first — `CLAUDE.md`, or `AGENTS.md` where setup
   wrote there; do not assume `CLAUDE.md` exists.
3. If it names Cezar, continue.
4. If it is `none`, **stop** without configuring or writing anything. Do
   not reverse a settled decision.
5. If it names another orchestrator, **stop** and report that this
   process does not configure it.
6. If it is absent or `unknown`, treat the explicit request to configure
   Cezar as the proposed answer, but include the committed binding update
   in the one approval before writing.
7. Resolve the integration branch from `Branching model`. If it is
   `unknown`, **stop and ask**, for the same reason as `dev-flow` step 3.
   Never infer the base branch from the currently checked-out branch or
   an example, and never fall back to the default branch when
   `Branching model` names a different one — a run configured with the
   wrong base branch opens pull requests that look correct against the
   wrong branch.
8. Ask which agent backend the team actually uses. Record it; do not
   silently default to Claude Code.
9. Present one approval naming every file to write, edit, or remove and
   every value that will change.
10. Write `.ai/cezar/config.json`, and no workflow file. Set the derived
    base branch, selected backend, and team skills list described below.
11. Inspect everything else in `.ai/cezar/`. The directory may contain
    the one config file and Cezar's ignored run state, which its
    `.gitignore` enumerates. Anything else is either scaffolding —
    Cezar's own `init` writes an example workflow and skill — or
    something the team wrote. Name what is there and let the human say
    which. Remove only files the human explicitly releases; never remove
    files they claim.
12. Confirm a dispatched run on the selected backend can reach
    `dev-flow`. A run that starts without loading the skill may
    improvise rather than follow the process, which is a failure.
13. Bring the `Task orchestrator` binding up to date with the run
    command and config location. This updates how the repository reaches
    Cezar without changing which orchestrator it chose.
14. Live-verify with a trivial task deliberately instructed to ask a
    question. Confirm that the task ran, `dev-flow` loaded and was
    followed, the question appeared in the interface, and the answer
    returned to the run. A silent task does not verify the transport and
    is insufficient: a probe that asks nothing proves the skill loaded
    and nothing about whether a question can be answered, so it passes
    on a backend where the first design gate would hang unanswerable.
15. Report all values changed and any prerequisite or backend limitation
    found.

Do not run the repository's full verification suite as part of setup. It
would measure a potentially dirty setup worktree rather than the clean
integration branch used by a task, and it expires almost immediately.
`dev-flow` verifies its work, and CI verifies the pull request.

## Skills and backends

Cezar can run Claude Code, Codex, OpenCode, or pi, selected per
repository or task. Tool allowlists are not portable: Codex ignores one,
OpenCode auto-approves permissions, and pi maps restrictions to its own
mechanism. Check the selected backend rather than generalizing behavior
observed on Claude Code — do not carry a finding over from another
backend.

Configure the team skills list with the toolkit's published marketplace
repo, `apptension/apptension-sdlc`, on every backend. The repository
performs two jobs:

| Job | Behavior |
|---|---|
| Lookup | Cezar builds its selectable skill list from the repository |
| Injection | Cezar materializes the whole skill directory — `SKILL.md` plus the files beside it — into the run's repo when the harness lacks the skill. Files outside the skill directory, such as a plugin-level `references/`, do not come along |

The harness must separately install dependencies that the injected skill
calls, especially `superpowers`, whose skills `dev-flow` invokes by
name; use the appropriate instructions in
[the prerequisites reference](../../references/prerequisites.md).

Remove Cezar's default `open-mercato/skills` source because it supplies
a competing SDLC, including an auto-merge path. Preserve every other
team-added source. This is a default, not a prohibition: a team may
deliberately add that source again.

The toolkit repo is generated by tagged marketplace releases, not
maintained by hand. Cezar flattens every published skill into one list
without plugin grouping, so the marketplace publish set bounds what
consuming teams see. Do not point Cezar at the toolkit development
repository, which includes unreleased work, and do not omit the
published repo merely because a harness already has the plugin;
omission leaves Cezar's interface without the skill to select.

## How a dispatched run behaves

Dispatch runs the `dev-flow` skill in an orchestrator-owned worktree;
there is no separate development-flow variant for dispatch. A person
starts `dev-flow` from the orchestrator's skill list or a bookmarklet
and passes the ticket reference as the complete input.

1. Select `dev-flow` in the orchestrator interface and pass the ticket.
2. Let `dev-flow` apply its step 1 reference rules from the repository's
   `Issue tracker` binding. Under GitHub, a bare number means this
   repository's issue. Under Jira, a bare number is a **stop**; pass a
   Jira key or URL.
3. Let `dev-flow` read the ticket and run pre-flight. Do not duplicate or
   waive either step for dispatch.
4. Run the design gate inside the dispatched run. State the call and wait
   under the same three-track rules as an attended run. The micro track
   keeps only the narrow waiver granted by `dev-flow`; promotion ends it
   when work leaves the named surface.
5. Preserve every later `dev-flow` stop. A stop becomes an orchestrator
   task flagged for attention and may be resumed after the active session
   expires.

Autonomous mode is controlled by the person starting the run. No skill
turns it on or reads it. When enabled, the orchestrator injects an
instruction to make reasonable assumptions and continue, which can nudge
the run past stops, including the design gate. Do not describe autonomous
mode as equivalent to the normal development flow.

For risky or design-track work, the operator may run two or three
variants in separate worktrees and compare their diffs. Variants share
the task's selected agent backend. A second agent may critique a design
but must not answer a human question or invent product intent.

## Binding behavior

Resolve the bindings file the repository actually uses before reading the
`Task orchestrator` row. Apply these states:

| Row | Required behavior |
|---|---|
| Names Cezar | Dispatch and Cezar setup/cockpit operations are available |
| `none` | Do not offer dispatch, do not suggest setup, and continue attended |
| Absent | Do not offer dispatch; continue attended |
| `unknown` | Say once that dispatch is unavailable, then continue attended |
| Names another orchestrator | Preserve the decision; say this process cannot configure it and continue attended |

An absent, `unknown`, `none`, or unsupported row never blocks working the
issue with `dev-flow` in the current session. Only `unknown` is worth
raising again.

Treat the binding as committed repository state and orchestrator
configuration as gitignored machine state. Setup must inspect both. A
machine without config still needs setup even when another developer
already committed a binding that names Cezar.

The `requires` probe in this skill's front-matter tracks only the
optional repository decision. It is anchored to the table cell because
matching the bare words across a whole file could mistake explanatory
prose for a binding. It names `CLAUDE.md`; if the repository keeps
bindings in `AGENTS.md`, treat an unresolved probe as a gate for a human
answer rather than as proof that the row is absent.

## Question transport

Ask every question through the harness's native question mechanism. Do
not emit markers, sentinels, or text intended for the orchestrator to
parse. On Claude Code, Cezar detects `AskUserQuestion` and renders it in
the interface. Other backends may expose a visible stop without an
answerable control, so this skill must live-verify the backend actually
selected for the repository.

## Results and failures

Use the same durable outcomes as `dev-flow`:

1. Every ordinary stop waits in the orchestrator as needing attention.
2. The issue records the flow's board movement, and the draft pull
   request and its body record the successful result and decisions.
3. The orchestrator reports a run that dies outright.

A machine kill, cancellation, or crash can leave the issue at the last
state the flow reached because no process remains to reconcile it. Report
the run in the cockpit or task list and use that task record to find and
resume it. Do not claim that this toolkit supplies a reconciler.
