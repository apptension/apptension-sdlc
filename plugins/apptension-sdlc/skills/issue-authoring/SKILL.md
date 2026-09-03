---
name: issue-authoring
description: Use when drafting a new issue for this repo's tracker — filing it directly via `gh issue create` under GitHub, against `.github/ISSUE_TEMPLATE/task.yml` with the SDLC area conveyed as a label instead of the form's dropdown, or via `createJiraIssue` under Jira — with acceptance criteria that describe shipped work rather than a design-only outcome. Trigger on intent like "file an issue for X", "draft a GitHub issue", "let's write up this issue", or "open a task for this".
requires:
  - id: issue-template
    label: Structured issue template
    area: issue-intake
    detect:
      path: .github/ISSUE_TEMPLATE/*.y*ml
    intent: >-
      A new issue captures the context, the concrete change, and a
      verifiable definition of done before work starts, instead of
      leaving whoever picks it up to reconstruct that from a blank text
      box.
  - id: area-labels
    label: An area taxonomy applied to issues
    area: issue-intake
    detect:
      labels: [getting-started, foundation, dev-flow, ci, issue-intake, pm, other]
      min_count: 3
    intent: >-
      Every issue is tagged with the area of the system or process it
      touches, using a taxonomy the repo defines for itself. That keeps
      issues filterable and groupable by area, gives label-picking
      automation an existing set to choose from, and keeps a project
      board's columns or swimlanes meaningful instead of one
      undifferentiated backlog.
---

# Authoring a well-formed issue

How to draft a well-formed issue for this repo's tracker, and file it —
against `.github/ISSUE_TEMPLATE/task.yml` with `gh issue create` under
GitHub, or with `createJiraIssue` under Jira. A human or an agent filing
the next issue follows this before typing a title.

## Write it for a human

A person reads the body to decide whether to pick the issue up. Write to
that person: professional, clear, and conversational, addressed to an
engineer on your team rather than to a parser. If you would not send the
sentence in Slack, rewrite it.

Keep each section inside its budget. Anything longer belongs in an
agent-context comment.

| Section | Budget |
|---|---|
| Title | ≤ 10 words, imperative, no trailing period |
| Context / Why | ≤ 80 words |
| What needs to be done | ≤ 140 words, or a list |
| Acceptance Criteria | one line each, ≤ 20 words, ideally ≤ 7 items |
| Related links | one line each: the link, then why it matters |
| Out of scope | one line each: the thing, then where it belongs |

More than seven criteria usually means the issue bundles two changes, so
check that before you split a criterion in two.

Do not:

- restate the process the reader already follows
- hedge ("this should probably", "it may be worth")
- clear your throat before the point
- explain why a section exists

Before:

> It would probably be worth considering whether we should update the generator so that, in line with how the rest of the pipeline already works, the manifest emitted for Cursor also handles the case where an entry has no `repo` field.

After:

> The Cursor manifest drops entries that have no `repo` field. Emit them.

## Style rules

The budgets above bound the length. These rules bound the sentence. They
cover the title and the body, and the agent-context comment keeps its own
convention, which a later section states.

### Words

- **One name per thing.** Pick the repo's name for a file, a command, or
  a concept, then repeat it. Never alternate `release-config.yml`, "the
  release file", and "the config", because the variation reads as a second
  thing.
- **Use the identifier, not a description of it.** Write a path, a flag,
  a line number, or `gh issue view <N> --json comments`. A described
  thing has to be searched for.
- **Gloss a term of art at first use, in eight words or fewer.** This
  covers process vocabulary such as *binding*, *candidate*, or *design
  gate*. Standard technical terms need no gloss, because they are the
  approved words of this trade.
- **Give a pronoun its noun in the same sentence.** When the noun sits a
  sentence back, repeat it instead of writing "it", "this", or "they".
- **Expand an acronym at first use**, unless the repo already uses it
  bare: CI, PR, AC, UI, API, SDLC.

### Sentences

- **Use active voice, and name who acts.** "We generalized the skill."
  "The generator drops entries that have no `repo` field." Reach for the
  passive only when the actor is genuinely unknown, and never launder a
  person into a passive to sound neutral.
- **Choose strong verbs.** Avoid *is*, *are*, *was*, *were*, *occur*, and
  *happen*, because a generic verb usually hides the actor. "The
  generator drops the entry" beats "the entry is dropped". The same fix
  clears "there is" and "there are": delete the phrase and promote the
  real subject, so "There are four checks that run" becomes "Four checks
  run".
- **Carry one idea per sentence, and vary the length.** Prose averages 15
  to 20 words a sentence, and a criterion stays under 20. If three
  sentences in a row run the same length, rewrite one.
- **Turn a sentence that hides a list into a list.** A sentence carrying
  an "or" chain, or three tasks in a row, reads better as bullets.
- **Split a subordinate clause only when it starts a second idea.** This
  one is optional, and it backfires when applied hard. Keep the clause
  that carries the reasoning, because cutting every *but* and *because*
  is what makes a body read like a machine wrote it.
- **Use the imperative for work to be done.** "Add `comments` to the
  field list", not "the field list should probably include comments".
- **Keep the transition word that carries the logic**: *but*, *because*,
  *so*, *then*, *although*. Do not split "X, but Y" into two flat
  sentences, and do not downgrade *but* to *and*. Prefer the short
  connective to the formal one, so *but* beats *however*. The transition
  also has to be true, because *however* between two sentences that do
  not contrast is worse than none.
- **Give every sentence a verb.** "Design gate: fails the direct track"
  is a label, not a sentence.
- **Cut hedges, filler, and adjectives of degree.** Replace the adjective
  with the number: "694 words", not "very long".

  | Don't write | Write |
  |---|---|
  | utilize, leverage | use |
  | in order to | to |
  | at this point in time, currently | now, or delete |
  | functionality, capability | name the feature |
  | perform a validation of | validate |
  | is able to | can |
  | for the purpose of generating | to generate |
  | it would be worth considering adding X | add X |
  | simply, just, obviously, actually, quite, very | delete |

- **Drop idiom, figurative verbs, and em-dashes.** "Nail down", "circle
  back", and "low-hanging fruit" all lose a reader who works in English
  as a second language. Standard technical phrasal verbs stay: set up,
  log in, check out, roll back.
- **Use *that* for an essential clause, and *which* for a nonessential
  one.** "The file that the generator writes" narrows which file you
  mean, so it takes *that* and no comma. "The Cursor manifest, which the
  strict validator rejects, ships broken on purpose" adds a fact the
  sentence survives without, so it takes *which* and a comma.

### Lists and tables

- **Introduce every list and table with a lead-in that ends in a colon.**
  A list under a bare heading has no stated subject.
- **Keep items parallel**, in one grammatical shape, and start an action
  item with a verb. Parallel covers capitalization and punctuation too,
  not only grammar.
- **Punctuate items one way, then keep it.** Our convention: capitalize
  the first word, unless the line opens with a case-sensitive identifier
  such as `setup.md`, and leave the terminal period off a checklist line.
- **Pick the shape from the content.** Use a table when each item has two
  or more attributes, a numbered list when order matters, and bullets
  otherwise.
- **Build a table a reader can scan.** Head every column, hold a cell to
  two sentences, and keep one kind of value in a column.

### Sections

- **Let the first sentence carry the point.** A reader who stops after
  one sentence per section still knows the ask.
- **Answer what, why, and how.** Context / Why names the problem, says
  why the reader should care, and shows how they can check that you have
  it right.
- **Delete any sentence the reader could have written.** The "Do not"
  list above names the four that come up most often. Stakes are not
  filler, so keep them.

### Formatting

- **Write one line per paragraph, with no manual line breaks.** An issue
  body or PR description is prose the reader's client wraps; a line break
  inside a sentence reads as two paragraphs. Let the terminal or the
  browser wrap it instead.
- **This does not cover this skill's own markdown source.** This file,
  like the rest of the SDLC skills, stays wrapped at its existing width
  for readability in an editor. The rule is about the artifact an agent
  writes, not the skill that teaches it.

### Self-check before filing

1. Read Context / Why aloud. If it sounds like a form, an actor or a
   connective is missing.
2. Search for "it", "this", and "they". Each one needs its noun in the
   same sentence.
3. List every name you gave the same thing. More than one is a bug.
4. Delete your favourite sentence. If nothing is lost, it was filler.
5. Have a colleague read it before you file. They need no knowledge of
   the subsystem, only an answer to one question: does this read like a
   person wrote it? That read catches what the rules miss.

## The default: every issue ends in shipped work

An issue's acceptance criteria describe what "done" looks like. In this
repo, "done" means working code merged, not a design produced. Write at
least one criterion naming the shipped artifact — the feature working, the
file generated, the test passing.

`dev-flow`'s design gate covers the *how*: an issue that fails its four
direct-track checks goes through `superpowers:brainstorming` and
`superpowers:writing-plans` first, but that work lands in the same issue's
branch and PR. Splitting off a follow-up issue is the exception, not the
outcome to write into the criteria up front.

## The template's fields

| Field | What belongs there |
|---|---|
| Title | `[Task]: <imperative summary>`. The template supplies the prefix; write the rest as an instruction ("Add X", "Fix Y"), not a topic label. |
| Context / Why | The problem, and why now. Cite the issue, PR, or incident that surfaced it. |
| What needs to be done | The concrete change. If the *how* is genuinely undecided, say so here and let the design gate route it through brainstorming. |
| Acceptance Criteria | A checklist of shipped outcomes, each verifiable by someone who wasn't in the room — a test, a command's output, a file that exists. |
| SDLC Area | A dropdown in the web form. This repo doesn't use the web form — see below. |
| Related links | Issues, PRs, specs, or docs this one depends on or extends. |
| Out of scope | What this issue deliberately does not cover, and where it belongs instead. |

## Filing routes on the tracker

Where the issue lands follows the repo's `Issue tracker` binding, the same
row `dev-flow` reads at its own step 1: GitHub Issues files below, Jira
files under [Filing under Jira](#filing-under-jira).

## Filing under GitHub: label instead of dropdown

Issues in this repo are filed directly with `gh issue create`, not through
GitHub's web form — so the "SDLC Area" dropdown is never actually
rendered. Convey the same information as one of the seven SDLC-area
labels instead: `getting-started`, `foundation`, `dev-flow`, `ci`,
`issue-intake`, `pm`, `other`. Every issue gets exactly one.

```bash
gh issue create --repo <owner>/<repo> \
  --title "[Task]: <imperative summary>" \
  --label <area> \
  --body "$(cat <<'EOF'
## Context / Why
<why this needs to happen>

## What needs to be done
<the concrete change>

## Acceptance Criteria
- [ ] <shipped, verifiable outcome>
- [ ] <shipped, verifiable outcome>

## Related links
<other issues, PRs, specs — omit the section if none>

## Out of scope
<deliberately excluded — omit the section if none>
EOF
)"
```

## Filing under Jira

No `gh` call runs on this path — not `gh issue create`, not even a
read like `gh label list` — the same rule the `setup` skill states for a
non-GitHub tracker. File directly with `createJiraIssue`:

    createJiraIssue(
      cloudId: "<site, from the Issue tracker row>",
      projectKey: "<project key, from the Issue tracker row>",
      issueTypeName: "Task",
      summary: "<imperative summary, no [Task]: prefix>",
      description: "<the body's five sections, unchanged>",
      contentFormat: "markdown"
    )

Read `projectKey` and `cloudId` off the `Issue tracker` row — recorded as
`Jira, project key <KEY>, site <site>` — the same row `dev-flow` reads to
scope its own Jira calls.

Drop the `[Task]: ` prefix from `summary`. `task.yml` supplies it on
GitHub; under Jira, `issueTypeName: "Task"` already says so, and a
repeated prefix would say it twice.

Carry the body's five sections into `description` unchanged — Context /
Why, What needs to be done, Acceptance Criteria, Related links, Out of
scope — as markdown headings, the same shape the `gh issue create` body
above writes.

No area label exists to apply either, since labels are a GitHub concept.
Leave the area untagged until this repo decides what an area becomes
under Jira.

## Agent context goes in a comment

Execution detail — file paths, command sequences, IDs, retrieved
constraints, design notes — is noise to a human reader and necessary to an
agent. It goes in a comment on the issue, not the body.

- Start the comment with a bolded `**Agent context**` line. That is how
  `dev-flow` finds it.
  The same convention holds in a Jira comment, and `dev-flow` reads it the
  same way — it fetches Jira comments as markdown for exactly that reason.
  Writing this comment into Jira stays out of scope: it needs
  `addCommentToJiraIssue`, which [Filing under Jira](#filing-under-jira)
  above does not call. Filing the issue itself into Jira is covered there.
- Optional. Write one only when there is real execution detail.
- No length limit.

```bash
gh issue comment <N> --body "$(cat <<'EOF'
**Agent context** — execution detail, not part of the ask.

<file table, commands, IDs, constraints>
EOF
)"
```

## UI / experience acceptance criteria

When the issue ships user-facing UI, add experience criteria that a
reviewer can verify — not adjectives like "looks premium." Prefer:

```markdown
### Experience acceptance criteria
- [ ] Loading state preserves layout (skeleton or previous-good); no flash of empty-then-content
- [ ] Empty state is actionable and includes supporting art (or issue notes deliberate no-art)
- [ ] Error state explains what happened and what to try next; drafts preserved where applicable
- [ ] Primary interactive targets ≥ 44×44 CSS px; usable at ~360×640
- [ ] Works in light and dark/night themes with AA contrast for critical text
- [ ] Reduced-motion path does not remove feedback
- [ ] Each AC above mapped to an automated test or a short manual QA note on close
```

When the optional `apptension-frontend-craft` plugin is installed, load
it while implementing these. Close comments should list AC with pass /
fail / deferred — never a blanket "AC covered".

## Avoid

- **Vague "TBD" criteria.** "TBD" or "to be determined during
  brainstorming" isn't a criterion — it defers the definition of done past
  the point anyone can check it. An undecided design is a signal for the
  design gate, not a reason to leave the checklist blank.
- **Missing or wrong SDLC Area label, under GitHub.** An unlabeled issue,
  or one labeled with a generic GitHub default (`bug`, `enhancement`)
  instead of an SDLC-area label, breaks board sync and area-based
  filtering. Pick the one area the work most belongs to, even when it
  touches more than one. Labels are a GitHub concept, so this rule does
  not apply under Jira — see [Filing under Jira](#filing-under-jira).
- **Bundling unrelated concerns into one issue.** An issue that mixes two
  independently shippable changes forces them through the same branch,
  PR, and acceptance checklist even when they have nothing to do with
  each other. Split before filing; use "Related links" to connect them
  instead.
