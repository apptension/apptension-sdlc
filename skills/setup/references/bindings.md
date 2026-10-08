# The bindings section

Read at step 4, to compose the `### Dev flow bindings` section.

## The template

A section written fresh opens with one neutral sentence, so a reader who
arrives cold can tell what the table is for and what keeps it current.
Every value is a placeholder: fill each from step 1 and copy none. `Board`
is the row most often transcribed instead of probed, and a project carried
over from an example points at somebody else's project.

```markdown
### Dev flow bindings

Concrete values for this repo, in one place so every contributor, human
or agent, reads the same ones. Rows are matched by label, so update a
row's value when the thing it names changes, rather than its label.

| Binding | Value |
|---|---|
| Default branch | `<default branch>` |
| Branching model | <model>: feature branches off `<branch>`, pull requests based on `<branch>` |
| Code host | <host> |
| CI provider | <ci provider> |
| Issue tracker | <tracker> |
| Tracker statuses | <stage> → `<status>`, <stage> → `<status>` |
| Stack | <language and runtime version>, <package manager>, <framework> |
| Verification | `<command>`, `<command>` |
| Automated reviewer | `AUTOMATED_REVIEWER=<claude or codex>` |
| Commit convention | <convention> |
| Specs and plans | `<specs path>`, `<plans path>` |
| Board | **<project title>** / <view name>, <owner kind> `<owner>`, project #<number>, view #<view number> |
| Task orchestrator | <orchestrator>: `<dispatch command>`, config in `<config path>` |
| E2E | `<spec dir>` \| not adopted \| unknown |
```

## Reserved labels

The heading and all fourteen row labels are reserved. Consumers match a
label verbatim: one looking for `Default branch` and finding `Main branch`
reads the row as absent. Rows such as `Code host`, `Issue tracker`, `CI
provider` and `Stack` carry step 1's detection into the written record, so
a later consumer has a label to match. A repo may add rows of its own.
Values are the repo's own; labels are fixed.

Deviations get their own rows (`Issue tracker | Jira, project key ABC,
site abc.atlassian.net`), so the next reader sees the deviation instead of
inferring it from a hole.

## The `E2E` row

`E2E` is the one row whose value another skill's section owns. `e2e-setup`
owns `### E2E bindings` (its `Location`, `Convention`, `Auth scheme`,
`Linter` and `TypeScript` rows) and writes it directly. Setup fills `E2E`
from that section's `Location` row, per [detect.md](detect.md#verification-and-e2e).
The two sections share no rows, and each skill probes for its own heading
before writing.

## `Board` names a view

A GitHub Project holds several views, and more than one can be a board
(`BOARD_LAYOUT`). The row keeps the project identity `dev-flow` reads
(title, owner, number) and adds the view. The gate chooses the view: see
[gate.md](gate.md#resolving-the-board-view).

The row records no IDs. Each run that moves a card looks up the project ID,
the Status field and its options from the owner and number, through the
tracker skill's `Move the ticket`, so the row stays correct when a field or
option changes. Cards move by the project's Status field, since
`gh project item-edit` takes no view.

## `Tracker statuses`

Under Jira, a ticket moves by the project's own status names. The row maps
this workflow's stages to them:

    | Tracker statuses | Ready → `Selected for Development`, In progress → `In Progress`, In review → `Code Review` |

The left side is this workflow's stage: `In progress` and `In review`,
which `implement-issue` steps 4 and 10 move through, and the optional
`Ready`, which a standalone `plan-issue` run moves a planned ticket to. The
right side is the project's status, backticked because it matches Jira
character for character. Under a GitHub tracker the moves are board
columns recorded in `Board`.

| Value | Meaning |
|---|---|
| `none` for a stage | The workflow has no such stage, such as review living in the pull request. The stage is skipped without comment |
| `unknown` | Nobody has said yet |
| No `Ready` | Complete. A standalone `plan-issue` run skips that move and says so once |
| Row absent under GitHub | Nothing reads it, so nothing changes |
| Row absent under Jira | A stop in the flows that move tickets |

The Jira stop is the one exception to the growth rule, where a new row
falls back to the behaviour from before it existed. Under Jira nothing
moved tickets before this row, so there is no predecessor to fall back
to. Copy that exception to no other row.

## `Default branch` and `Branching model`

- `Default branch` is what the host serves: what a fresh clone checks out
  and what a pull request targets when nothing says otherwise.
- `Branching model` is where feature work starts and lands.

Under GitHub flow the rows name the same branch:

```markdown
| Default branch | `main` |
| Branching model | GitHub flow: feature branches off `main`, pull requests based on `main` |
```

Under git flow they differ, and that difference is the deviation the row
records:

```markdown
| Default branch | `main` |
| Branching model | git flow: feature branches off `develop`, pull requests based on `develop`; releases and hotfixes off `main` |
```

Consumers read one part of `Branching model`: the branch feature work
starts from and lands on. The model's name orients a human, and extra
detail such as release branches is free text. The row names a branch so a
repo whose model has no name still records one concrete fact.
