# Configure the server

Read when composing the repo's Jira server entry (`setup` step 4), or when
a human configures the server in their own harness.

The server splits across two owners:

- **The entry belongs to the repo.** Under Claude Code it is `.mcp.json`
  at the repository root, pinned to a package version and pointed at the
  recorded site, so a teammate who clones the repo installs nothing and
  retypes no site.
- **The credential belongs to the person.** One file per machine, shared
  by every project on that Atlassian account, never committed.

## The entry

| Harness | Where it lives |
|---|---|
| Claude Code | `.mcp.json` at the repository root, composed by `setup`, or by hand from the same shape |
| Cursor | `.cursor/mcp.json`, by hand, in the JSON shape below |
| Codex | `.codex/config.toml`, by hand, in the TOML shape below |
| OpenCode | `opencode.json`, shaped per OpenCode's own MCP documentation |
| Pi | The Pi MCP configuration, shaped per its own documentation |

Only Claude Code's file is composed: a repo carries one configuration of
the server, and each other harness's user writes their own.

**Name the entry `jira` in every harness.** The name tells the skills which
entry holds this repo's tickets. An entry under another name looks like a
second Jira kept for other sites, so the [which entry](server.md#which-entry-when-there-are-two)
table has nothing to prefer and a session holding both stops. The name in
`.mcp.json` is the record of which server the repo uses: no bindings row
repeats it.

Claude Code `.mcp.json`, and Cursor `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "jira": {
      "command": "sh",
      "args": ["-c",
               "unset JIRA_EMAIL JIRA_API_TOKEN; npx -y --package=lean-jira-mcp@0.1.1 -c 'exit 0' >/dev/null 2>&1 || exit 1; set -a; . \"${XDG_CONFIG_HOME:-$HOME/.config}/jira-mcp/env\" || exit 1; set +a; exec npx -y --package=lean-jira-mcp@0.1.1 lean-jira-mcp"],
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
  "unset JIRA_EMAIL JIRA_API_TOKEN; npx -y --package=lean-jira-mcp@0.1.1 -c 'exit 0' >/dev/null 2>&1 || exit 1; set -a; . \"${XDG_CONFIG_HOME:-$HOME/.config}/jira-mcp/env\" || exit 1; set +a; exec npx -y --package=lean-jira-mcp@0.1.1 lean-jira-mcp",
]

[mcp_servers.jira.env]
JIRA_BASE_URL = "https://<host>"
JIRA_MCP_ATTACHMENT_MAX_BYTES = "26214400"
JIRA_MCP_ATTACHMENT_UPLOAD_MAX_BYTES = "26214400"
```

OpenCode and Pi take the same three ingredients in their own shape: the
command above, the line that sources the credential file before the
server runs, and `JIRA_BASE_URL` plus the two attachment caps as literal
values.

### Composing the repo's `.mcp.json`

- **`JIRA_BASE_URL`** is `https://` followed by the host recorded in `Issue
  tracker` (`Jira, project key <KEY>, site <site>`), verbatim, with any
  scheme a human typed stripped so the prefix is never doubled. The host
  may be `your-company.atlassian.net` or a custom domain. Never append
  `.atlassian.net`.
- **A site of `unknown` composes no file.** An entry aimed at a guessed
  host reads tickets from somewhere nobody named.
- **An existing `.mcp.json` keeps everything that is not this entry.**
  Replace `mcpServers.jira` and leave every other server and top-level key
  as it is. A file that does not parse as JSON is left untouched and
  reported: an entry someone is mid-edit on is worth more than this one.
- **Compose the approval key beside it.** Claude Code starts a project
  server only with consent, read from `enabledMcpjsonServers` in
  `.claude/settings.json`. Compose that key holding `jira`, so a teammate
  gets a working server. Without it the consent prompt exists only in the
  interactive terminal `claude`, and the desktop app lists the entry as
  `Pending approval` with nothing to click: an operator there runs `claude`
  once in the repo to answer it. An existing
  `.claude/settings.json` keeps every other key, and one that does not
  parse is left untouched and reported. The consent matches by server
  name, so a later edit to the command runs without asking: the same trust
  a `postinstall` script or CI workflow in the repo already carries.
- **Compose it under every harness.** The file belongs to the repo, so a
  run under Cursor, Codex, OpenCode or Pi composes it too, and tells the
  operator which entry their own harness still needs, per the table above.

A project MCP server cannot start or reconnect mid-session, so the run
that writes `.mcp.json` sees no tool for it until the next session.

### Why the command is shaped this way

Copy the command exactly. Each part guards a failure:

- **`sh` is the command, not `npx`.** The shell clears `JIRA_EMAIL` and
  `JIRA_API_TOKEN` before either `npx` runs, so npm and every lifecycle
  script start with both empty, whatever the operator exported.
- **The install is its own `npx` call, and runs first.** `-c 'exit 0'`
  fills the cache and runs nothing, so every install script has finished
  before the credential file is sourced. The second `npx` starts the
  server from the cache with no `-c`. npm hands a `-c` string to its
  `script-shell`, which is `cmd.exe` on Windows, and `exit 0` means the
  same there. Each warm `npx` costs about 0.46 seconds.
- **The outer `sh` is the one POSIX requirement.** A Windows operator runs
  the harness from WSL or Git Bash. State the requirement; a translated
  `cmd.exe` command would be wrong.
- **`|| exit 1` after the source makes a missing file fatal.** POSIX `sh`
  aborts when `.` cannot read the file, but `bash` (the `sh` on Git Bash)
  carries on with whatever `JIRA_*` the environment held.
- **The credential is sourced, not interpolated.** `${JIRA_API_TOKEN}` in
  an entry expands from the harness's own environment, which is empty for
  a harness launched from the Dock or Finder.
- **The version is pinned to `0.1.1`.** These skills depend on this
  release's behaviour, so raising it is a deliberate edit every teammate
  picks up with the next pull.
- **Both attachment caps sit at their 26214400-byte default**, recorded so
  the entry does not depend on a default that could move.
- **`JIRA_PROJECT_DEFAULT` is unset.** One entry serves every repo on the
  site, each with its own project key, so callers pass the project
  explicitly.

**`MCP_TIMEOUT` belongs to the harness process.** A cold `npx` install has
been measured between 7.3 and 35 seconds, against Claude Code's 30-second
startup budget, so the first run on a machine can time out. Export
`MCP_TIMEOUT=120000` in the environment the harness launches from. In
`mcpServers.jira.env` it does nothing.

## The credential file

Once per machine, at `${XDG_CONFIG_HOME:-$HOME/.config}/jira-mcp/env`,
mode 600, holding `JIRA_EMAIL` and `JIRA_API_TOKEN`. The first block waits
for the email on its third line, and the second for the token:

```sh
mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/jira-mcp"
chmod 700 "${XDG_CONFIG_HOME:-$HOME/.config}/jira-mcp"
read -r E && printf "JIRA_EMAIL='%s'\n" "$(printf '%s' "$E" | sed "s/'/'\\\\''/g")" > "${XDG_CONFIG_HOME:-$HOME/.config}/jira-mcp/env"; unset E
chmod 600 "${XDG_CONFIG_HOME:-$HOME/.config}/jira-mcp/env"
```

```sh
read -rs T && printf "JIRA_API_TOKEN='%s'\n" "$(printf '%s' "$T" | sed "s/'/'\\\\''/g")" >> "${XDG_CONFIG_HOME:-$HOME/.config}/jira-mcp/env"; unset T
```

- **Both `chmod` lines, in this order.** A redirect sets the mode only on a
  file it creates, so an existing file keeps its old mode. The first
  command writes only the email, so the file is tightened before the token
  goes in. A `umask` in the recipe would outlive it in the operator's
  shell.
- **The token never passes through a command line.** `read -rs` echoes
  nothing, and the shell history keeps `"$T"`, not the value.
- **The `sed` escapes single quotes** as `'\''`, in the email and the
  token alike. Without it, a value containing a quote ends the quoting
  early: `ab';id -un;'cd` both runs `id -un` and truncates the token to
  `ab`, and an email such as `o'connor@example.com` leaves the file
  unsourceable.
- **Both values are single-quoted.** The entry sources the file as shell
  code, so an unquoted `JIRA_API_TOKEN=abc$(id -un)` would reach the
  server with a username spliced in.

One file covers every Jira site the Atlassian account reaches. A client
instance under a separate Atlassian account needs its own file, so only
one of the two accounts is reachable at a time.

Done when the entry and the credential file are in place for the
harness, or, for `setup`, when the composed entry and approval key are
with the caller.
