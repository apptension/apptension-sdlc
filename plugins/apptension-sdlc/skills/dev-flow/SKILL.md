---
name: dev-flow
description: Use when working a ticket in this repo — a GitHub issue or a Jira ticket, per the Issue tracker binding — taking it to a draft PR. Covers pre-flight checks, branch naming, the design gate (when brainstorming can be skipped), project-board or Jira status sync, verification, and the required draft-PR body. Trigger on intent like "work issue #6", "work GA-240", "let's pick up 14", "implement this issue", "take this ticket to a PR", or a bare Jira key.
---

# Agent-driven development flow

The canonical process is in `../../docs/dev-flow.md` (bundled in this
plugin). Read it and follow it, in order, from step 1.

Fill the pull-request body from the repo's own pull request template where
it has one; `references/pr-body-template.md` is the fallback. Step 9 of the
process doc names the locations to check and how the mandatory fields map
onto a template's own sections.

This repo's concrete values — default branch, verification commands,
commit convention, project-board IDs — are in `CLAUDE.md` under "Dev flow
bindings".
