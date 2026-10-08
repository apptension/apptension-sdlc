---
name: install-task-template
description: Use when a repo has no `.github/ISSUE_TEMPLATE/task.yml`. Writes one from a bundled template, filling the Area dropdown from the repo's own labels instead of another repo's taxonomy. Trigger on intent like "add a task template", "this repo has no task.yml", when `issue-authoring` finds no template to file against, or when the setup skill offers it for the `issue-template` gap. Safe to re-run, and an existing task.yml is left as it is.
requires:
  - id: issue-template
    label: Structured issue template
    area: issue-intake
    detect:
      path: .github/ISSUE_TEMPLATE/task.yml
    intent: >-
      A new issue captures the context, the concrete change, and a
      verifiable definition of done before work starts, instead of
      leaving whoever picks it up to reconstruct that from a blank text
      box. An outward-facing form that asks a stranger to report a bug
      does a different job, so the repo needs a template of its own for
      internal tasks even where other forms already exist.
---

# Installing the task issue template

This skill writes `.github/ISSUE_TEMPLATE/task.yml` into a repo that has
none, from the template in `templates/`. One `%%AREA_OPTIONS%%` token
carries the only thing that differs per repo, the area taxonomy its own
labels already declare.

`issue-authoring` is the other half. It files issues against this
template and documents what belongs in each field; it installs nothing,
and this skill drafts no issues.

## Why any form is not enough

A repo forked from a boilerplate arrives with `bug_report.yml`,
`feature_request.yml` and `config.yml` already in
`.github/ISSUE_TEMPLATE/`. Those forms interrogate a stranger about a
problem the maintainers have not seen, and they carry code-of-conduct
checkboxes. An internal task is the opposite shape, so the
`issue-template` requirement above probes `task.yml` by name. A repo
carrying those inherited forms and no `task.yml` reports the gap, which
is the case this skill exists for.

## Where the requirement applies

`.github/ISSUE_TEMPLATE` is a GitHub concept, so the `issue-template`
entry is applicable only where the repo's `Issue tracker` binding reads
GitHub Issues. Under Jira the entry is not applicable, and an audit
neither reports it present nor files it as a gap. Step 1 of the procedure
is what holds that line for a direct invocation, which reaches this skill
without an audit in front of it.

## What this installs

| Template | Target in the repo |
|---|---|
| `task.yml` | `.github/ISSUE_TEMPLATE/task.yml` |

The fields, their order, their `id` values and the `[Task]: ` title
prefix install unchanged in every repo. `issue-authoring` documents what
belongs in each one, so the two stay in step.

## The one token

`%%AREA_OPTIONS%%` resolves from the target repo's labels. Read them
first:

```bash
gh label list --repo <owner>/<repo> --limit 1000 \
  --json name,description,isDefault
```

Drop every label whose `isDefault` is `true` (GitHub's own nine, even
where the repo renamed one). From what remains, identify the repo's area
taxonomy by label names and descriptions, the same read `issue-authoring`
performs to pick one area label while filing. This skill takes the whole
taxonomy rather than a best fit.

Render one option line per label, indented eight spaces, in name order so
two runs produce the same file. Every option is a label the read returned,
so the toolkit's own seven areas stay out of a repo that never declared
them, and so does any other repo's set. An operator who wants the options
in a lifecycle order rather than alphabetical says so at the gate.

**Double-quote every rendered label, escaping `\` and `"` inside it.** A
GitHub label name is free text, and the shapes that break an unquoted YAML
sequence item are the common ones rather than the exotic ones. `area: ci`
parses as a mapping, `#needs-review` as a comment leaving a null item,
`true` as a boolean, and `1.0` as a number. GitHub's issue-form schema
requires each dropdown option to be a string, so an unquoted option is a
form that fails to render or an area whose value silently changed. The
template ships the token already quoted for this reason, and the rendered
lines keep those quotes.

When the read finds no area taxonomy, delete the whole
`- type: dropdown` block whose `id` is `area` and install the remaining
fields. The `area-labels` requirement is what files the missing taxonomy.
Adding the dropdown afterwards is a hand edit, because a later run of this
skill stops at the file it already wrote and never touches its contents.

## The install procedure

1. **Confirm the tracker is GitHub Issues.** Read the `Issue tracker` row
   from the repo's bindings table, in `CLAUDE.md` or in `AGENTS.md` where
   that is the repo's agent-instruction file. A row naming any other
   tracker stops the run, and the report says the artifact does not apply
   there. No row at all means the value is not recorded rather than
   GitHub, so ask one question instead of guessing, because a GitHub
   remote is no evidence either way. A Jira-tracked repo is usually
   hosted on GitHub too. `gh repo view --json hasIssuesEnabled` is worth
   showing alongside the question, and a repo with Issues disabled stops
   without one.
2. **Pre-flight.** `gh auth status` succeeds and the repo has a remote
   the label read can name. Read `.github/ISSUE_TEMPLATE/` and list what
   is there. A missing prerequisite is named to the human, not worked
   around. An unauthenticated `gh` is one of them and it stops the run,
   because the label read never happens, so nothing is learned about the
   areas, and a dropdown built on that silence would claim the repo has
   none.
3. **Check for an existing `task.yml`.** A file at the target path makes
   this run a no-op. Report its path and stop. Presence decides, not
   content. A repo's own task template is the repo's, and judging it
   against this one is the maintainers' call rather than this skill's.
4. **Resolve `%%AREA_OPTIONS%%`** per the section above, then render the
   template in memory. Keep the resolved label list, because step 7
   compares the written file against it, and the render is done when the
   file's options equal it.
5. **The gate.** Present one approval carrying the target path, the
   rendered file in full, and which labels became options (or that the
   dropdown was dropped, and why). Nothing is written until the human
   approves.
6. **Write** the approved file and leave it uncommitted. No staging, no
   commit, no branch, no push, no pull request. The operator lands it
   through the repo's own flow.
7. **Check the render landed.** Read the written file back and compare
   its structure to what step 4 resolved. The `area` field's options are
   exactly the selected labels, in the same order, or the field is
   absent where the dropdown was dropped. Every other field matches the
   template. A mismatch is a failed install to fix before reporting
   done.

   Check the structure rather than grepping for leftover token text. A
   label name is free text, so any string a probe searches for is a name
   some repo could legitimately use, and the check would then reject a
   correct install. Comparing options against the labels they came from
   has no such case, and it also catches a render that dropped or
   reordered one.
8. **Report** the path written, the options it carries, and that
   `issue-authoring` now has a template to file against. Where the
   dropdown was dropped, say that adding it later is a hand edit, so an
   operator who is about to fix the labels knows it does not follow on
   its own. Where `config.yml` sets `blank_issues_enabled: false`, say
   so, because until this file lands the repo's web form offers a human
   nothing but the inherited outward-facing forms.

## After the install

The operator commits the file through the normal flow, and the next issue
opened in the repo's web UI renders the new form. Issues filed with
`gh issue create` bypass the form and carry the area as a label instead,
which `issue-authoring` covers.
