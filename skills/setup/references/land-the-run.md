# Land the run

Read when the operator answers `yes` to step 6's landing offer. The inputs
are the ones the prompt named: the base branch, the branch name, the commit
subject and the file list, plus the run-start commit step 1 recorded.
`<scratchpad>` is a throwaway directory outside the repository tree.

Do the steps in order. Each stop leaves everything as the last finished
step left it, and says so: what moved, what did not, and the command that
finishes the job by hand.

## 1. Fetch and check for drift

```bash
git fetch origin
git diff --quiet <run-start> origin/<base> -- <every listed path>
```

Exit 0 means the base holds the same copy of every listed path as the
commit the run started on, so the run's files apply to it unchanged. The
run lands each file whole, so any difference there is one the commit
would overwrite.

| Result | Do |
|---|---|
| Fetch fails | Stop. Nothing moved |
| `git diff` exits 1 | Stop. Name each path `git diff --name-only <run-start> origin/<base> -- <paths>` prints, and say that `origin/<base>`'s copy differs from the one this run started from: the base moved on, or the checkout was behind it or on another branch. Landing the run's copy would overwrite that difference. Nothing moved |
| Both exit 0 | Continue |

## 2. Cut the branch

Copy each listed path into `<scratchpad>`, keeping its relative path. Then:

```bash
git switch -c <branch> --no-track origin/<base>
```

Uncommitted writes carry across the switch. A listed file that a commit on
the starting branch already holds, such as an orchestrator's turn-end
autosave, resets to the base's copy. The next step puts it back.

Git refusing the switch is a stop: the checkout is still on its starting
branch and nothing moved. Name the files git printed.

## 3. Restore and commit

Copy every file from `<scratchpad>` back over its path, then:

```bash
git add -- <every listed path>
git commit -m "<subject>" -- <every listed path>
```

The pathspec on `git commit` commits the listed paths and nothing else, so
a change the operator had staged before the run stays staged and out of the
commit. Check the commit with `git show --name-only --format= HEAD`: it
names exactly the listed paths.

## 4. Push and open the draft pull request

```bash
git push -u origin <branch>
```

A failed push is a stop: the commit sits on the local branch. Name the
`git push` command that finishes it.

When the `Code host` row is not GitHub, go to step 5. The prompt already
said the pull request is the operator's to open.

On GitHub, write the body to `<scratchpad>/pr-body.md`, then open the
pull request:

```bash
gh pr create --draft --base <base> --head <branch> \
  --title "<subject>" --body-file <scratchpad>/pr-body.md
```

A failed `gh pr create` is a stop: the branch is pushed and no pull request
exists. Name the command that finishes it.

The body is the change and nothing else, written by the
[Issues stand on their own](issues.md#issues-stand-on-their-own) rule, so
it names no process, plugin or checklist:

```markdown
## Summary

Records this repo's own values for branches, verification, review and the
tracker in `CLAUDE.md`, and adds the files that put them to work.

## What changed

- `CLAUDE.md`: a `### Dev flow bindings` table, 10 rows.
- `.github/workflows/automated-code-review.yml` and 8 supporting files
  under `.github/`: an automated code review on every pull request.
- `.github/ISSUE_TEMPLATE/task.yml`: a task form that asks for acceptance
  criteria.

## Related issues

Opened alongside this change, still open: #42, #43
```

Group files by the writer that produced them, one line per group, saying
what the group does for this repo. `Related issues` lists every issue the
run filed, with no closing keyword: the change records the gaps and fixes
none of them. A run that filed none leaves the section out.

## 5. Report

Report the branch, the commit's short SHA and, on GitHub, the pull request
URL. Say that the checkout is now on `<branch>`, and name the branch it
started on, which is unchanged.

Done when the pull request is open, or the branch is pushed on another
code host, or the run stopped at a step above and
said what to finish by hand.
