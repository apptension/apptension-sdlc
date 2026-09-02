---
name: task-dispatch
description: Use when handing a GitHub issue off to a task orchestrator to run unattended — resolving the design gate with the human present, then dispatching and returning. Trigger on intent like "dispatch issue #71", "run this with Cezar", "hand this off", "do that issue in the background". Do not use to work an issue in this session; that is dev-flow.
---

# Dispatching an issue to a task orchestrator

The canonical process is in `../../docs/task-dispatch.md` (bundled in
this plugin). Read it and follow it, in order.

This repo's concrete values — the orchestrator, the branch feature work
starts from, the verification commands — are under "Dev flow bindings",
in `CLAUDE.md` or in `AGENTS.md` where setup wrote there. Resolve which
file holds them rather than assuming.

A `Task orchestrator` row reading `none` is a settled decision, not a
gap: say so and work the issue with `dev-flow`, without offering to
configure anything.

Dispatch is never required. Working the issue here with `dev-flow` is
always available and is the better call whenever the human would want to
steer it mid-flight. If any pre-flight check fails, that stops this
skill only: say what is missing, name the configuring step, and offer
the attended path. It is never a reason the issue cannot be worked.
