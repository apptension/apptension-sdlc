# Workspace

Read at step 3, on every run. Do the sections in order.

## 1. Resolve the integration branch

The integration branch is the one the bindings' `Branching model` row names
as where feature work starts and lands. Read it off that row only, never
off the default branch or the remote's branches. GitHub flow: the default
branch. Git flow: `develop`.

Resolve the row to a branch name first and decide from that, never from the
literal `unknown` alone.

| `Branching model` row | Do |
|---|---|
| Names a branch | Branch from it |
| Absent | Use `Default branch`, say the absent-row line below, continue. If `Default branch` is also absent or `unknown`, stop and ask |
| `unknown` | Stop and ask, with the `unknown`-row line below |
| Present, no branch in it (e.g. `git flow` alone) | Stop and ask, as for `unknown` |

Absent row:

> The bindings here have no `Branching model` row, so this branch starts
> from `Default branch` — `main` — as the flow did before that row existed.
> If feature work here branches off something else, say so; rerun
> `setup` to record it for the next issue.

`unknown` row:

> `Branching model` is `unknown` in the bindings, so there is no branch to
> start from. Which branch does feature work here branch off and merge back
> into? Answering unblocks this issue; rerun `setup` to
> record it for the next one.

## 2. Prune merged worktrees

Before the branch or worktree is created, invoke `prune-worktrees` from the
`current` checkout. Done when it reports done; a failure it reports is this
step's failure.

## 3. Cut the branch

| Case | Do |
|---|---|
| Standalone, and the ticket has a local branch from a stopped run | Switch to it and cut none, per [standalone.md](standalone.md#resuming-a-stopped-run) |
| Another issue is in progress in the checkout, the tree cannot be made clean, or the change is broad enough to want a throwaway workspace | Add a worktree |
| Otherwise | Stay in the main checkout |

Main checkout:

```bash
git fetch origin
git switch -c <type>/<slug> --no-track origin/<integration branch>
```

Worktree:

```bash
git worktree add ../<slug> -b <type>/<slug> --no-track origin/<integration branch>
```

A new worktree starts with no dependencies installed. Install them in it
with the repo's own install commands, as its bindings file describes,
before step 6. Done when those commands exit 0 in the worktree.

Always pass `--no-track`: the upstream is set only by step 9's
`git push -u origin HEAD`.

## 4. Ignore the design's working files

Right after the branch is cut, on every track, list which design working
paths the root `.gitignore` lacks:

```bash
cd "$(git rev-parse --show-toplevel)"
for p in docs/superpowers/specs/ docs/superpowers/plans/ .superpowers/; do
  grep -qxF "$p" .gitignore || echo "$p"
done
```

No output: done. Otherwise append the printed paths to `.gitignore`, say in
one line which you added, and name those lines in the PR body's
`Design decision` field. Report how many files
`git ls-files docs/superpowers .superpowers` returns, and leave them
tracked.
