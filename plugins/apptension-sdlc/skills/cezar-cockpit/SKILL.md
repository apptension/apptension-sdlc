---
name: cezar-cockpit
description: Use when opening the Cezar cockpit for the repo it is configured in — finding an already-running cockpit and returning this project's URL rather than starting a second one. Trigger on intent like "open Cezar", "start the cockpit", "show me the dispatched tasks", "where is that run".
---

# Opening the Cezar cockpit

The canonical process is in `../../docs/task-dispatch.md` (bundled in
this plugin), under "Opening the cockpit". Read that section and follow
it.

One cockpit serves every registered repo. Look for a running one and
return this project's URL before starting another: a second cockpit binds
a different port and shows an overlapping project list, so both URLs look
correct and disagree about what is running.

Start it in the background. It runs until someone stops it, so a session
that waits on it never returns.
