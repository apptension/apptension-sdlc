# Find the plan handoff

Read when a caller needs the ticket's Plan handoff: `plan-issue` under `dev-flow`, or a standalone `implement-issue` at step 2.

Work from the comments [Read the ticket](read-the-ticket.md) fetched.

1. Take the newest comment whose first line contains a bolded
   `**Plan handoff**`. Match it anywhere on the first line: the server
   prefixes a marker. The newest counts, whoever wrote it.
2. When it is split, collect every part headed
   `**Plan handoff** · part <i>/<n>`, from `1/<n>` to `<n>/<n>`, in order.
3. Hand back the handoff text, its comment URL, and the ticket's `status`.

No such comment: say so to the caller. Done when the handoff, or the absence
of one, is with the caller.
