# PR body

Read at step 10, before `gh pr create`, on every run.

## Structure

Take the body's structure from the repo's own pull request template, first
hit wins, else [pr-body-template.md](pr-body-template.md):

- `.github/pull_request_template.md`
- `PULL_REQUEST_TEMPLATE.md` at the repo root
- `docs/pull_request_template.md`
- a `PULL_REQUEST_TEMPLATE/` directory in `.github/`, the root or `docs/`:
  the template whose subject matches the work, or its only file

Matching is case-insensitive (`.github/PULL_REQUEST_TEMPLATE.md` is the
first).

Under a repo template, map step 10's fields onto its sections:

| Field | Section |
|---|---|
| Summary | Its what-and-why section |
| Verification | Its testing or QA section |
| Ticket reference | Where it puts issue references, else at the top |
| A field with no home | Its own section, appended under the field table's heading |

## Agent context goes in a comment

Detail for an automated reviewer (rejected alternatives and why, gate
criteria checked, a file the diff buries) goes in a PR comment:

- Optional; only for real detail beyond the body. No length limit, no
  ASD-STE rule. Start it with a bolded `**Agent context**` line.
- Decide before `gh pr create`. A body this comment will follow carries
  `<!-- agent-context -->` on its own line, which holds the review up to 5
  minutes for the comment.
- Post it from the PR author's account, right after the PR opens: the CI
  review reads only the author's comments.

```bash
gh pr comment <N> --body "$(cat <<'EOF'
**Agent context** — execution detail, not part of the description.

<rejected alternatives, gate criteria checked, buried file paths>
EOF
)"
```

Write facts a reviewer would otherwise rediscover; reviewers check stated
reasons against the diff.
