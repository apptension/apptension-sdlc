---
name: manage-github-issue
description: GitHub issue handling, called by plan-issue, implement-issue, dev-flow and issue-authoring. Reads, comments on, moves and assigns a GitHub issue, and returns the reference its pull request carries.
---

# Manage a GitHub issue

The caller has resolved the ticket to a GitHub issue and read the Dev flow
bindings. That includes a GitHub issue URL read under a Jira tracker: it
stays on this skill for every operation.

- `<N>` is the issue number, taken from the URL when the caller passed one.
- `<owner>/<repo>` is the repository the issue lives in.
- `<scratchpad>` is a throwaway directory outside the repository tree.

## Operations

The caller names the operation. Read its reference and follow it. Each
reference ends on its own completion criterion.

| Operation | Called when | Read |
|---|---|---|
| Read the ticket | `run-preflight` reads a ticket at its step 3 | [references/read-the-ticket.md](references/read-the-ticket.md) |
| Find the plan handoff | A caller needs the ticket's Plan handoff: `plan-issue` under `dev-flow`, or a standalone `implement-issue` at step 2 | [references/find-the-plan-handoff.md](references/find-the-plan-handoff.md) |
| Post a comment | A standalone `plan-issue` posts its Plan handoff, or `issue-authoring` posts an Agent context comment | [references/post-a-comment.md](references/post-a-comment.md) |
| Move the ticket | A caller moves the ticket to `In progress`, `Ready` or `In review` | [references/move-the-ticket.md](references/move-the-ticket.md) |
| Assign to me | A caller starts work on the ticket (step 4) | [references/assign-to-me.md](references/assign-to-me.md) |
| Ticket reference for a pull request | `implement-issue` writes the PR body at step 10 | [references/ticket-reference.md](references/ticket-reference.md) |

## Order between operations

- Run `Read the ticket` before `Find the plan handoff`: the handoff comes
  from the comments that read fetched.
- A Plan handoff: `Post a comment` with every part, then `Move the ticket`
  to `Ready`.
