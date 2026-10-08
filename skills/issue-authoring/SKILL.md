---
name: issue-authoring
description: Use when drafting a new issue for the target repo's tracker — filing it directly via `gh issue create` under GitHub, against `.github/ISSUE_TEMPLATE/task.yml` with the area conveyed as a label instead of the form's dropdown, or via `jira_create_issue` under Jira — with acceptance criteria that describe shipped work rather than a design-only outcome. Trigger on intent like "file an issue for X", "draft a GitHub issue", "let's write up this issue", or "open a task for this".
requires:
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

How to draft a well-formed issue for the target repo's tracker, and file it —
against `.github/ISSUE_TEMPLATE/task.yml` with `gh issue create` under
GitHub, or with `jira_create_issue` under Jira. A human or an agent filing
the next issue follows this before typing a title.

## Filing needs a human's yes

An agent runs `gh issue create` or `jira_create_issue` only after a human
has approved that specific issue. Draft it in full — title, body, and
label under GitHub; summary, description, and Epic under Jira, which has
no label to draft — put it in front of them, and wait. Approval is per
issue: a yes to one is not a yes to the next, and "file whatever you
find" is not a yes to any of them.

That binds the issue an agent was asked for and the issue it thought of on
its own, and the second is the case this exists for. A problem noticed
while working something else reaches the human as a finding, not the
tracker as a ticket — `implement-issue` step 6 says how one is carried there and
step 10 is where it is offered.

This is not `setup`'s gate. `setup` proposes issues the human asked it to
find, prints the whole candidate table up front, and takes one
confirmation over rows the human already dropped or edited — a different
mechanism, for a different case, that predates this rule and is not read
against it.

## This run ends when the issue exists

Once that approval is in, treat the user's message as the issue's subject.
Draft the issue, file it on the tracker, and post the agent-context comment
when there is execution detail. Stop. Done is the issue URL, plus that
comment when one was needed.

Once this skill is already in context, the user's message is the subject
even when it never says "file".

## The default: every issue ends in shipped work

The issue you file still has to describe shipped work. That is a rule for
its acceptance criteria, not for this run. This run still ends when the
issue exists.

An issue's acceptance criteria describe what "done" looks like. In the
target repo, "done" means working code merged, not a design produced. Write at
least one criterion naming the shipped artifact — the feature working, the
file generated, the test passing.

`dev-flow`'s design gate covers the *how*: an issue that fails its four
direct-track checks goes through `superpowers:brainstorming` and
`superpowers:writing-plans` first, but that work lands in the same issue's
branch and PR. Splitting off a follow-up issue is the exception, not the
outcome to write into the criteria up front.

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

## The template's fields

| Field | What belongs there |
|---|---|
| Title | `[Task]: <imperative summary>`. The template supplies the prefix; write the rest as an instruction ("Add X", "Fix Y"), not a topic label. |
| Context / Why | The problem, and why now. Cite the issue, PR, or incident that surfaced it. |
| What needs to be done | The concrete change. If the *how* is genuinely undecided, say so here and let the design gate route it through brainstorming. |
| Acceptance Criteria | A checklist of shipped outcomes, each verifiable by someone who wasn't in the room — a test, a command's output, a file that exists. |
| Area | A dropdown in the target repo's web form, when it provides one. `gh issue create` bypasses that form — see below. |
| Related links | Issues, PRs, specs, or docs this one depends on or extends. |
| Out of scope | What this issue deliberately does not cover, and where it belongs instead. |

Under GitHub, `gh issue create` writes this shape whether or not the file
exists, so a missing template never blocks filing. It does leave a human
filing through the web UI with whatever forms the repo inherited. The
`install-task-template` skill fixes that by writing `task.yml` with the
Area dropdown filled from this repo's own labels. Run it when
`.github/ISSUE_TEMPLATE/task.yml` is absent.

## Filing routes on the tracker

Where the issue lands follows the target repo's `Issue tracker` binding, the same
row `dev-flow` reads at its own step 1: GitHub Issues files below, Jira
files under [Filing under Jira](#filing-under-jira).

## Where the requirement applies

Labels are a GitHub concept, so the `area-labels` entry above is applicable
only where the target repo's `Issue tracker` binding reads GitHub Issues.
Under Jira the entry is not applicable, and an audit neither reports it
present nor files it as a gap. [Filing under Jira](#filing-under-jira)
carries the same rule for the filer: the area stays untagged.

## Filing under GitHub: label instead of dropdown

Issues filed with `gh issue create` bypass the target repo's web form, so
an area dropdown is not rendered. Read the target repo's labels before
filing:

```bash
gh label list --repo <owner>/<repo> --limit 1000 \
  --json name,description,isDefault
```

Exclude labels whose `isDefault` value is `true`. GitHub's nine defaults
are `bug`, `documentation`, `duplicate`, `enhancement`, `good first issue`,
`help wanted`, `invalid`, `question`, and `wontfix`; `isDefault` still
identifies one if the target repo renamed it. From the remaining labels,
identify the target repo's area taxonomy by label names and descriptions,
then apply the best fit. A
workflow or issue-type label such as `bug` or `enhancement` may coexist
with the area label because the two labels answer different questions.

When the target repo has no area taxonomy, omit the area label and tell the
human that no area label was applied. Do not create a taxonomy or copy one
from another repo while filing an issue.

```bash
AREA_ARGS=()
# Set AREA_ARGS=(--label "<area>") only when an area label was selected.
gh issue create --repo <owner>/<repo> \
  --title "[Task]: <imperative summary>" \
  "${AREA_ARGS[@]}" \
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

No `gh` call runs on this path, not `gh issue create` and not even a read
like `gh label list`, the same rule the `setup` skill states for a
non-GitHub tracker.

Call every tool below on the server named `jira`, which is the entry the
repo carries, or on the single server with a tool matching the
`jira_get_issue` suffix when no server carries that name (see
`manage-jira-ticket`'s `Find the server`).
Read the project key off the `Issue tracker` row, recorded as `Jira,
project key <KEY>, site <site>`, and pass it on every call. A server
entry serves every repo on its site and each of them has its own key, so
a key left to the server's own default is right for one repo and quietly
wrong for the rest.

### Which Epic the issue files under

The draft names the Epic, so the human approves the parent with the rest
of the issue. Finding it takes only reads, which run before the draft goes
out. Work down the steps and stop at the first one that settles it:

1. Confirm the project has Epics:

       jira_describe_project(projectKey: "<KEY>")

   With no `Epic` among the response's `issueTypes`, the issue files with
   no parent.

2. List the open Epics:

       jira_search(
         jql: "project = <KEY> AND issuetype = Epic AND statusCategory != Done ORDER BY updated DESC"
       )

   A page holds 25 cards, so pass `nextCursor` back as `cursor` until
   `isLast` is true. With no card at all, the issue files with no parent.

3. Compare the subject with each Epic's `summary`. When exactly one fits,
   that Epic is the parent.

4. When two or more fit, or none does, read the ten tickets filed most
   recently:

       jira_search(
         jql: "project = <KEY> AND issuetype != Epic ORDER BY created DESC",
         limit: 10,
         fields: ["parent"]
       )

   Each card's `extraFields.parent.key` names that ticket's parent. Count
   how many of the ten sit under each candidate, where the candidates are
   the Epics that fit, or every open Epic when none did. The candidate
   with the highest count is the parent.

5. When none of the ten sits under a candidate, or the top count is a
   tie, the draft lists the candidates and asks the human which one. The
   Epic they name completes the `Epic:` line, and the draft still needs
   their yes, which the same answer can give.

The draft states the outcome on an `Epic:` line under the summary:

| Outcome | `Epic:` line |
|---|---|
| Step 3 settled it | `Epic: GA-12 Checkout redesign` |
| Step 4 settled it | `Epic: GA-12 Checkout redesign, the parent of 6 of the last 10 tickets` |
| Step 5 asks | `Epic: which one? GA-12 Checkout redesign, GA-40 Auth hardening` |
| No `Epic` issue type | `Epic: none, project GA has no Epic issue type` |
| No open Epic | `Epic: none, project GA has no open Epic` |

### Creating the issue

File directly:

    jira_create_issue(
      project: "<KEY>",
      issuetype: "Task",
      summary: "<imperative summary, no [Task]: prefix>",
      description: "<the body's five sections, unchanged>",
      parent: "<the Epic's key>"
    )

Pass `parent` when the approved `Epic:` line names an Epic, and leave it
out when the line reads `none`.

`issuetype` is spelled in lower case, which is the field's own spelling
and not a typo. It defaults to `Task` and is passed anyway, so the ticket
does not silently change type if that default ever moves.

The call returns the new issue's key and URL. A call that fails on
`parent`, with `parent_not_found` or `epic_link_unavailable`, creates
nothing. Report the error and its hint to the human, and ask before filing
without the Epic, because the draft they approved named one.

Drop the `[Task]: ` prefix from `summary`. `task.yml` supplies it on
GitHub; under Jira, `issuetype: "Task"` already says so, and a
repeated prefix would say it twice.

Carry the body's five sections into `description` unchanged — Context /
Why, What needs to be done, Acceptance Criteria, Related links, Out of
scope — as markdown headings, the same shape the `gh issue create` body
above writes.

Markdown task-list items are outside the converter's documented safe
subset, which covers headings, bold and italic, lists, code blocks, inline
code, links, blockquotes, rules and flat tables. So a `- [ ]` line in
Acceptance Criteria files as an ordinary bullet rather than a tickable
Jira task item. The server reports conversion differences in the
response's `hints`, so read them on the first filing against a new site
rather than assuming what survived. File the checklist as written and
expect a reviewer to read down it rather than click it.

No area label exists to apply either, since labels are a GitHub concept.
Leave the area untagged until the target repo decides what an area becomes
under Jira.

## Agent context goes in a comment

Execution detail — file paths, command sequences, IDs, retrieved
constraints, design notes — is noise to a human reader and necessary to an
agent. It goes in a comment on the issue, not the body.

- Start the comment with a bolded `**Agent context**` line. That is how
  `dev-flow` finds it. Under Jira the same convention holds and
  `dev-flow` reads it the same way, with one difference worth knowing:
  the server stamps a visible marker into the first paragraph of every
  comment it posts, on the same line. It defaults to `:claude:` and an
  entry can set it to any other non-empty string, but no setting removes
  it. So the posted comment reads `:claude: **Agent context** ...`, and
  `dev-flow` matches on the first line **containing** the bolded label
  rather than starting with it. Write the line exactly as below and let
  the marker land in front of it.
- Optional. Write one only when there is real execution detail.
- No length limit.

Under GitHub, invoke `manage-github-issue`'s `Post a comment` with this
body, saying it is an Agent context comment. Pass the detail plain;
`Post a comment` collapses it under the label line:

```
**Agent context** — execution detail, not part of the ask.

<file table, commands, IDs, constraints>
```

Under Jira the same comment is one call, on the same server entry that
filed the issue. The converter passes no raw HTML, so the detail stays
inline:

    jira_comment(
      issueKey: "<the key jira_create_issue returned>",
      body: "**Agent context** — execution detail, not part of the ask.\n\n<file table, commands, IDs, constraints>"
    )

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
- **Inventing or copying an area taxonomy.** Under GitHub, select the best
  fit only from the target repo's existing area labels. If none exist,
  file without one and say so. Workflow labels such as `bug` and
  `enhancement` may coexist with an area label. Labels are a GitHub
  concept, so this rule does not apply under Jira — see
  [Filing under Jira](#filing-under-jira).
- **Bundling unrelated concerns into one issue.** An issue that mixes two
  independently shippable changes forces them through the same branch,
  PR, and acceptance checklist even when they have nothing to do with
  each other. Split before filing; use "Related links" to connect them
  instead.
