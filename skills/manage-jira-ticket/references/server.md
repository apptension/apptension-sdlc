# Find the server

Read when choosing which Jira tool entry to call, when proving the
credential, or when a Jira call fails or the server exits.

The server is `lean-jira-mcp`, authenticated by an Atlassian API token. It
is needed only when the `Issue tracker` binding names Jira. To write or
fix an entry, read [configure-server.md](configure-server.md).

## Finding it

Match the tool in the session's own tool list whose name **ends in**
`jira_get_issue`. Match on the suffix alone. The prefix is the server
entry's name, which the person configuring it chose, so no config file
names it reliably.

A harness that exposes no tool list **fails closed**: "not configured" and
"cannot see" look the same there, and guessing means guessing about
somebody's Jira.

## Which entry, when there are two

Each Jira site has its own entry, and the repo's entry is named `jira`.

| What the session holds | What to do |
|---|---|
| A tool whose server is named `jira` | Use that entry's tools |
| No `jira`, one tool matches | Use it |
| No `jira`, two or more match | **Stop.** List the matches and ask which is this repo's |

Two entries cannot both be named `jira`: a session's server names are its
tool prefixes, and those are unique. One match with no `jira` is the shape
from before a repo carried its own entry, and it keeps working.

## Proving it works

Make no separate call; reading the ticket proves the credential.

A rejected credential returns an error with `JIRA request failed with
status 401` (or `403`) in its message, no error code, and the hint `An
unexpected error occurred. Retry, and if it persists check the server
logs.` Match the status in the message and **do not retry**: the token is
rejected the same way every time. Rule causes out in order:

1. The whole token reached the credential file.
2. It is a classic unscoped token. One made with "Create API token with
   scopes" fails basic auth.
3. It is unexpired.
4. It is paired with the right `JIRA_EMAIL`.

## What each failure means

| Failure | What it means | What the stop says |
|---|---|---|
| No tool list in the harness | Cannot verify anything | Fail closed: the Jira path is unavailable in this harness |
| No tool ending in `jira_get_issue` | The server is not configured here | Add it per [configure-server.md](configure-server.md). The `setup` skill writes the repo's entry |
| A call fails with `401` or `403` in its message | The token is rejected | Do not retry. Rule out the causes in [proving it works](#proving-it-works) |
| The server exits naming a path under `jira-mcp/env` | The credential file is not there | Create it at the printed path, per [configure-server.md](configure-server.md#the-credential-file) |
| The server exits at startup naming a variable | The entry did not supply it | The credential file lacks one of its two variables, or the entry lacks a literal `JIRA_BASE_URL` |
| Tools answer, the ticket is not found | Wrong entry for this repo, or no project access | Check the answering entry's `JIRA_BASE_URL` against the site in `Issue tracker` |

The server supports Jira Cloud only. State the limit; never infer it from
the hostname, since Cloud allows custom domains.

Done when the caller has the tool entry to call, or the stop for the
failure it hit.
