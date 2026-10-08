# A standalone run

Read when the run is standalone: no `dev-flow` invoked this skill.

## What a standalone run leaves out

- Skip step 4. Assign nobody and move nothing to In progress. The
  implementation run assigns whoever runs it, at its step 4.
- Cut no branch.
- The spec and plan stay behind as untracked working files.
  `run-preflight`'s clean-tree check exempts them, so the later
  `implement-issue` run starts on this tree.

## Post the plan handoff

The comment carries the plan to a fresh `implement-issue` session; the
human approves by starting that run. Post one comment once the human
agrees to the plan.

```
**Plan handoff** · <track> · <YYYY-MM-DD>

<plan summary, at most 2 sentences>

<track body>
```

| Track | Track body |
|---|---|
| Design, full mode, architectural | The spec and the plan, verbatim |
| Design, full mode, bounded | The short design the human approved in chat, verbatim |
| Design, reduced mode | The plan the human approved in plan mode, verbatim |
| Direct | The confirmed one-line reason the change met the four criteria |
| Micro | The named surface |

Invoke the tracker skill (`manage-github-issue` or `manage-jira-ticket`,
per the tracker `run-preflight` resolved) to `Post a comment` with that
body, saying it is a plan handoff and naming its track. The tracker skill
decides how the track body renders. A stop it raises ends the run before
the Ready move.

A new `plan-issue` run posts a new comment. The newest one counts.

## Move to Ready

Invoke the tracker skill to `Move the ticket` to `Ready`. It owns every
skip, announcement and stop for that stage.

## Hand over

Stop. Tell the human the ticket is ready for `implement-issue` and how to
start that skill by name:

| Harness | How to start it |
|---|---|
| Claude Code | `/apptension-sdlc:implement-issue <ticket>` |
| Any other | Ask for the `implement-issue` skill by name |
