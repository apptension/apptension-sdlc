# Printing the summary

Read at step 6, before printing.

The group names in step 6's table are this skill's shorthand. Printed,
each carries a short gloss at first use, and every entry id prints with
what it is. Two groups print in plain words: `unknown` as `Could not
determine`, because the group holds two kinds of thing, and *Candidates*
as `Checked with you`, a state the operator was never taught.

Gloss each once. A summary that re-explains every mention reads as
condescending by the third group.

```
Present: the processes need these, and this repo already has them
  CI running this repo's build, lint and test commands on every pull
  request (ci.yml, which you confirmed above)

Written: the "### Dev flow bindings" table in CLAUDE.md, 10 rows: this
  repo's own values, in one place, so every process reads the same ones
  instead of guessing. One row is still unknown, below.
  Files, all uncommitted:
    CLAUDE.md
    .github/ISSUE_TEMPLATE/task.yml
    .ai/cezar/config.json, stays on this machine: git ignores it

Filed: one issue per missing piece, in this repo's tracker
  #42 issue-template: a form for filing issues that asks for acceptance
  criteria, so work arrives with a definition of done

Reported, not filed: gaps that produced no issue, and why
  intake-workflow (labelling and duplicate-checking newly opened issues):
  filing it would commit this repo's owner to a paid AI credential, so
  it is theirs to decide; raise it with them

Could not determine: two kinds: a check that did not run, so nothing was
learned either way, and a value setup could not read out of this repo
  whether issues here are labelled by area of work: gh is not
  authenticated, so the label list never came back and nothing was
  concluded from that either way
  board: no project is tied to this repo, so no card gets moved until a
  row names one

Skipped as duplicate: an issue for this was open before this run
  #31 automated-review-workflow: an automated code review on every pull
  request

Checked with you: the files that looked right, and how you answered
  ci.yml: you confirmed it runs this repo's build, lint and test
  commands, so nothing was filed for it
```

Where step 4 composed no `.mcp.json` because an existing one does not
parse, say so in `Written`, so an operator whose entry was left alone
learns it from the run.

Close with the filed issues: they are worked one at a time through the
`dev-flow` skill, like any other issue in the tracker, and now have the
bindings they would otherwise have guessed. Setup starts none of them and
picks none.
