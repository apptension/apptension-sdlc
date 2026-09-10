# Prune merged worktrees

Worktrees whose pull requests have merged stay on disk until something
removes them. Claude Code puts every worktree on a sandbox deny list
that is passed as bash arguments, so a long list blows past the OS
command-length limit and every bash call fails.

## Command

Locate the installed plugin root: the directory that contains both
`tools/prune-worktrees/pyproject.toml` and a `skills/` directory.

```text
PLUGIN_ROOT=<that directory>
TOOL_ROOT="$PLUGIN_ROOT/tools/prune-worktrees"
REPO=$(git rev-parse --show-toplevel)
cd "$TOOL_ROOT" && uv run python -m prune_worktrees "$REPO"
```

Completion: the command has exited 0. Worktrees whose current GitHub PR
is merged are gone, only when the branch tip still matches that PR's
head. Open, closed-without-merge, and no-PR worktrees remain. The
current worktree, any dirty worktree, and any locked worktree remain
even if merged. `git worktree prune` has run. A failed `gh` call exits
1. That is not an empty sweep.

If `tools/prune-worktrees/pyproject.toml` is missing, say so in one line
and continue. Do not invent a shell substitute.

## When

`dev-flow` step 3, before branching or adding a worktree.

`pr-checks`, when the stop is merge. First move to the main checkout so
this worktree can be removed, then run the command with `REPO` set to
that checkout:

```bash
MAIN=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)
cd "$MAIN"
```

A PR closed without merging does not run this.
