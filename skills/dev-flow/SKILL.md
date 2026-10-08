---
name: dev-flow
description: Use when working a ticket in this repo — a GitHub issue or a Jira ticket, per the Issue tracker binding — taking it to a draft PR. Covers pre-flight checks, branch naming, the design gate (when brainstorming can be skipped), project-board or Jira status sync, verification, and the required draft-PR body. Trigger on intent like "work issue #6", "work GA-240", "let's pick up 14", "implement this issue", "take this ticket to a PR", or a bare Jira key.
requires:
  - id: dev-flow-bindings
    label: Repo bindings recorded for agents
    area: dev-flow
    writes: true
    detect:
      heading: '### Dev flow bindings'
      in: CLAUDE.md
    intent: >-
      Every repo-agnostic step an agent follows has, in one place, the
      concrete values it cannot otherwise know — default branch, the
      branch feature work starts from and lands on, verification
      commands, commit convention, the project board — so agents stop
      guessing them or hard-coding them separately into each step.
  - id: e2e-scaffold
    label: End-to-end test scaffold
    area: dev-flow
    writes: true
    detect:
      path: e2e/web/playwright.config.ts
    intent: >-
      The repo has one place end-to-end specs live and one config that
      runs them, so a step that generates a spec has somewhere to put it
      and a command that runs it — rather than each issue inventing a
      layout and a runner invocation of its own. The `### E2E bindings`
      section records the setup answers this audit backs — location,
      convention, auth scheme, linter, TypeScript — in the repo's
      bindings file (`CLAUDE.md`, or `AGENTS.md` when that is the
      repo's bindings file).
  - id: project-board
    label: Project board under the repo's owner
    area: foundation
    optional: true
    detect:
      board: true
    intent: >-
      What's in progress, what's in review, and what's done is visible
      at a glance, without reading through every open issue and pull
      request to reconstruct it.
---

# Agent-driven development flow

Takes a ticket (GitHub issue or Jira ticket, per the `Issue tracker`
binding) to a draft PR in one session, by running two skills in order.

If `plan-issue`, `implement-issue`, `run-preflight`, `manage-github-issue`
or `manage-jira-ticket` is missing from the session, stop and say
`apptension-sdlc` has to be installed in this harness.

1. Invoke `plan-issue` on the ticket, saying it runs under `dev-flow`.
   It runs steps 1, 2, 4 and 5: read, pre-flight, In progress and
   self-assign, and the design gate through the human's approval. When
   the ticket already has a Plan handoff, it picks that plan up and
   skips the gate.
2. Invoke `implement-issue` on the same ticket, saying it runs under
   `dev-flow`, with the plan from step 1. It asks the execution method
   for a writing-plans plan in full mode, then runs step 3 and steps 6 to 10, through
   the draft PR and `pr-checks`.

A plan made in this run stays in the session, and nothing is posted to
the ticket.
Every question both skills ask is asked here. A micro change that leaves
its named surface goes back to `plan-issue`'s gate, then resumes at
`implement-issue` step 6 on the same branch.

To keep the phases apart, a human runs `plan-issue` on its own, which
posts the plan to the ticket, and later `implement-issue`, which works
from that comment and asks at most the execution method before the draft PR.
