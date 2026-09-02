---
name: cezar-setup
description: Use when configuring Cezar as a repo's task orchestrator — deriving its base branch and verification check from the repo's bindings, writing .ai/cezar/, and verifying a dispatched run can reach the SDLC skills. Trigger on intent like "set up Cezar here", "configure the orchestrator", or when the setup skill offers it. Re-run it whenever the branching model or the verification commands change.
---

# Configuring Cezar for this repo

The canonical process is in `../../docs/task-dispatch.md` (bundled in
this plugin), under "Configuring the orchestrator". Read that section and
follow it, in order.

Cezar stores two values the repo's bindings already own: the branch
worktrees fork from, and the commands that verify a change. **Derive both
from the repo's "Dev flow bindings" section** — in `CLAUDE.md`, or in
`AGENTS.md` where setup wrote there. Resolve which file holds them before
reading; do not assume `CLAUDE.md` exists. Never guess the values, never
copy one from an example, and never fall back to the default branch when
`Branching model` names a different one — a run configured with the wrong
base branch opens pull requests that look correct against the wrong
branch.

Show the human every file this will write, echo the check command that
will gate their dispatched runs, and wait for approval.

**Do not run the repo's lint or test suite.** This writes two small config
files; a full verification run is out of proportion to that, expires
almost immediately, and measures the working tree rather than the branch a
dispatched run forks from. The suite is exercised by the first dispatched
run.

**Do not assume the agent backend.** Cezar drives several, and the
toolkit supports several harnesses on purpose. Ask which one this team
uses rather than writing a default, and establish how `dev-flow` reaches
a run on *that* backend — a plugin the CLI loads, or a skills repo the
orchestrator reads. Verify it; do not carry a finding over from another
backend. Remove the vendor's default team skills repo, but never leave
the list empty on a repo whose only route to `dev-flow` is a skills repo.
