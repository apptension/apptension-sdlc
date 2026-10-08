# Find the plan handoff

Read when a caller needs the ticket's Plan handoff: `plan-issue` under `dev-flow`, or a standalone `implement-issue` at step 2.

Work from the comments [Read the ticket](read-the-ticket.md) fetched.

1. Take the newest comment whose first line contains a bolded
   `**Plan handoff**`. The newest counts, whoever wrote it.
2. When it is split, collect every part headed
   `**Plan handoff** · part <i>/<n>`, from `1/<n>` to `<n>/<n>`, in order.
3. Unwrap each part. [Post a comment](post-a-comment.md#collapse-the-agent-detail)
   collapses the track body under a `<details><summary>` line carrying one
   of its Plan handoff summary texts, with or without `, part <i> of <n>`.
   Drop that line and the part's last `</details>` line. Every other line
   stays, including any `<details>` inside the spec itself. A part without
   that line is already plain and stays as it is.
4. Hand back the unwrapped handoff text, its comment URL, and the issue's
   `state`.

No such comment: say so to the caller. Done when the handoff, or the absence
of one, is with the caller.
