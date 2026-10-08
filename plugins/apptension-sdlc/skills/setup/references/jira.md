# Jira

Read when the effective `Issue tracker` is Jira, or the evidence for it is
ambiguous: at step 4 to compose the server entry, at the gate for the Jira
questions, and on a re-run that moves a bound repo onto Jira.

## The server entry

Compose `.mcp.json` for the repository root alongside the bindings table,
and the `enabledMcpjsonServers` approval key for `.claude/settings.json`,
by invoking `manage-jira-ticket`'s `Configure the server`. It holds the
entry's exact shape, how `JIRA_BASE_URL` is built from the recorded site,
and how an existing file is merged or left alone. A GitHub-tracked repo
composes none, and that absence is correct.

Report on the findings line what `Configure the server` hands back for the
operator: what their running harness still needs, the `MCP_TIMEOUT` note
for the first cold start, and the credential file each person writes once
per machine. A site of `unknown` composes nothing and goes to `Could not
determine`. An existing `.mcp.json` that does not parse composes nothing
either: the gate names it (see [the bindings-only prompt](#the-bindings-only-prompt))
and the summary reports it in `Written` as left untouched.

Composing is not writing. The gate shows the file and releases it.

## Gate questions

Ask these whenever the effective tracker is Jira: freshly proposed,
ambiguous, or carried over from a row still missing a value. A carried row
skips the regex, so only these questions resolve its missing values.

| Situation | Ask |
|---|---|
| Ambiguous evidence | `Jira evidence` first. `no` leaves `Issue tracker` GitHub-tracked and skips the other two |
| Confident detection, carried row, or `yes` to the evidence question | `Jira site` when no site is recorded, and `Tracker statuses` when that row is absent or `unknown` |

```
Jira evidence: commit history here has a few keys shaped like GA-12, not
enough of them to confidently call this repo Jira-tracked over GitHub. Is
this repo actually tracked in Jira? Answering yes asks the two questions
below; answering no leaves Issue tracker as GitHub-tracked and skips them.
(yes / no, enter accepts no)
Jira site: this repo's Issue tracker is Jira (commit history says so
confidently, an existing binding already does, or the answer above just
confirmed it) but no site is recorded yet. Every Jira call this flow
makes is scoped to one site, and a call scoped to the wrong one reads or
moves a ticket in another company's Jira. Name the site,
your-company.atlassian.net, or your own custom domain if the Cloud instance
has one, or press enter to leave it unknown.
Tracker statuses: Jira status names are the project's own, so this flow
cannot guess them. Name the status this workflow puts started work into,
and the one it puts work up for review into. "In Progress and Code
Review" is a complete answer. If review lives in the pull request and
there is no review status, say none for the second one. Optionally, name
the status a planned ticket waits in before anyone implements it, such
as Selected for Development. Press enter to leave the row unknown.
```

The site becomes part of the `Issue tracker` value; the statuses fill
`Tracker statuses`. An answer fills the row, and no answer leaves it
`unknown`. None of these stops setup.

**Setup derives no status from a call.** `jira_describe_project` returns
an issue type's statuses, but setup knows neither which issue type the
repo uses nor which status the team treats as started or in review.

## The credential check

When the session's Jira server is unambiguous (a server named `jira`, or a
single matching tool), make one call once the project key is known:

    jira_describe_project(projectKey: "<key>")

| Outcome | Report on the findings line |
|---|---|
| Echoes the project's name | The credential works and the key is right |
| `401` in the message, no error code | The token is rejected |
| Two or more matching tools, and no row names one | Skipped, on the `Could not determine` line. Calling either risks checking the credential against another client's Jira. See `manage-jira-ticket`'s `Find the server` |
| No Jira tool in the session | Did not run, on the same line |

None of these stops setup or skips the write.

The first setup of a Jira repo usually has no tool to call: a project
server cannot start mid-session, so the entry this run writes exposes
nothing until the next one. Name what closes the gap. Under Claude Code
the operator restarts and approves the project server once. Under Cursor,
Codex, OpenCode or Pi they write their own entry, per `Configure the server`.
The next run then makes the call, and until then the first ticket read
proves the credential.

## The bindings-only prompt

A Jira tracker files nothing, so the gate prints the bindings and the
backlog and asks about the writes alone. The base prompt is in
[gate.md](gate.md#non-github-tracker). Under Jira it names the server
entry as a second effect and prints the file before asking: this repo also
gains a `.mcp.json` at its root, holding the one Jira server entry every
skill here reads tickets through, pinned to a version and pointed at the
site above, and `.claude/settings.json` gains the key that lets it start
without each teammate answering a prompt. Both go into the working tree
uncommitted alongside the table, and a teammate who lands them needs one
credential file of their own and installs nothing. The question becomes
`Write the CLAUDE.md table and the .mcp.json server entry? (yes / no,
enter accepts yes)`.

Where step 4 composed no file, the prompt keeps its one effect and
promises nothing about `.mcp.json`. Say which case it was on the findings
line: a site recorded as `unknown`, or an existing `.mcp.json` that does
not parse, which leaves a file the operator may believe this run repaired.

## Moving a bound repo onto Jira

A carried `Issue tracker` row skips detection, so a repo recorded as
GitHub-tracked stays so however its history reads. A repo that just moved
to Jira has no keys in its history yet, so detection would find nothing
anyway. Tell the operator the two steps:

1. Edit the `Issue tracker` row by hand to `Jira, project key <KEY>, site
   <site>`.
2. Re-run `setup`. The effective tracker is Jira, so it asks for the
   status names, checks the project key where a server answers, and
   composes `.mcp.json`.
