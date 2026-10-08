# Filing issues

Read at step 5, to dedup against open issues and write each issue body.

## Dedup

The first line of every body is the dedup marker, carrying the entry's id
and its `source`:

```
<!-- repo-setup:<id> source:<source> -->
```

Re-runs dedup on the id. The `source` lets a later `dev-flow` run recover
which skill the issue is an instance of, with no internal name on screen.
Rendered markdown hides the line.

Before drawing up the table, list the open issues. The read is safe before
the gate:

```bash
gh issue list --label repo-setup --state open --json number,body
```

Skip every entry whose `repo-setup:<id>` appears in a returned body. Match
the id alone, never the whole marker: issues filed before `source` existed
carry a marker without it. In a repo never set up, an error or an empty
result means nothing is filed yet. The label is created after the gate.

## The body

Bodies follow the `issue-authoring` skill: the same template, the same
shipped-outcome acceptance criteria. Labels are `repo-setup` plus the
entry's `area`. The body is exactly this, in this order:

```markdown
<!-- repo-setup:<id> source:<source> -->

## Context / Why
<up to 80 words, per the budget table in the `issue-authoring` skill: what the
repo does today without this artifact and what that costs, in the repo's
own terms: its Stack, its host, its CI provider, its default branch,
taken from the bindings step 4 composed.>

## What needs to be done
<the entry's `intent`, verbatim, as the outcome to achieve>

Concretely, for this repo: <how that outcome lands given the Stack: the
commands this repo actually runs, the manifest the workflow installs
from, the runtime version it pins.>

### Access it needs
- <each `grants` string, verbatim, one bullet each, in checklist order>

## Acceptance Criteria
- [ ] <shipped, verifiable outcome>
- [ ] <shipped, verifiable outcome>
```

- Render `intent` and each `grants` string verbatim from `checklist.json`.
  They are written for a reader who has never seen this process, and two
  runs then file the same issue for the same entry.
- `### Access it needs` appears only when the entry has a `grants` key.
  For an entry without one, omit the heading: never "none", "n/a" or an
  empty list.
- `Concretely, for this repo` is written for the stack the repo declared:
  its workflow, template or label set, composed fresh for that stack.
  Never paste a workflow from elsewhere, and never write one for a stack
  the repo does not use. With `Stack` at `unknown`, say so in the issue
  and ask for it there.
- Add `## Out of scope` only when the entry's boundary against another
  entry in the same batch is genuinely unobvious.
- The `source` travels in the marker and nowhere visible.

## Issues stand on their own

Each issue argues on the repo's own terms: the problem it solves there. A
reader of the filed issue has never heard of this SDLC, the
`apptension-sdlc` plugin, the checklist or this setup process, so the body
names none of them, as justification or as a bare pointer. An internal
skill name such as `issue-authoring` reads as a loose end in a repo that
has never seen the plugin. The hidden marker carries the trace.

> **No:** "The SDLC checklist expects `.github/ISSUE_TEMPLATE/task.yml`; this
> repo doesn't have one."
>
> **Yes:** "Issues here are filed as free text, so they arrive without
> acceptance criteria and often without enough context for someone to start
> work. A template with Context / What / Acceptance Criteria fields makes the
> gap visible at filing time."

The label is `repo-setup`, never `sdlc-setup`: it shows on every issue and
reads as a claim about whose process the issue serves.

## Labels

Apply an area label only when it already exists in the target repo.
Otherwise file with `repo-setup` alone: `gh issue create --label
issue-intake` fails on a missing label, and a failed create is worse than
a less tidy issue. Setup creates only `repo-setup`, after the gate. The
`area-labels` issue covers the vocabulary, which is the repo's decision.

## project-verification-skill

Draft a creation issue only for the `None` result. Its `Concretely, for
this repo` names `create-verification-skill` and the project's stack and
existing driving tools. Acceptance criteria require project-owned Launch,
Doctor, Drive, Evidence and Cleanup instructions, a source-grounded feature
map, one executed feature, and evidence that remains after cleanup. Keep
product CLI implementation and E2E suite authoring out of it. Its marker is
`<!-- repo-setup:project-verification-skill source:create-verification-skill -->`.

Before drafting it, fetch all open setup issues, following pagination:
`gh api --paginate --slurp` on
`repos/<owner>/<repo>/issues?state=open&labels=repo-setup&per_page=100`,
ignoring pull-request entries. A `repo-setup:project-verification-skill`
marker followed by whitespace or the comment terminator skips creation and
reports the existing number. A failed lookup is `unknown` and blocks
filing this gap. The runtime's `discover --issues <json-file>` accepts the
paginated JSON and applies the same rule.

## release-age

`Concretely, for this repo` lists each failing root from Check in
[release-age.md](release-age.md#check), one bullet each:

- the root's directory and manager, and what is missing: the setting, the
  floor, or a value below the threshold, quoting the value found;
- the lines to add, composed in the file's own syntax from the Managers
  table's setting, value and floor;
- each CI job that installs with that manager on a runtime below the
  floor, with the bump. A repo with no CI says so in one line.

Add the matching bot line from that file's Bots section when the repo has
a Dependabot or Renovate config. The acceptance criteria:

- every root listed above carries the setting, and the floor where its
  manager has one;
- every uv lock is regenerated and records `exclude-newer-span`;
- every CI job that installs dependencies runs a package-manager version
  at or above the floor, where the repo has CI and the manager has a
  floor;
- the bypass path for each listed manager is written in the repo's
  contributing guide, or its README when it has none, created if the repo
  has neither.
