# Jira site checks, transitions and stops

Read when a Jira response names a host, before a transition, when a
transition or check does not succeed cleanly, when moving to `Ready`, or
when a Jira operation stops.

## The site is trusted, not verified

`jira_get_issue` names no host, so the read cannot tell the right site from
a wrong one holding the same project key. The entry named `jira`, or the
sole matching tool, binds the repo to its site; only the `setup` skill's
one-time project-name echo checks that binding. Two responses name a host,
besides the comment `url` that posting a comment checks:

| Response | When it names a host | Check |
|---|---|---|
| `jira_read_attachment`, while reading the ticket | In `hints` when it downscales an image. In `downloadUrl` when it refuses one for size, cannot decode it, or gets a type it does not inline. Never for an image passed through untouched | Compare with the recorded site right there. A mismatch is the hard stop in [checking the site before the transition](#checking-the-site-before-the-transition), reached before pre-flight and before any write |
| `jira_update_issue`, assigning | The issue URL on a successful assignment | [Checking the site before the transition](#checking-the-site-before-the-transition). The assignment has landed by then, so the check runs before the transition to keep the damage to one reversible action |
## Checking the site before the transition

The assignment's response carries the issue's URL. Compare its host with
the recorded site:

| Outcome | Behaviour |
|---|---|
| Assignment succeeds, host matches | Continue to the transition |
| Assignment succeeds, host differs | **Hard stop**, before the transition |
| Assignment fails because the identity has no Jira account to assign to | No URL, so the check does not run. Say the line below once, then continue to the transition |
| Assignment fails for any other reason, including permission, validation and transient errors | **Stop** before the transition and report what the call returned. The cause is unknown and may be a wrong site |

> No URL came back from the assignment, so the site check did not run.
> The site rests on the answering entry alone for the rest of this
> session.

## Checking for a transition-name collision

`jira_transition` matches a transition **name** before a destination
**status**. Before the first transition performed in this session, call
once:

    jira_describe_project(projectKey: "<key>", issueType: "<issue type>")

Use the `Issue tracker` key and the issue type from the read. Keep the
response; later checks reuse it with no second call.

Its transition edges carry `name`, `from` and `to`; a global edge has
`from: "*"`. Filter to edges whose `from` is the ticket's current status,
plus every `from: "*"` edge. The current status:

| Stage | Current status |
|---|---|
| `In progress` | The `status` field from the read |
| `In review` | The status the `In progress` transition's response confirmed, or the read's when no `In progress` transition ran |
| `Ready` | The `status` field from the read |

Check the stage's recorded status against the filtered `name`s. Compare as
the server matches: trim both sides, lower-case them, and collapse
whitespace runs to one space. An edge whose name matches while its `to`
differs is a stop, even when another edge reaches the status:

| Filtered set | Behaviour |
|---|---|
| No edge named like the status, or the one so named reaches it | Transition normally |
| The edge named like the status leads elsewhere; another edge reaches the status | **Stop before transitioning.** Report the colliding name, where it leads, and the other edge's name, which the human can record in `Tracker statuses` |
| The edge named like the status leads elsewhere; no edge reaches the status | **Stop before transitioning.** Report the colliding name, where it leads, and that the recorded status is unreachable from here |

## Resolving a Jira transition

The server refuses an ambiguous target, no-ops when the ticket already sits
in the recorded status, and validates required screen fields. It returns
`status`, the destination the fired transition declares, and `transition`,
the name that fired. A target more than one hop away returns the available
steps; stop, never walk them.

| Outcome | Behaviour |
|---|---|
| Succeeds or no-ops, returned `status` matches the recorded value | Continue |
| Succeeds or no-ops, returned `status` differs | **Stop.** Report the recorded status, the returned `status`, and the returned `transition` name |
| Refuses, naming two or more candidates | **Stop**, printing what it named |
| Target not available from here | **Stop**, printing the available steps it returned |

The echo of what was passed prints once per session, before the first
transition performed. When no `In progress` transition runs (`In progress` is `none`, or the ticket is a GitHub issue
under a Jira tracker), the `In review` transition prints it.

Use one status map for every issue type. A recorded status a given issue
type's workflow lacks reaches the stops above.

## Validating In review early

A successful `jira_transition` to `In progress`, a no-op included (the
common case on a resumed session), reports the transitions available from
the ticket's new status. Resolve the recorded `In review` against that list
now, before any work on the change.

| Result | Behaviour |
|---|---|
| Absent from the list, or ambiguous within it | **Stop**, printing what the response showed |
| Resolves cleanly | Say nothing |
| `In review` is `none`, or `In progress` is `none` and no transition call was made | Skip, with no output |

The `In review` move still runs its own resolution and stops.

## Moving to Ready

Only a standalone `plan-issue` run moves a ticket to `Ready`, as its last
step, after its handoff comment passed the site check. Run
[the collision check](#checking-for-a-transition-name-collision) first, then
[resolve the transition](#resolving-a-jira-transition).

| `Tracker statuses` | Behaviour |
|---|---|
| Records a `Ready` status | Transition to it |
| `none` for `Ready` | Skip silently |
| No `Ready` stage, or the whole row absent or `unknown` | Skip the move and say the line below once |

> No `Ready` status is recorded for this tracker, so the ticket stays
> where it is. Record one, or rerun `setup`, to have planned tickets
> move to `Ready`.

An absent `Ready` is never a stop; the ticket stays where it is. The
row-level stop in [Jira stops](#jira-stops) is for `In progress` and
`In review` only.

## Jira stops

Every operation of this skill uses this table.

| Stop | The human's next action |
|---|---|
| No tool list, no tool ending in `jira_get_issue`, `401` or `403` in a call's message, a startup exit, or the recorded ticket not found | Per [what each failure means](server.md#what-each-failure-means). Never retry a `401` or `403` |
| Two tools match and neither server is named `jira` | Name this repo's entry `jira`, per [which entry, when there are two](server.md#which-entry-when-there-are-two) |
| The argument's site ≠ the recorded site | **Hard stop.** Another company's Jira |
| The site of a standalone `plan-issue` comment ≠ the recorded site | **Hard stop**, before the `Ready` transition, after one comment landed. Point the entry at the recorded site, then delete the comment by hand |
| The site of the assignment ≠ the recorded site | **Hard stop**, after one assignment landed. Point the entry at the recorded site, then undo the assignment by hand |
| The argument's key prefix ≠ the recorded project key | Confirm, or fix the bindings row |
| [Transition-name collision](#checking-for-a-transition-name-collision) | **Stop before transitioning.** Fix `Tracker statuses` or rename the transition |
| `jira_transition` refuses, naming candidates | Name which, by fixing the workflow or the row |
| `jira_transition` reports the target unavailable from here | Fix `Tracker statuses`, or move the ticket by hand |
| `jira_transition` returns a status other than the recorded one | **Stop.** Fix the workflow or the row |
| `Tracker statuses` absent, or `unknown` for the stage needed | Add the row or answer the value, or rerun `setup` |
| A bare issue number under a Jira tracker | Say which ticket, a key or a GitHub URL |

`run-preflight` checks the argument's site and key prefix before any read,
and owns the confirmation question for a key-prefix mismatch.
