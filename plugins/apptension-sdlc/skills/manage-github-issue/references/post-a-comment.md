# Post a comment

Read when a standalone `plan-issue` posts its Plan handoff, or
`issue-authoring` posts an Agent context comment.

## Collapse the agent detail

Both comments carry detail a human scrolls past: file tables, IDs, a whole
spec. Keep line 1, the bold label, visible, and collapse the detail under it
in a `<details>` block:

```
**Agent context** — execution detail, not part of the ask.

<details><summary>Files, commands and IDs</summary>

<file table, commands, IDs, constraints>

</details>
```

| Comment | Stays visible | Collapses | `<summary>` text |
|---|---|---|---|
| Agent context | The label line | Everything after it | What the detail covers, such as `Files, commands and IDs` |
| Plan handoff, design track, full mode, architectural | The label line and the plan summary | The spec and the plan | `Spec and plan` |
| Plan handoff, design track, full mode, bounded | The label line and the plan summary | The approved design | `Approved design` |
| Plan handoff, design track, reduced mode | The label line and the plan summary | The approved plan | `Approved plan` |
| Plan handoff, direct or micro track | The whole comment, a one-line body | Nothing | None |

- `<summary>` holds plain text or `<code>`, since GitHub prints markdown
  there literally. That is also why the bold label sits on line 1, where
  readers match it. Name a file as
  `<summary><code>repro_starvation.py</code></summary>`.
- Leave a blank line after `</summary>` and before `</details>`, so tables
  and code fences inside render.
- A comment that asks a human or a client a question stays fully visible,
  with no `<details>` anywhere in it.

## Post it

Write the body to a file in `<scratchpad>`, then:

```bash
gh issue comment <N> --body-file <path>
```

The command prints the new comment's URL; hand it back.

A design-track Plan handoff over about 65,000 characters, tags included:
post numbered parts in order. Each part has `**Plan handoff** · part <i>/<n>`
on line 1 and collapses its own chunk of the track body in its own
`<details>`, under its summary text followed by `, part <i> of <n>`. Part 1
carries the plan summary above its `<details>`.

Done when every part is posted, collapsed as the table gives.
