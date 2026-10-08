---
name: check-sdlc-plugins
description: Plugin availability for the SDLC skills, called by run-preflight, setup, cezar-setup and pr-checks. Checks whether superpowers is in the session, picks full or reduced mode, announces reduced mode, and gives this harness's install path.
---

# Check the SDLC plugins

The SDLC skills are written on top of skills other plugins ship. This skill
records which, how to tell whether one is in the session, and what to hand
a human who lacks one.

## The list

| Plugin | Install from | Used by | Without it |
|---|---|---|---|
| `superpowers` | `superpowers@<the Apptension marketplace you added>` | `dev-flow`, `plan-issue`, `implement-issue`, `pr-checks` | [Reduced mode](#reduced-mode) |
| `apptension-frontend-craft` | Optional | `implement-issue` and `issue-authoring` load its craft skills for user-facing UI | The craft bar holds either way. Never a stop |
| `apptension-e2e-testing` | Optional | `implement-issue` step 8 calls its `generate` skill where the repo has an E2E scaffold and a human confirmed E2E tests for the ticket | Step 8 skips silently. Never a stop |

`superpowers` is the one plugin whose absence changes a run. Any source
satisfies it: `superpowers@apptension-sdlc` from the Apptension marketplace,
Anthropic's auto-registered `superpowers@claude-plugins-official`, or
[obra/superpowers](https://github.com/obra/superpowers) directly. The
Apptension marketplaces list it as an external entry pointing at obra's
repo, so every source runs the upstream version.

## Operations

The caller names the operation.

| Operation | Called when | Returns |
|---|---|---|
| [Check availability](#check-availability) | A caller decides its mode: `run-preflight` step 5, `pr-checks` in a fresh session, `setup` step 2 | `full`, `reduced`, or a stop |
| [Announce reduced mode](#announce-reduced-mode) | Check availability returned `reduced` | The one message, sent |
| [Install path for this harness](#install-path-for-this-harness) | A caller hands a human the install step: the announcement, `setup`'s summary, `cezar-setup`, `pr-checks` in a fresh session | The line for the harness in use |

### Check availability

A plugin is available when its skills appear in the session's skill
listing, in every harness. Check the plugin, never one named skill: a
single skill missing from a present plugin is a different problem, and an
install command changes nothing there. Installed but disabled counts as
absent, since neither can run a skill.

| Skill listing | Returns |
|---|---|
| Lists `superpowers` skills | `full` |
| Lists none | `reduced` |
| The harness cannot list its own skills | **Stop.** Say the harness cannot report its own skills, and ask the human which mode to run |

The stop fails closed. "Not installed" and "cannot see" look the same
there, and guessing `reduced` silently downgrades a developer who has
`superpowers`.

Done when the result is with the caller.

### Announce reduced mode

Send one message, before anything moves, saying three things: that
`superpowers` is absent and the run continues in reduced mode, what the
mode changes in one clause, and this harness's install path. Under Claude
Code:

> `superpowers` is not available in this session. Running in reduced mode:
> the design track uses this harness's plan mode, and steps 6, 7 and 9 use
> their inline equivalents. Install it with
> `/plugin install superpowers@apptension-sdlc` for the full track.

Other harnesses keep the first two parts and end with their line from
[Install path for this harness](#install-path-for-this-harness).

Once per run, never per step: the developer chose the substitution.

Done when the message is sent.

### Install path for this harness

This table is the complete install guidance: hand the human the line for
their harness, verbatim. Every path works without private marketplace
access.

| Harness | What to hand the human |
|---|---|
| Claude Code | `/plugin install superpowers@apptension-sdlc`, or `/plugin install superpowers@claude-plugins-official` |
| Cursor | Install `superpowers` from the Apptension marketplace already added, or add `https://github.com/obra/superpowers` directly |
| Codex | Install `superpowers` from the Apptension marketplace already added, or from `https://github.com/obra/superpowers`, which ships its own `.agents/plugins/` manifest |
| OpenCode | Add `superpowers@git+https://github.com/obra/superpowers.git` as a separate package in the global or project `opencode.json` |
| Pi | `pi install git:github.com/obra/superpowers` |

OpenCode and Pi install `superpowers` as its own package from obra's repo,
registered by its own `opencode.json` entry or `pi install`. Never add it
to `.opencode/apptension.json` or `.pi/apptension.json`: those selectors
register this toolkit's local plugins only and reject an external one with
an error.

Done when the caller has the line.

## Reduced mode

A session without `superpowers` runs reduced mode. Every step that would
call one of its skills has a fallback, and the flow takes a ticket to a
draft pull request as usual. Reduced mode changes how a step is carried
out, never whether it happens: the design gate keeps all three tracks and
every criterion, pre-flight keeps all of its checks, and the craft
checklist and verification are untouched.

What it gives up, worth stating before a developer chooses it:

- No spec or plan reaches the repo, so the pull request's `Design
  decision` carries two sentences and no file reference.
- An interrupted session restarts the design gate. A full-track spec file
  survives for the next session; a plan the harness holds does not.
- Clarifying questions come in one round, where `brainstorming` asks one
  question per message and catches more.
- On a harness with no plan mode, only the agent's own discipline holds an
  edit until the human approves.
