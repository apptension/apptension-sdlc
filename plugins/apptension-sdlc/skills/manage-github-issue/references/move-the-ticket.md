# Move the ticket

Read when a caller moves the ticket to `In progress`, `Ready` or `In review`.

The stage is `In progress`, `In review` or `Ready`. The `Board` row decides
the move, under a Jira `Issue tracker` binding too.

| `Board` row | What to do |
|---|---|
| Absent, or names no board | Skip the move silently |
| `unknown` | Skip the move, say the line below, and continue |
| Names a board | [Resolve the board](#resolve-the-board), then [move the card](#move-the-card) |

> `Board` is `unknown` in the bindings, so no card is being moved. Name the
> board in that row, or rerun `setup`, to get board sync.

Say that line once per session. A later move with the row `unknown` skips
without repeating it.

## Resolve the board

The row names the project by owner and number. Every ID the move needs
comes from the live project, and the bindings record none, so a recreated
project or a renamed option is read as it stands. Resolve once per session
and reuse the result for every later move:

```bash
gh project view <project number> --owner <owner> --format json --jq '.id'

gh project field-list <project number> --owner <owner> --format json \
  --jq '.fields[] | select(.name == "Status")'
```

The first prints the project ID. The second prints the Status field's `id`
and its `options`, each with a `name` and an `id`. The stage's option is the
one whose name matches the stage, ignoring case: `In progress` matches
`In Progress`.

Done when the project ID, the Status field ID and the stage's option ID are
in hand, or a [lookup failed](#when-a-lookup-fails).

## Move the card

```bash
gh project item-add <project number> --owner <owner> --url <issue URL> \
  --format json --jq '.id'

gh project item-edit --project-id <project id> --id <item id> \
  --field-id <Status field id> --single-select-option-id <option id>
```

`item-add` returns the issue's card, and adds one when the issue has none,
so the first call yields the item ID in both cases. It matches by URL, so it
needs no page limit and never picks another repository's issue with the same
number.

## When a lookup fails

Skip the move, say the line for the failure, and continue. A failed lookup
never stops the run.

| Failure | Say |
|---|---|
| `gh project view` or `field-list` fails | The `Board` row names project #<number> of `<owner>`, and it could not be read: <the `gh` error>. Correct the number in that row to get board sync. Point at the row itself: a rerun of `setup` keeps a row that already names a view. A missing token scope reads as this failure: `gh auth refresh -s project` grants it |
| The project has no field named `Status` | Project #<number> has no `Status` field, so no card is being moved. Add the field, or name another project in the `Board` row |
| The Status field has no option named for the stage | Project #<number> has no `<stage>` status, so the ticket stays where it is. Add the option to get this move |
| `item-add` or `item-edit` fails | The card for #<N> could not be moved to `<stage>`: <the `gh` error> |

Say each line once per session. After a failed `view` or `field-list`, every
later move in the session skips silently.

Done when the card sits in the stage's column, or the skip is said or silent
as the tables give.
