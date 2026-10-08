# Detect

Read at step 1. Resolve every row from the repo's own configuration.

## Sources

| Value | Source |
|---|---|
| Code host | `git remote -v` |
| Issue tracker | See [Issue tracker](#issue-tracker) below |
| Default branch | `git symbolic-ref refs/remotes/origin/HEAD` |
| Branching model | The base branch of the last ~30 merged pull requests (`gh pr list --state merged --limit 30 --json baseRefName`), read as where feature work lands. A clear majority onto the default branch is GitHub flow. A clear majority onto another branch names that branch as the one feature work integrates through, whatever the repo calls the model. No merged pull requests, no clear majority, or a host this cannot query on leaves the row `unknown`. Read merge history only: a branch on the remote, such as `origin/develop`, says nothing about whether anything merges into it |
| CI provider | `.github/workflows/`, `bitbucket-pipelines.yml`, `.gitlab-ci.yml` |
| Stack | The manifests, read for what the repo is: `package.json` (plus its lockfile, `engines`, and framework dependencies), `pyproject.toml` or `requirements.txt`, `go.mod`, `Cargo.toml`, `composer.json`, `Gemfile`, `pom.xml` or `build.gradle`, plus `Dockerfile` and any pinned-version file (`.nvmrc`, `.python-version`, `.tool-versions`). Record the language and its runtime version, the package manager, and the dominant framework, in the repo's own names. A polyglot repo names each part |
| Verification commands | `package.json` scripts, `Makefile` targets, `pyproject.toml`, `composer.json`, plus the E2E command under [Verification and E2E](#verification-and-e2e) |
| Verification skill | Optional repository-relative `SKILL.md` path from the project verification discovery in [audit.md](audit.md#project-verification-discovery). Preserve a valid explicit binding. An absent row keeps the command-only flow until a project skill is found or created |
| Automated reviewer | The GitHub Actions repository variable `AUTOMATED_REVIEWER`, after a confirmed automated-review workflow. It is exactly `claude` or `codex`. An empty or unsupported value is a configuration failure, not an `unknown` binding. Also confirm no second independently triggered automated-review workflow is active: two active reviewers are the same misconfiguration |
| Commit convention | The Conventional Commits prefix rate across the last ~50 subject lines |
| Specs and plans | An existing `### Dev flow bindings` section's own value, and nothing else. With no such section, `unknown`. A `docs/superpowers/specs/` directory on disk says nothing about whether the repo ignores it, and a row naming a tracked path turns working notes into committed content. The paths and their ignore rule are a human's call |
| Board | Human-supplied. Carry over an existing row that already names a board view. A carried-over row naming a project and no view is resolved at the gate like a fresh one. Otherwise `unknown` until a human names the GitHub Project, however many the `board` probe returned: the probe proves the owner has a project, and ties none of them to this repo. Under a Jira tracker the row is absent, and that is correct: Jira status transitions carry the card |
| Task orchestrator | An existing `### Dev flow bindings` row, carried over verbatim, and nothing else. With no row, `unknown`, and the gate asks. `unknown` means this repo works its issues in live sessions, the ordinary case. See [Task orchestrator](#task-orchestrator) |
| E2E | See [Verification and E2E](#verification-and-e2e) |

## Issue tracker

Scan the last ~300 commit subjects and ~100 merged pull-request titles for
`[A-Z][A-Z0-9]*-\d+`, and count prefixes with `sort | uniq -c | sort -rn`.

| Evidence | Result |
|---|---|
| A prefix in at least five of them, and the most frequent prefix found | Propose it as the Jira project key. It goes to the gate with the site question, never written on its own |
| Below that, and no Jira-shaped reference at all | GitHub-tracked. Nothing asks |
| Below that, with at least one Jira-shaped reference | Ambiguous. Propose nothing; the gate asks whether the repo is Jira-tracked |
| An existing `Issue tracker` row already naming Jira | Carry it over as-is and skip the regex |

Five, because a lone noisy prefix with no competitor is the most frequent
by default: three stray `PR-N` references must not make a Jira repo. The
regex also matches `UTF-8`, `ISO-8601`, `SHA-256`, `RFC-2119`, `PR-42` and
`GH-123`. Dominance removes that noise, so use no stoplist. A carried row
skips the regex: the regex never overrides a value a human set.

Whenever the effective tracker is Jira (proposed, ambiguous, or carried
with a value missing), the gate asks the Jira questions in
[jira.md](jira.md#gate-questions).

## Task orchestrator

The row and this machine's state are two facts, and they stay apart:

- The row is the repo's decision, written into the committed bindings file.
- Whether this machine is configured differs per developer, because the
  orchestrator's configuration is git-ignored and never travels with a
  clone.

Read the row from the bindings or ask for it. An orchestrator binary on
`PATH`, or an orchestrator directory in this checkout, is one developer's
install and never evidence for the row. Step 6 probes the machine, the
only step that acts on it.

## Verification and E2E

**`E2E` row.** Read the `### E2E bindings` section's `Location` row in the
bindings file, and resolve it to a spec dir by the rule `generate` applies:
read `<Location>`'s own `playwright.config.{ts,js,mjs,cjs}`, that location
only.

| Found | Spec dir |
|---|---|
| A `testDir` naming a sub-directory | `<Location>/<testDir>`, so `testDir: './tests'` records `<Location>/tests` |
| A `testDir` of `.`, none named, or no config | `<Location>/specs` |
| No section or no `Location` row: a `playwright.config.` in `e2e/web/` with an extension `e2e-setup` supports (`.ts`, `.js`, `.mjs`, `.cjs`) | The spec dir that config sets |
| Nothing, and the human declined `e2e-setup` at the gate | `not adopted` |
| Nothing, and nobody answered | `unknown` |

A `playwright.config.*` elsewhere that `Location` does not point at is
another suite, and earns no credit.

**E2E verification command.** Add one only when a scaffold resolved and at
least one `*.smoke.spec.*` file exists under the `E2E` row's spec dir. A
fresh scaffold with `discover` declined has zero specs, and a smoke run
against none fails falsely.

- The command is `cd <spec dir's package root> && <detected manager> run
  test:e2e:smoke`, when that script exists. The script lives in the
  suite's own `package.json`, so the `cd` is required.
- Fall back to `test:e2e` only when `e2e-setup` wrote the scaffold (status
  `ok`). A `conform` scaffold's `package.json` belongs to the repo's
  authors, and its `test:e2e` may be absent or run far more.
- Never the granular suite: `implement-issue` step 8 runs an issue's own
  specs.
- With no qualifying script, add no E2E command.

## Unresolved values

A value detection cannot resolve is `unknown`, reported on the gate's
`Could not determine` line. A guessed default branch or verification
command is worse than none, because later processes act on it.

Four rows go to the human at the gate when `unknown`: `Board`, `Stack`
(no manifest recognisable), `Branching model`, and `Task orchestrator`.
See [gate.md](gate.md#rows-the-gate-asks-about).

`Stack` is what every filed issue is written in terms of, and what a CI
workflow is composed for. A run without it hands the next agent nothing to
compose against.
