---
title: Required plugins
area: getting-started
position: 3
summary: The plugins these processes need present in the session, and what an agent does when one is missing.
plugin: apptension-sdlc
---

# Required plugins

Some processes here are written on top of skills another plugin ships. This
page is the one place that records which, so a process step can point at it
instead of leaving the dependency implicit in its prose.

An agent reads this page at pre-flight. A human reads it before installing.

## The list

| Plugin | Install from | Required by | What breaks without it |
|---|---|---|---|
| `superpowers` | `superpowers@<the Apptension marketplace you added>` | [`dev-flow`](./dev-flow.md), [`pr-checks`](./pr-checks.md) | The design track (`brainstorming`, `writing-plans`), implementation under `test-driven-development`, the failure route to `systematic-debugging`, `verification-before-completion`, and `receiving-code-review` in the monitor loop |

Whichever Apptension marketplace you installed this plugin from also carries
`superpowers`: `apptension-sdlc` publicly, `apptension-dev` inside Apptension.
Anthropic's auto-registered `superpowers@claude-plugins-official` satisfies the
same requirement, as does installing it straight from
[obra/superpowers](https://github.com/obra/superpowers). Any of them is fine —
the check looks for the plugin, not for where it came from.

`superpowers` is listed in the Apptension marketplaces as an **external**
entry pointing at obra's repo, not a copy of it, so you always get upstream's
version.

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

**OpenCode and Pi are the exception, and it is not optional.** On those two,
`superpowers` must be its own package from obra's repo. The Apptension
selector registers *local* plugins only; naming an external one in
`.opencode/apptension.json` or `.pi/apptension.json` raises
"uses a separate package installation" rather than installing it.

Every path above works without access to a private marketplace: upstream ships
a manifest per harness at its repo root, and the public `apptension-sdlc`
marketplace lists `superpowers` as an external entry pointing there.

[`getting-started.md`](./getting-started.md) holds the full install
instructions for Claude Code, Cursor, Codex, OpenCode, and Pi, but that page
is site-only and is not bundled into this plugin, so an agent running under
Cursor, Codex, OpenCode, or Pi has this table and nothing else to go on. In
OpenCode, do not add `superpowers` to `.opencode/apptension.json`: that
selector chooses which skills and commands from the Apptension toolkit package
are registered. Superpowers is registered by its own package entry in the
global or project `opencode.json`. In Pi, do not add `superpowers` to
`.pi/apptension.json`; it is registered by its own `pi install`.

`apptension-frontend-craft` is **not** on this list. It is genuinely
optional: [`dev-flow`](./dev-flow.md) prefers its skills for user-facing UI
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

**Cloud only, and the resource list is the only test for it.** Do not test
the hostname: Jira Cloud supports custom domains, so a client on
`jira.client.com` is Cloud and a hostname rule would reject them as Data
Center. Data Center genuinely is unsupported — the MCP does not speak to
it — but that is a limitation to state, not a thing this can detect.

### What each failure means

Four classes, four different next actions for the human. They are not
interchangeable, and a stop that names the wrong one sends someone to fix
something that is not broken.

| Failure | What it means | What the stop says |
|---|---|---|
| No tool list in the harness | Cannot verify anything | Fail closed: this harness cannot confirm the connector, so the Jira path is unavailable here |
| No tool ending in `getJiraIssue` | Not connected | Connect the Atlassian connector (below), then start again |
| Any call returns 401 or 403 | Connected, session dead | **Sign in again.** Installing changes nothing — the tools are already there |
| Site absent from the resource list | Not Cloud, or not granted | Either that site is not Jira Cloud (Data Center is unsupported), or this account has not been granted it — check which |

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

## When one is missing

Stop. Say three things, then wait for the human:

- which plugin is missing;
- which step needed it, and what that step would otherwise have done;
- the install path for the harness in use, verbatim, from the per-harness
  table above — never the Claude Code slash command in a session that isn't
  Claude Code.

Under Claude Code:

> `dev-flow` needs `superpowers`, which isn't available in this session — its
> design gate, TDD, and debugging steps are all its skills. Install it with
> `/plugin install superpowers@apptension-sdlc` and start again.

Under Cursor, the same stop ends "install `superpowers` from the Apptension
marketplace you already added, then start again"; under Codex, the same; under
OpenCode, with "add
`superpowers@git+https://github.com/obra/superpowers.git` as a separate package
in `opencode.json`, then restart OpenCode and start again"; under Pi, with
"`pi install git:github.com/obra/superpowers`, then restart pi and start
again." The first two things to say do not change.

**Stop before the first side effect, not at the step that needs the skill.**
The point of checking at pre-flight is that a flow which stops later has
already cut a branch, moved a board card, and assigned the issue — leaving a
repo that looks worked-on and an issue owned by someone who did nothing. See
[`./dev-flow.md`](./dev-flow.md) step 2 for where the check sits relative to
those.

Do not degrade gracefully. There is no fallback path for a missing required
plugin: a design gate that skips brainstorming because the skill was absent
has taken the direct track without the human's confirmation, which
[`./dev-flow.md`](./dev-flow.md) sanctions only explicitly.

## Why this isn't the cross-plugin dependency the rules forbid

`plugins/README.md` lists cross-plugin runtime dependencies under its
anti-patterns, and holds that plugins are self-contained. A declared,
checked-up-front prerequisite is the sanctioned case, not a violation: the
anti-pattern is about a dependency nobody wrote down, which surfaces as a
half-working plugin mid-run.

The three conditions a prerequisite has to meet — and why vendoring the
other plugin's skills instead would be worse — are recorded in
[`plugins/README.md` → Declared prerequisites](https://github.com/apptension/toolkit-dev/blob/main/plugins/README.md#declared-prerequisites),
next to the anti-pattern bullet itself, which is where a plugin author will
be reading when the question comes up.

## Adding to this page

A process that cannot run without another plugin's skills adds a row, and its
own step prose links here rather than restating the dependency. A process that
merely works *better* with another plugin does not belong on this list — say
that in the step, the way `dev-flow` does for `apptension-frontend-craft`.

The list is maintained by hand. It is short by design: a process that needs
three other plugins to function is a process worth redesigning.
