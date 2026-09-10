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

## The Atlassian connector

Required **only when the `Issue tracker` binding names Jira**. A
GitHub-tracked repo never reaches for it, and its absence there is not a
finding.

This is a connector, not a plugin, so it gets no `checklist.json` entry:
that file records artifacts a commit can add to a repo, and a session
connector is not one.

### Finding it

Match the tool in the session's own tool list whose name **ends in**
`getJiraIssue`. Match on the suffix and nothing else. The connector's
prefix is environment-specific — in the session this was written from it
is a UUID that changes on reinstall, and `~/.claude.json` records only the
string `"claude.ai Atlassian"`: no URL, no server entry. Reading a server
name out of any config file finds nothing here and must not be attempted.

A harness that exposes no tool list at all **fails closed**. There is no
way to tell "not installed" from "cannot see" there, and guessing means
guessing about somebody's Jira.

### Proving it works

The tool being listed proves only that it is listed. It says nothing about
whether the OAuth session behind it is still valid, or whether the account
can see the recorded site. So one real call follows, and it is the one
that counts:

    getAccessibleAtlassianResources()

It answers three questions at once — the session is alive, the recorded
site is Cloud *and* granted to this account, and here is the site list to
scope against. `dev-flow` makes this call at pre-flight, before it cuts a
branch or assigns anything.

**The same site can appear twice.** `getAccessibleAtlassianResources()`
returns one entry per scope group, Confluence and Jira granted separately,
so an account with both appears once for each. Match the hostname *and*
confirm the matching entry carries Jira scopes — a Confluence-only entry
for the same site is not Jira access, however clean the hostname match
looks. Never treat one entry as "not granted" or two as a duplicate to
worry about.

**Cloud only, and the resource list is the only test for it.** Do not test
the hostname: Jira Cloud supports custom domains, so a client on
`jira.client.com` is Cloud and a hostname rule would reject them as Data
Center. Data Center genuinely is unsupported — the MCP does not speak to
it — but that is a limitation to state, not a thing this can detect.

### What each failure means

Six classes, six different next actions for the human. They are not
interchangeable, and a stop that names the wrong one sends someone to fix
something that is not broken.

| Failure | What it means | What the stop says |
|---|---|---|
| No tool list in the harness | Cannot verify anything | Fail closed: this harness cannot confirm the connector, so the Jira path is unavailable here |
| No tool ending in `getJiraIssue` | Not connected | Connect the Atlassian connector (below), then start again |
| Any call returns 401 or 403 | Connected, session dead | **Sign in again.** Installing changes nothing — the tools are already there |
| Site missing, and the call returns `isn't explicitly granted by the user` | Consent not given for that site | Redo consent and select every site needed. Consent is per site |
| Site missing, and it won't open in a browser either | No account access | The account genuinely lacks access. Its admin has to grant it |
| Site missing, consent granted, still absent | Not Cloud, or app restricted | Either it is not Jira Cloud (Data Center is unsupported), or the site restricts third-party apps and its admin has not approved this one |

### Connecting it, per harness

The `superpowers` table above is a `plugin@marketplace` reference this
repo publishes, so its five install paths are exact. This repo publishes
no Atlassian connector, so this table points at where each harness keeps
its connector settings and stops there. A wrong command is worse than
none — that is the same rule the section above states for plugins.

| Harness | What to hand the human |
|---|---|
| Claude Code | Add the Atlassian connector in claude.ai's connector settings — it attaches to the account, not to this repo, and appears in the session's tool list once connected |
| Cursor | Add Atlassian's MCP server in Cursor's MCP settings |
| Codex | Add Atlassian's MCP server to the Codex MCP configuration |
| OpenCode | Add Atlassian's MCP server to `opencode.json` |
| Pi | Add Atlassian's MCP server to the Pi MCP configuration |

Atlassian publishes the endpoint and the per-client steps; this page
deliberately does not copy them, because a copied endpoint goes stale
silently and this repo has no way to notice.

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
Atlassian check above does. There is no way to tell "not installed" from
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
