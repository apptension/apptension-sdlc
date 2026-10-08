---
name: prune-worktrees
description: Worktree pruning, called by implement-issue and pr-checks. Removes worktrees whose pull requests merged, sweeping from the current checkout or from the main checkout.
---

# Prune worktrees

A worktree whose pull request merged stays on disk until something removes
it. Claude Code passes every worktree to its sandbox deny list as bash
arguments, so a long list passes the OS command-length limit and every bash
call fails.

## Prune merged worktrees

The one operation. The caller names the checkout to sweep from.

| Checkout | Called when |
|---|---|
| `current` | `implement-issue` step 3, before the branch or worktree is created |
| `main` | `pr-checks`, when the pull request merged |

1. Go to the checkout. `current`: stay where the session is. `main`: move
   to the main checkout, so the sweep can remove the worktree the session
   ran in:

   ```bash
   MAIN=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)
   cd "$MAIN"
   ```

2. Run the sweep. The runtime sits in `tools/prune-worktrees/` beside this
   `SKILL.md`. The subshell keeps the session in the checkout:

   ```text
   SKILL_DIR=<the directory holding this SKILL.md>
   REPO=$(git rev-parse --show-toplevel)
   (cd "$SKILL_DIR/tools/prune-worktrees" && uv run python -m prune_worktrees "$REPO")
   ```

Done when the sweep exits 0. Exit 1 is a failed `gh` call and this
operation's failure: report it to the caller.

The sweep removes a worktree when its current GitHub pull request merged
and the branch tip still matches that pull request's head. It keeps open,
closed-unmerged and no-PR worktrees, and the current, dirty and locked ones,
merged or not. A worktree is dirty when it holds a change, an untracked
file, or an ignored file outside `node_modules/`, `.venv/` and the Python
cache directories. Then it runs `git worktree prune`.

When `tools/prune-worktrees/pyproject.toml` is absent from this skill's
directory, say so in one line and report done: this run skips the sweep.
Only the runtime applies the keep rules above, so every worktree stays in
place, with no `git worktree remove` run by hand.
