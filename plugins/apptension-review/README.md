# apptension-review

Apptension review skills — methodical assessments that produce
findings and reports without modifying the code.

## When to use it

I turn this on when I'm about to review my team's work — a pull
request, the project's infrastructure, or its security posture —
and want a thorough pass that flags real issues without nitpicking
what CI already catches.

## What's inside

- `code-review` skill — methodical review of a changeset or PR across
  seven quality areas (including **4g. Product experience** for UI);
  prints findings in-session and can post as a GitHub PR review with
  inline comments via `gh`.
- `infra-review` skill — repo-level audit of infrastructure, IaC
  quality, 12-factor compliance, CI/CD, secrets handling, and
  observability. Outputs a markdown risk report to chat;
  optionally posts as a GitHub Issue. Apptension-specific severity
  bumps live in a bundled reference doc, swappable per fork.
- `project-audit` skill — full project health audit; runs the
  code-review methodology over the whole codebase and the
  infra-review audit in parallel, scores each area 0–100, and
  writes a combined, comparable report to a git-ignored
  `.apptension-audit/` directory. Incremental on re-runs.

Planned:

- `security-review` skill — focused security pass (deferred until
  it's clear how it differs from Claude Code's bundled
  `security-review`).

## Notes

The plugin is named `apptension-review` (not `apptension-quality`)
to keep the intent sharp: read-only assessments, output = findings.
Mutating refactors (`simplify`, `dead-code-removal`, etc.) belong
in a separate `apptension-refactoring` plugin if and when we ship
them — see [`plugins/README.md`](../README.md) for the
plugin-organization principles this layout follows.

This plugin was renamed from `apptension-code-quality` (v0.1) in
v0.2.0 to widen scope from code-only to "code + infra + security
reviews". The renamed scope still passes the
*"I turn this on when I'm about to ___"* test cleanly.
