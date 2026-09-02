---
name: cezar-setup
description: Use when configuring Cezar as a repo's task orchestrator — deriving its base branch from the repo's bindings, writing .ai/cezar/config.json, and verifying a run can reach the SDLC skills. Trigger on intent like "set up Cezar here", "configure the orchestrator", or when the setup skill offers it. Safe to re-run at any time; re-run it whenever the branching model changes.
---

# Configuring Cezar for this repo

The canonical process is in `../../docs/task-dispatch.md` (bundled in
this plugin), under "Configuring the orchestrator". Read that section and
follow it, in order.

**This brings the repo to the state that section describes, whatever
state it starts in.** Re-running is the ordinary case, not a repair, so
work from where the configuration should land rather than from what is
already there.

**Convergence covers the configuration, never the repo's decision.**
Read the `Task orchestrator` row first and stop unless it sanctions
this: a row reading `none` is a settled decision not to dispatch, and a
row naming another orchestrator is a choice of a different tool. Neither
is a gap, and neither is yours to reverse — say so and stop, without
configuring or writing anything. Adopting an orchestrator is the `setup`
skill's gate. Where the row is absent or `unknown`, the request to
configure Cezar is the answer, but the row is committed, so confirm it
in the same approval as everything else.

Cezar stores one value the repo's bindings already own: the branch
worktrees fork from. **Derive it from the repo's "Dev flow bindings"
section** — in `CLAUDE.md`, or in `AGENTS.md` where setup wrote there.
Resolve which file holds them before reading; do not assume `CLAUDE.md`
exists. Never guess the value, never copy one from an example, and never
fall back to the default branch when `Branching model` names a different
one — a run configured with the wrong base branch opens pull requests
that look correct against the wrong branch.

Write `.ai/cezar/config.json` and nothing else. That directory should
hold this one config file plus Cezar's own run state, which its
`.gitignore` enumerates. Anything else is either scaffolding — Cezar's
own `init` writes an example workflow and skill — or something the team
wrote. Name what is there and let the human say which. Remove only what
they release.

Bring the `Task orchestrator` bindings row up to date with what was
configured — the command that starts a run, and where the config lives.
This rewrites how the repo reaches its orchestrator, never which
orchestrator it chose.

Show the human every file this will write, remove and edit, report which
values moved, and wait for approval.

**Do not run the repo's lint or test suite.** This writes one small
config file; a full verification run is out of proportion to that,
expires almost immediately, and measures the working tree rather than the
branch a run forks from. `dev-flow` step 7 and CI on the pull request are
where the suite belongs.

**Do not assume the agent backend.** Cezar drives several, and the
toolkit supports several harnesses on purpose. Ask which one this team
uses rather than writing a default, then confirm on *that* backend that a
run loads `dev-flow` and that its questions reach the Cezar interface —
do not carry a finding over from another backend.

**Give the live-verify task a question to ask.** A probe that asks
nothing proves the skill loaded and nothing about whether a question can
be answered, so it passes on a backend where the first design gate would
hang unanswerable. Confirm the question arrived in the interface and the
answer got back.

**Point the team skills list at `apptension/apptension-sdlc`**, on every
backend, and remove Cezar's vendor default (`open-mercato/skills`). The
interface's skill list is read from that repo, so without it there is
nothing for a human to pick even on a harness that has the plugin
installed. Leave anything else the team added in place.

**Name what the harness must install for itself.** A skills repo supplies
only what it carries, so the plugins a run depends on are the operator's
job — `superpowers` above all, whose skills `dev-flow` invokes by name.
See `../../docs/prerequisites.md` for the per-harness install path.
