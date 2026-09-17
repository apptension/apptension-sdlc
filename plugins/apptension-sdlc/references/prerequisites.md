# Plugins and connectors

Some processes here are written on top of skills another plugin ships. This
page is the one place that records which, so a skill can point at it
instead of leaving the dependency implicit in its prose.

An agent reads this page when a plugin or connector is missing, to compose
the stop or to announce reduced mode. A human reads it before installing.

## The list

| Plugin | Install from | Used by | What changes without it |
|---|---|---|---|
| `superpowers` | `superpowers@<the Apptension marketplace you added>` | `dev-flow`, `pr-checks` | Both run [reduced mode](#running-without-superpowers): the design track uses the harness's plan mode, and every step that would call a skill states its discipline inline |

Whichever Apptension marketplace you installed this plugin from also carries
`superpowers`: `apptension-sdlc` publicly, `apptension-dev` inside Apptension.
Anthropic's auto-registered `superpowers@claude-plugins-official` satisfies the
same requirement, as does installing it straight from
[obra/superpowers](https://github.com/obra/superpowers). Any of them is fine;
the check looks for the plugin, not where it came from.

The Apptension marketplaces list `superpowers` as an external entry pointing at
obra's repo, so installations continue to use the upstream version.

### Install path per harness

The `Install from` cell is a `plugin@marketplace` reference, not a command.
What an agent hands the human depends on which harness the session is running
in:

| Harness | What to hand the human |
|---|---|
| Claude Code | `/plugin install superpowers@apptension-sdlc` — or `@apptension-dev` internally, or `@claude-plugins-official` |
| Cursor | Install `superpowers` from the Apptension marketplace already added; or add `https://github.com/obra/superpowers` directly |
| Codex | Install `superpowers` from the Apptension marketplace already added; or from `https://github.com/obra/superpowers`, which ships its own `.agents/plugins/` manifest |
| OpenCode | Add `superpowers@git+https://github.com/obra/superpowers.git` as a separate package in `opencode.json` |
| Pi | `pi install git:github.com/obra/superpowers` |

OpenCode and Pi must install `superpowers` as its own package from obra's repo.
The Apptension selector registers local plugins only; naming an external plugin
in `.opencode/apptension.json` or `.pi/apptension.json` raises an error instead
of installing it. Every path above works without private marketplace access.

Use the table above as the complete portable install guidance for Claude Code,
Cursor, Codex, OpenCode, and Pi. In
OpenCode, do not add `superpowers` to `.opencode/apptension.json`: that
selector chooses which skills and commands from the Apptension toolkit package
are registered. Superpowers is registered by its own package entry in the
global or project `opencode.json`. In Pi, do not add `superpowers` to
`.pi/apptension.json`; it is registered by its own `pi install`.

`apptension-frontend-craft` is **not** on this list. It is genuinely
optional: `dev-flow` prefers its skills for user-facing UI
when it is installed and states a mandatory craft bar that holds either way.
An absent optional plugin is never a stop.

## The Jira MCP server

Required **only when the `Issue tracker` binding names Jira**. A
GitHub-tracked repo never reaches for it, and its absence there is not a
finding.

The server is `lean-jira-mcp`, authenticated by an Atlassian API token.
It splits across two owners:

- **The entry belongs to the repo.** Under Claude Code, `setup` writes
  `.mcp.json` at the repository root when the tracker is Jira **and a site
  is recorded**, pinning the package version and carrying that site. The
  repo lands the file like any other, so a teammate cloning it retypes no
  site and installs nothing. A site left `unknown` writes nothing.
- **The credential belongs to the person.** One file per machine, at
  `${XDG_CONFIG_HOME:-$HOME/.config}/jira-mcp/env`, mode 600, holding
  `JIRA_EMAIL` and `JIRA_API_TOKEN`. One file serves every project on that
  Atlassian account, and nothing about it is committed.

The entry still gets no `checklist.json` entry. The audit has no way to
say "only under Jira", so an entry would report `missing` on every
GitHub-tracked repo. That is noise on the majority of repos, to document a
file they must not have.

### Finding it

Match the tool in the session's own tool list whose name **ends in**
`jira_get_issue`. Match on the suffix and nothing else. The prefix is the
server entry's name, which the person configuring it chose, so reading a
server name out of any config file finds nothing reliable and must not be
attempted.

A harness that exposes no tool list at all **fails closed**. There is no
way to tell "not configured" from "cannot see" there, and guessing means
guessing about somebody's Jira.

### Which entry, when there are two

One entry per Jira site, so an account working two sites has two tools
ending in `jira_get_issue` and the suffix cannot say which belongs to this
repo. The server's own name settles it: the entry a repo carries is named
`jira`, so a tool prefixed `jira` is this repo's and a second entry the
operator keeps for their own sites carries whatever name they gave it.

| What the session holds | What to do |
|---|---|
| A tool whose server is named `jira` | Use that entry's tools |
| No `jira`, one tool matches | Use it |
| No `jira`, two or more match | **Stop.** List the matches and ask which is this repo's |

Two entries cannot both be named `jira`, because a session's server names
are its tool prefixes and those are unique. One match with no `jira` is the
older shape, from before a repo carried its own entry, and it keeps
working untouched.

### Proving it works

There is no separate call to make. A rejected token fails the first real
read, so that read proves the credential, and in `dev-flow` it is step
1's, before pre-flight starts.

**What a rejected credential looks like.** An error result carrying
`JIRA request failed with status 401` in its message, no error code to
match on, and the hint `An unexpected error occurred. Retry, and if it
persists check the server logs.` Match the status in the message. **Do
not follow that hint.** A 401 here is a credential that will be rejected
identically on every retry, and the retries only spend calls. A 403
arrives in the same shape.

The wording is generic precisely where it would help most: a truncated
token, a scoped token and an expired one all produce that same line, and
it names none of them. The server's own guidance is that basic auth needs
a classic unscoped token and that scoped tokens do not work with it, so
rule the cheap causes out in order — the whole token stored, then its
kind, then its age, then the `JIRA_EMAIL` it is paired with.

### What each failure means

Six classes, six different next actions for the human. They are not
interchangeable, and a stop that names the wrong one sends someone to fix
something that is not broken.

| Failure | What it means | What the stop says |
|---|---|---|
| No tool list in the harness | Cannot verify anything | Fail closed: the Jira path is unavailable in this harness |
| No tool ending in `jira_get_issue` | The server is not configured here | Add it, per the table below |
| A call fails with `401` or `403` in its message | The token is rejected | The error carries no code and its hint suggests retrying; do not. Check the whole token reached the credential file, then that it is a classic unscoped token, unexpired, and paired with the right `JIRA_EMAIL`. A token created with "Create API token with scopes" fails basic auth |
| The server exits naming a path under `jira-mcp/env` | The credential file is not there | Create it, per the table below. The shell that sources it fails before the server starts and prints the full path it looked for |
| The server exits at startup naming a variable | The entry did not supply it | The credential file is there and one of its two variables is missing, or the entry lacks a literal `JIRA_BASE_URL` |
| Tools answer, the ticket is not found | Wrong entry for this repo, or no project access | Check the answering entry's `JIRA_BASE_URL` against the site in `Issue tracker` |

**Cloud only.** The server speaks to Jira Cloud endpoints and Data Center
is unsupported. Do not test the hostname for it: Jira Cloud allows custom
domains, so a client on `jira.client.com` is Cloud and a hostname rule
would reject them. This is a limitation to state, not a thing to detect.

### Configuring it, per harness

The `superpowers` table above is a `plugin@marketplace` reference this
repo publishes, so its five install paths are exact. These are exact for a
different reason: the whole surface is one npm package name, one file
path, and three literal values, so there is no third-party endpoint here
to go stale.

#### The credential file, once per machine

```sh
mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/jira-mcp"
chmod 700 "${XDG_CONFIG_HOME:-$HOME/.config}/jira-mcp"
printf "JIRA_EMAIL='%s'\n" 'you@example.com' > "${XDG_CONFIG_HOME:-$HOME/.config}/jira-mcp/env"
chmod 600 "${XDG_CONFIG_HOME:-$HOME/.config}/jira-mcp/env"
```

```sh
read -rs T && printf "JIRA_API_TOKEN='%s'\n" "$(printf '%s' "$T" | sed "s/'/'\\\\''/g")" >> "${XDG_CONFIG_HOME:-$HOME/.config}/jira-mcp/env"; unset T
```

**Both `chmod` lines are load-bearing, and so is the order.** A `umask`
sets the mode only on a file the redirect creates, so a credential file
that already existed would keep whatever mode it had. The first command
writes only the email, so the file is tightened before the token goes in
and the token never sits in a file the rest of the machine can read. A
`umask` in the recipe would also outlive it, leaving the operator's shell
creating unusable directories for the rest of the session.

**The token never passes through a command line.** `read -rs` echoes
nothing and the history keeps `"$T"` rather than the value. Typing the
token as part of a command instead puts it in the interactive shell's
history file, and in whatever backs that file up, which is the exposure
the credential file exists to avoid. An editor is the other way in, for an
operator who prefers one.

The `sed` rewrites every single quote in the value as `'\''`, which closes
the quoted string, emits one escaped quote, and opens a new one. Without it
a token containing a quote ends the quoting early, and the rest of the
value is read as shell code: `ab';id -un;'cd` sources as an assignment, a
command, and a fragment, which both runs that command and silently
truncates the token to `ab`.

**Both values are single-quoted, and that matters at read time.** The
entry reads this file with `.`, which runs it as shell code, so an
unquoted value is expanded there: `JIRA_API_TOKEN=abc$(id -un)` reaches
the server with a username spliced into it, while the single-quoted form
reaches it as those exact characters. A value containing a single quote
needs `'\''` in place of each one.

One file covers every Jira site the Atlassian account can reach. A client
instance where the person holds a separate Atlassian account is a separate
credential, and today that means a separate file per machine, so only one
of the two accounts is reachable at a time.

#### The entry

| Harness | Where it comes from |
|---|---|
| Claude Code | `.mcp.json` at the repository root, written by `setup`, or by hand from the same shape |
| Cursor | `.cursor/mcp.json`, by hand, in the JSON shape below |
| Codex | `.codex/config.toml`, by hand, in the TOML shape below |
| OpenCode | `opencode.json`, shaped per OpenCode's own MCP documentation |
| Pi | The Pi MCP configuration, shaped per its own documentation |

Only Claude Code's file is written. A repo should not carry three
configurations of one server when each person uses one, and asking which
harness at configuration time fails the teammate who uses a different one.

**Name the entry `jira` in every harness.** The name is what says which
entry this repo's tickets live on, so it has to hold for whoever opens the
repo next. A hand-written entry under another name is indistinguishable
from an operator's own second Jira, and the
[which entry](#which-entry-when-there-are-two) table then has nothing to
prefer, so a session holding two of them stops.

Cursor, `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "jira": {
      "command": "sh",
      "args": ["-c",
               "unset JIRA_EMAIL JIRA_API_TOKEN; exec npx -y --package=lean-jira-mcp@0.1.1 -c 'set -a; . \"${XDG_CONFIG_HOME:-$HOME/.config}/jira-mcp/env\" || exit 1; set +a; exec lean-jira-mcp'"],
      "env": {
        "JIRA_BASE_URL": "https://<host>",
        "JIRA_MCP_ATTACHMENT_MAX_BYTES": "26214400",
        "JIRA_MCP_ATTACHMENT_UPLOAD_MAX_BYTES": "26214400"
      }
    }
  }
}
```

Codex, `.codex/config.toml`:

```toml
[mcp_servers.jira]
command = "sh"
args = [
  "-c",
  "unset JIRA_EMAIL JIRA_API_TOKEN; exec npx -y --package=lean-jira-mcp@0.1.1 -c 'set -a; . \"${XDG_CONFIG_HOME:-$HOME/.config}/jira-mcp/env\" || exit 1; set +a; exec lean-jira-mcp'",
]

[mcp_servers.jira.env]
JIRA_BASE_URL = "https://<host>"
JIRA_MCP_ATTACHMENT_MAX_BYTES = "26214400"
JIRA_MCP_ATTACHMENT_UPLOAD_MAX_BYTES = "26214400"
```

OpenCode and Pi use a different configuration shape for MCP servers. Give
their entry the same three ingredients instead: the `npx` command above,
the line that sources the credential file before running the server, and
`JIRA_BASE_URL` plus the two attachment caps as literal values. Their own
MCP configuration documentation has the shape to put them in.

`https://<host>` is the site recorded in `Issue tracker`, verbatim, with
`https://` in front of it. That row holds a bare host, such as
`your-company.atlassian.net` or a custom domain on a Cloud instance, so
appending `.atlassian.net` to it doubles the suffix and cannot express the
custom domain.

#### Why the command is shaped this way

**`--package=<name> -c` rather than `npx -y lean-jira-mcp`.** The package
installs before the command string runs, so the credential file is sourced
once any install script has already finished. `npx` costs 7.3 seconds the
first time on a machine and 0.46 seconds afterwards.

**`sh` is the command, not `npx`, and the order is the point.** The shell
clears `JIRA_EMAIL` and `JIRA_API_TOKEN`, then `exec`s `npx`, so npm and
every lifecycle script in the dependency tree start with both empty
whatever the operator exported. Running `npx` first installs the package
before anything can clear them, which is why the clearing cannot live
inside the string `npx -c` runs.

**The version is pinned to `0.1.1` in the entry.** These skills depend on
this release's exact behaviour, so raising it is an edit to that file, made
deliberately, and every teammate picks it up with the next pull.

**The credential is sourced, not interpolated.** `${JIRA_API_TOKEN}` in an
entry expands from the harness process's own environment, and a harness
launched from the Dock or Finder inherits nothing from a shell profile, so
that expansion can quietly produce an empty string. A shell actually runs
here, so it can read a file. `JIRA_BASE_URL` and the attachment caps are
literals because none of them is a secret.

**The entry is POSIX shell twice over, so it needs one on the machine.**
`sh` is the command itself, and `npx -c` then hands the inner string to
npm's `script-shell`, which is `/bin/sh` on macOS and Linux and `cmd.exe`
on Windows. Native Windows satisfies neither: there is no `sh` to run as
the command, and `set -a`, `.` and `exec` mean nothing to `cmd.exe`. A
Windows operator runs the harness from WSL or Git Bash, where both are
satisfied, and points npm at a POSIX shell with
`npm config set script-shell bash` if its default still resolves to
`cmd.exe`. State the limitation rather than inventing a `cmd.exe`
translation: a wrong command is worse than none.

**`|| exit 1` after the source is what makes a missing file fatal.** POSIX
`sh` aborts on its own when `.` cannot read the file, but `bash` prints the
error and carries on, so the server would start with whatever `JIRA_*` the
environment happened to hold. That is not a hypothetical shell: the Windows
paths above put `bash` under `npx` deliberately. With the guard both shells
exit 1 and name the path, and the server never runs on inherited values.

**Both attachment caps sit at their 26214400-byte default.** They are in
the entry so the repo records what the server was configured with, rather
than depending on a default that could move under it.

`JIRA_PROJECT_DEFAULT` is deliberately unset. One entry serves every repo
on that site, each with its own project key, so a default would be right
for one repo and quietly wrong for the rest. `issue-authoring` passes the
project explicitly.

#### The approval travels with the repo

Claude Code starts no project-scoped server until somebody says so, and it
reads that consent from `enabledMcpjsonServers` in
`.claude/settings.json`. `setup` writes that key beside the entry, so a
fresh clone has a server that runs and nobody answers a prompt.

Where the key is absent the prompt exists only in the interactive `claude`
in a terminal. A desktop session lists the entry as `Pending approval` and
offers nothing to answer it with, so an operator there runs `claude` once
in the repo.

The consent is matched by server name, not by what the entry runs, so a
later edit to the command runs without asking again. The team is trusting
whoever can push to the repo, the same trust a `postinstall` script or a
CI workflow there already carries. A repo the operator does not control
gets no such key.

A project MCP server cannot be started or reconnected mid-session. A run
that has just written `.mcp.json` therefore exposes no tool for it, and
whatever needs the server waits for the next session.

## Checking availability

The probe is the same in every harness: **the plugin's skills are present in
the session's skill listing.** A plugin that is installed but not enabled is
indistinguishable from one that was never installed, and that is correct —
neither can run a skill.

Check the plugin, not one named skill. A single skill missing from an
otherwise-present plugin is a different problem, and treating it as a missing
plugin would send the human to an install command that changes nothing.

This is stated once, here, rather than repeated at each step that needs it.

## When the session cannot be read

A harness that exposes no skill listing **fails closed**, the same way the
Jira server check above does. There is no way to tell "not installed" from
"cannot see", and reduced mode is a weaker process than the full one, so
guessing there silently downgrades a developer who has `superpowers`
installed.

Stop. Say the harness cannot report its own skills, and ask the human
which mode to run.

## Running without superpowers

`superpowers` is recommended. A session without it runs **reduced mode**:
every step that would call one of its skills has a fallback, and the flow
takes a ticket to a draft pull request as usual.

Say it once, at pre-flight, then run. Three things:

- that `superpowers` is absent and the run continues in reduced mode;
- what the mode changes, in one clause;
- the install path for the harness in use, verbatim from the per-harness
  table above, so the full track stays one command away.

Under Claude Code:

> `superpowers` is not available in this session. Running in reduced
> mode: the design track uses this harness's plan mode, and steps 6, 7
> and 9 use their inline equivalents. Install it with
> `/plugin install superpowers@apptension-sdlc` for the full track.

Once, not per step. A run that announces the substitution every time it
reaches one spends tokens telling the developer something they chose.

Reduced mode is not a licence to skip a step. It changes how a step is
carried out, never whether it happens: the design gate keeps all three
tracks and every criterion, pre-flight keeps all of its checks, and the
craft checklist and verification are untouched.

### What reduced mode gives up

Worth knowing before choosing it, and worth stating rather than leaving a
developer to discover:

- Nothing lands in the repository. The harness may write a plan of its own
  wherever it keeps one, but no spec or plan reaches the repo, so the pull
  request's `Design decision` field carries two sentences and no file
  reference.
- An interrupted session restarts the design gate. On the full track a
  spec file survives for the next session to read, and a plan the harness
  holds does not.
- One round of clarifying questions rather than the one-question-per-message
  loop `brainstorming` runs, which catches less.
- Weaker enforcement. On a harness with no plan mode, only the agent's own
  discipline stops an edit before the human approves.
