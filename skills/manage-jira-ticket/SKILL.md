---
name: manage-jira-ticket
description: Jira ticket handling, called by plan-issue, implement-issue, dev-flow, setup and issue-authoring. Reads, comments on, transitions and assigns a Jira ticket, checks every write against the recorded site, returns the reference its pull request carries, and finds or configures the Jira server entry.
---

# Manage a Jira ticket

The caller has resolved the ticket to Jira and read the Dev flow bindings.
Two rows drive this skill:

- `Issue tracker`: `Jira, project key <KEY>, site <site>`, for example
  `your-company.atlassian.net`. This is the recorded site.
- `Tracker statuses`: the Jira status recorded for each stage
  (`In progress`, `In review`, `Ready`), or `none`.

Call the tool whose server is named `jira`, or the single tool matching the
suffix when no server has that name, per
[which entry, when there are two](references/server.md#which-entry-when-there-are-two), in `Find the server`.
`GA-240` in the references stands for the ticket's key.

## Operations

The caller names the operation. Read its reference and follow it. Each
reference ends on its own completion criterion.

| Operation | Called when | Read |
|---|---|---|
| Read the ticket | `run-preflight` reads a ticket at its step 3 | [references/read-the-ticket.md](references/read-the-ticket.md) |
| Find the plan handoff | A caller needs the ticket's Plan handoff: `plan-issue` under `dev-flow`, or a standalone `implement-issue` at step 2 | [references/find-the-plan-handoff.md](references/find-the-plan-handoff.md) |
| Post a comment | A standalone `plan-issue` posts its Plan handoff | [references/post-a-comment.md](references/post-a-comment.md) |
| Move the ticket | A caller moves the ticket to `In progress`, `Ready` or `In review` | [references/move-the-ticket.md](references/move-the-ticket.md) |
| Assign to me | A caller starts work on the ticket (step 4) | [references/assign-to-me.md](references/assign-to-me.md) |
| Ticket reference for a pull request | `implement-issue` writes the PR body at step 10 | [references/ticket-reference.md](references/ticket-reference.md) |
| Find the server | A caller picks the Jira tool entry to call, proves the credential, or hits a Jira failure: every operation above, `issue-authoring`, and `setup`'s credential check | [references/server.md](references/server.md) |
| Configure the server | `setup` step 4 composes the repo's `.mcp.json` and approval key, or a human configures the entry in their own harness | [references/configure-server.md](references/configure-server.md) |

## Order between operations

- Run `Read the ticket` before `Find the plan handoff`: the handoff comes
  from the comments that read fetched.
- Starting work: `Assign to me` first, then `Move the ticket` to
  `In progress`. The transition waits on the assignment's site check.
- A Plan handoff: `Post a comment` with every part, each passing its site
  check, then `Move the ticket` to `Ready`.
- Every stop, and the human's next action, is in
  [Jira stops](references/site-and-transitions.md#jira-stops).
