# Apptension SDLC Toolkit

Apptension's public plugin marketplace — SDLC processes, code and infrastructure review, E2E test generation, and frontend craft, as installable plugins for Claude Code, Cursor, Codex, OpenCode, and pi.

> **This repository is generated.** It is built from Apptension's internal
> toolkit repo and force-synced on every release, so any commit made here is
> overwritten. Open issues and pull requests upstream, not here.

## Plugins

- **apptension-e2e-testing** — Apptension E2E testing — generates Playwright end-to-end test specs from a ticket's description, unit tests, and a testing-guide doc, then verifies they run.
- **apptension-frontend-craft** — Award-informed product experience skills for AI coding agents: complete UI states, interaction craft, supporting imagery, forms, polish passes, and anti-slop visual design. Complements Superpowers and Apptension SDLC so frontend work ships calm, original, and complete — not template-blank.
- **apptension-review** — Apptension review skills — methodical assessments of code, infrastructure, and security, plus a full project audit with scored, comparable reports. Findings and reports only; no code changes.
- **apptension-sdlc** — Apptension SDLC processes as skills plus bundled docs: how we work, authored once and consumed by both AI agents and the documentation site.
- **superpowers** — Complete software-development methodology for AI coding agents: TDD, systematic debugging, brainstorming, plan-driven execution, and ~50 composable skills.

## Install

### Claude Code

```
/plugin marketplace add https://github.com/apptension/apptension-sdlc
/plugin install <plugin>@apptension-sdlc
```

Or from a shell:

```
claude plugin marketplace add https://github.com/apptension/apptension-sdlc
```

### Cursor

Open the plugin browser, add `https://github.com/apptension/apptension-sdlc` as a marketplace, then install
the plugins you want.

### Codex

Add `https://github.com/apptension/apptension-sdlc` as a marketplace; the manifest is
`.agents/plugins/marketplace.json`.

### OpenCode

Add the package to `opencode.json`:

```json
{
  "plugin": ["apptension-sdlc-toolkit@git+https://github.com/apptension/apptension-sdlc.git"]
}
```

Then choose plugins in `.opencode/apptension.json`:

```json
{ "plugins": ["apptension-e2e-testing", "apptension-frontend-craft", "apptension-review", "apptension-sdlc", "superpowers"] }
```

### pi

```
pi install git:github.com/apptension/apptension-sdlc
```

Then choose plugins in `.pi/apptension.json`, same shape as above.
