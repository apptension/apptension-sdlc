# The human gate

Read at step 5, before anything is written or filed. Print the drafted
bindings first, ask the rows below, then print the approve prompt.
`CLAUDE.md` in every prompt stands for the file step 4 chose, so a repo
whose bindings go to `AGENTS.md` sees `AGENTS.md`. The operator can go and
look at the file named, and a wrong name defeats that.

## Rows the gate asks about

Ask each of `Board`, `Stack`, `Branching model` and `Task orchestrator`
that step 1 left `unknown`, one line each, before the approve prompt. Every
other `unknown` row goes to the `Could not determine` line. Ask `Board` also when a carried row names a project and no view:
skip the project question and resolve the view. Under Jira, add the Jira
questions in [jira.md](jira.md#gate-questions).

```
Board: no GitHub Project is tied to this repo. Working an issue through
this flow moves its card across a board view of that project as work starts
and goes up for review, so a project named here is a step that happens on
its own, and one left unknown is a step that is skipped. Name the GitHub
Project, its owner and its number, or press enter to leave it unknown.
Stack: no manifest here was recognisable, so setup does not know what this
repo is built with. Every issue it files is written in those terms (the
commands your CI would run, the manifest it installs from, the runtime it
pins), so left unknown, those issues have to ask you for the stack
instead of proposing something concrete. Name the language, runtime
version, package manager and framework, or press enter to leave it
unknown.
Branching model: setup could not tell where feature work starts in this
repo. Nothing here has been merged yet, or what has went to more than one
branch. Every branch this flow cuts starts from the branch you name here,
and every pull request it opens is based on it, so left unknown the flow
has no start point and stops instead of picking one. Name the model and the
branch feature work starts from and lands on ("GitHub flow, off main" is a
complete answer), or press enter to leave it unknown.
Task orchestrator: do you want to hand issues off to run unattended? A dispatched
issue is taken to a draft PR without holding your session open, on your own
subscription, on this machine or a server you own. `cezar` is the orchestrator
this SDLC supports; `none` leaves every issue worked in a live session, as now.
(cezar / none, enter accepts none)
```

An answer replaces the row's value in the table about to print. No answer
leaves it `unknown`, reported on `Could not determine`. No question stops
setup, and none is asked for a row step 1 resolved. The `Branching model`
question warns about a stop in `implement-issue` step 3, a later process.

**Task orchestrator is a closed choice.** The other rows ask for facts
with unbounded answers. This one asks a preference with a known answer
set, so it offers the options. A name outside the set is recorded verbatim,
since the row is not Cezar-specific, and the gate says nothing can
configure it yet.

**`none` is an answer.** Answering `none` writes `none`. It dispatches
nothing, like `unknown`, but `unknown` brings the question back on every
re-run and `none` records a settled decision. Only this row has the
fourth state.

### Resolving the board view

After a `Board` answer names a GitHub Project, or a carried row names one
and no view, resolve the view before the approve prompt. The project is
the human's to name, however many `gh project list` returns.

List its views. Query both roots, since a user-owned project makes
`organization` null and an org-owned one makes `user` null, and read the
non-null `projectV2`:

```bash
gh api graphql -f query='
query($owner:String!, $number:Int!) {
  organization(login:$owner) {
    projectV2(number:$number) {
      title
      views(first: 20) { nodes { name layout number } }
    }
  }
  user(login:$owner) {
    projectV2(number:$number) {
      title
      views(first: 20) { nodes { name layout number } }
    }
  }
}' -F owner=<owner> -F number=<number>
```

Keep only `BOARD_LAYOUT` nodes. A table or roadmap view is not a board.

| `BOARD_LAYOUT` views | Do |
|---|---|
| None | Leave the row `unknown`, and say the project has no board view |
| Exactly one | Write it into the row without asking |
| More than one | Ask, offering the view names |

```
Board view: <project title> has more than one board: <view>, <view>,
and <view>. Which one should this repo use? Cards still move by the
project's Status field; the view is what a reader of the bindings looks
at. Name the view, or press enter to leave Board unknown.
```

An answer matching a listed view fills the row. Any other answer, none, or
a failed lookup (wrong number, no access) leaves the whole row `unknown`.
The row always names a view with its project.

## The approve prompt

```
Issues to file (4): nothing is written or filed until you confirm

| # | Title                                                    | Labels                   |
|---|----------------------------------------------------------|--------------------------|
| 1 | [Task]: Add an issue template with acceptance criteria   | repo-setup, issue-intake |
| 2 | [Task]: Label issues by area of work                     | repo-setup, issue-intake |
| 3 | [Task]: Triage newly opened issues automatically         | repo-setup, issue-intake |
| 4 | [Task]: Run the verification suite on every pull request | repo-setup, ci           |

Already filed, skipping: automated-review-workflow (an automated code
  review on every pull request), already open as #31
Could not determine: board, not answered above, so no card gets moved
  until a row names one

Three things happen if you confirm.

This repo's CLAUDE.md gains a "### Dev flow bindings" section: a short
table of this repo's own values (default branch, the commands that verify
a change, the tracker, the board) that these processes read instead of
guessing at them. It goes into your working tree uncommitted. The end of
the run offers to land it, and anything else the run writes, on a branch
with a draft pull request.

The 4 issues above are filed in this repo's tracker.

And this repo's task orchestrator, Cezar, is configured on this machine:
.ai/cezar/config.json is written from those bindings, its base branch
taken from the branching model above. That directory is git-ignored, so it
does not arrive with a clone. The file is shown before it is written.

Write the CLAUDE.md table, file these 4, and configure Cezar? (yes /
drop some / edit a title / no, enter accepts yes)

  drop some, edit a title: revise the issue list above. Neither touches
  the CLAUDE.md table, which is written exactly as printed, or not at all.
```

Every row carries `repo-setup` beside its area label: dedup and every
re-run key on it.

**Every gate variant names every write it releases**, in the order they
are written: bindings, issues, E2E scaffold, orchestrator. A new variant
inherits the rule.

| Effect | Named when |
|---|---|
| Bindings | Always |
| Issues | The tracker is GitHub Issues |
| Orchestrator | The `Task orchestrator` row names a supported orchestrator and this machine is not configured to what the bindings derive. That covers the developer who just answered and every later clone |
| E2E scaffold | `apptension-e2e-testing` is in the session, the `e2e-scaffold` entry came back `missing`, and the `E2E` row is neither `not adopted` nor a spec dir |

The orchestrator sentence never says *because you named Cezar*: most
readers cloned a repo where someone else did. A `none`, `unknown` or
absent row, or a machine already configured to match, leaves the effect
out.

The E2E effect reads: "And this repo's E2E scaffold gets set up:
`e2e-setup` writes `e2e/web/` from the repo's own package manager and
stack, shown before anything is written, the same as the bindings table
above." It releases the scaffold only. Proposing smoke tests reads and
boots the app, so step 6 asks it separately. The `E2E` row is the recorded
answer that stops the offer repeating: the probe checks one path, so a repo
that declined, or whose suite lives where `### E2E bindings` says, comes
back `missing` every run. The scaffold is a repo artifact, so once one
developer runs it the effect does not return for later clones.

The `Already filed, skipping`, `Could not determine`, `Installing
instead`, and on `solo` the `Not filed, this repo is not ours` lines are
part of the gate. They show what a bare "filing 4 issues" hides.

On `solo`, print the held-back entries, each with what it is: `Not filed,
this repo is not ours: automated-review-workflow (an automated code review
on every pull request), intake-workflow (labelling and duplicate-checking
newly opened issues)`.

**Enter accepts `yes`.** Both tables are on screen immediately above a
question that names its effects in full, so enter is a deliberate answer,
and the common case is an operator who read the tables and agrees.

**`drop` and `edit` revise the issue table and re-prompt.** An
all-or-nothing prompt gets answered `no` when one row does not apply,
losing the rest. The prompt says neither touches the bindings, since two
bare verbs beside a sentence about a file read as if they might.

| Answer | Result |
|---|---|
| `yes` | Run the post-approval sequence in step 5 |
| `drop some`, `edit a title` | Revise the issue table and print the prompt again |
| `no` | Write nothing, create no label, file nothing, and go to step 6. `no` declines bindings and issues together |

## Non-GitHub tracker

A tracker setup cannot file into gets no issue table. Print the bindings
and the backlog as a markdown table, saying plainly that setup cannot file
into that tracker, then:

```
One thing happens if you confirm. This repo's CLAUDE.md gains a
"### Dev flow bindings" section: a short table of this repo's own values
(default branch, the commands that verify a change, the tracker) that
these processes read instead of guessing at them. It goes into your
working tree uncommitted. The end of the run offers to land it on a branch
with a draft pull request.

Nothing above gets filed. This repo's tracker is not one setup can file
into, so the list of gaps is yours to carry over wherever you track work.

Write the CLAUDE.md table? (yes / no, enter accepts yes)
```

Under Jira the prompt also names the server entry, per
[jira.md](jira.md#the-bindings-only-prompt). The orchestrator and E2E
effects apply on the same terms as the GitHub variant, and the question
names each one that applies: `Write the CLAUDE.md table and configure
Cezar?`, `Write the CLAUDE.md table and set up E2E?`, or both.

`yes` runs the effects named, and no `gh` call goes to the tracker: not
the label create, not an issue. `no` writes nothing. There is no `edit`:
this path has no issue table. A human who wants another value edits the
written section afterwards, or answers `no` and says what it should be.

The backlog lists every gap, including those step 0 held back on `solo`,
marked as the owner's call. Nothing is filed here, so the printed list is
the only place a gap appears.
