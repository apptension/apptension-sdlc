---
name: cezar-cockpit
description: Use when opening the Cezar cockpit for the repo it is configured in — finding an already-running cockpit and returning this project's URL rather than starting a second one. Trigger on intent like "open Cezar", "start the cockpit", "show me the dispatched tasks", "where is that run".
---

# Opening the Cezar cockpit

One cockpit serves every registered repo. Look for a running one and
return this project's URL before starting another: a second cockpit binds
a different port and shows an overlapping project list, so both URLs look
correct and disagree about what is running.

The procedure:

1. Resolve the bindings file and read `Task orchestrator`.
2. If it is `none`, say the repository declined an orchestrator and stop.
   Do not name `setup` or `cezar-setup`.
3. If it is absent or `unknown`, say the repository is not enabled and
   name the `setup` skill, then stop.
4. If it names an unsupported orchestrator, report that name and that no
   process here drives it, then stop.
5. Check `.ai/cezar/config.json`. If it is absent, name `cezar-setup` and
   stop.
6. Derive the expected configuration from the bindings and report every
   stale value, naming `cezar-setup` — a base branch left behind by a
   `Branching model` change makes runs fork from the wrong branch and
   open pull requests that look correct against it. Continue opening the
   cockpit regardless. Drift is not a cockpit gate: a person may need the
   cockpit to answer or inspect a run, and refusing to open it would not
   prevent launches made in Cezar's interface. This is a door, not a
   gate — the cockpit is opened to answer and watch as much as to start.
7. Look for a running cockpit before starting one. One cockpit serves all
   repos in a per-user registry and may choose another port when the
   default is busy.
8. If one is running, ensure this repository is registered and return
   this project's URL within that cockpit.
9. Otherwise resolve the installed binary, falling back to the package
   runner, and start the cockpit in the background with browser opening
   suppressed. Return this project's URL and never block on the
   long-running server — it runs until someone stops it, so a session
   that waits on it never returns.

The required CLI surface is the default cockpit subcommand, a port
override, a no-open flag, and a projects subcommand that lists, adds, and
removes repos.
