# prune-worktrees

Remove git worktrees whose GitHub pull requests have merged, then run
`git worktree prune`.

```bash
uv run python -m prune_worktrees /path/to/repo
```

Open, closed-without-merge, and no-PR worktrees stay. The current
worktree, any dirty worktree, and any locked worktree stay even if
merged. A worktree is dirty when it holds a change, an untracked file,
or an ignored file outside `node_modules/`, `.venv/` and the Python
cache directories, which every checkout rebuilds. An open PR wins.
Otherwise the newest created PR for the branch is the one that counts,
and a merged PR only removes the worktree when the branch tip still
matches that PR's head. A failed `gh` call exits 1.
