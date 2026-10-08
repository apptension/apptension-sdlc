# Setting up the docs drift check

How a repo wires [`check-docs-drift`](SKILL.md) into CI. The plugin ships
the skill and no workflow; the repo writes the workflow. Any repo can run
it with a model-provider key and no other credential.

## Whether to run it

The `docs-drift-workflow` checklist entry is `optional: true`. The check
runs on a model key the repo's owner pays for on every pull request, and
it only helps a repo that keeps docs describing its behaviour, so running
it is the owner's call. Setup reports a missing check and files no issue.

A repo that already runs a docs check of its own keeps it. The entry
carries `confirm: true` and its regex matches this skill and common
docs-check names, so setup names the workflow it found and asks whether
it checks, on every pull request, that the docs kept up. A yes counts it
as present.

## What the workflow does

1. Triggers on `pull_request` `opened`, `synchronize`, and `reopened`,
   drafts included.
2. Validates the provider variable before any provider job starts: only
   `claude` and `codex` are valid, and an empty or other value fails the
   run. The provider jobs are mutually exclusive.
3. Checks out the pull request's base commit with
   `persist-credentials: false`.
4. Pre-creates the verdict file: line 1 `FAIL`, line 2 a fixed default
   explanation.
5. Fetches the PR context into files: `gh pr view --json
   title,body,number,files` into `meta.json`, and
   `gh pr diff --allow-escape-sequences` into `diff.patch`. Without that
   flag `gh` exits non-zero on any diff carrying a terminal control byte.
   When GitHub refuses the whole diff for size, the per-file endpoint
   supplies the patches, the judged paths first, cut at a line cap, with
   a note at the top saying so.
6. Runs the provider.
7. Enforces the verdict, below.

Add the check to branch protection as a required status check to block
merging on red.

## Bindings

A repo records its own values in `CLAUDE.md` or `AGENTS.md`, or in a
repo-local skill that extends this one. These are the defaults:

| Binding | Default |
|---|---|
| Docs location | `docs/`. A repo may name several |
| Provider variable | `DOCS_DRIFT_PROVIDER`, a repository Actions variable |
| Secrets | `ANTHROPIC_API_KEY` on the Claude job only; `OPENAI_API_KEY` on the Codex job only |
| `claude-code-action` marketplace | `https://github.com/apptension/apptension-sdlc.git`, the public marketplace. No token |
| `claude-code-action` plugin ref | `apptension-sdlc@apptension-sdlc` |
| Prompt | `/apptension-sdlc:check-docs-drift`, or the repo-local skill that extends it, naming the verdict file and context directory |
| Verdict file | `.docs-drift-verdict` in the workspace root |
| PR context directory | `.docs-drift-context/` |
| Workflow file | `.github/workflows/docs-drift.yml` |
| `--allowedTools` | `Read,Grep,Glob,Edit(<verdict file>)`, plus `Skill(apptension-sdlc:check-docs-drift)` when a repo-local skill invokes this one |
| Codex prompt | A repo file loaded from the base commit that states the three judgements and the verdict format |

The public marketplace holds what the last `v*` release of
`apptension-sdlc` published. A repo that serves the skill from a
marketplace of its own records that URL and plugin ref instead; a private
one needs a URL carrying a token that can read it.

## Why the scope is this narrow

- **Base checkout.** `claude-code-action` loads project settings and
  skills from the checkout. Checking out the PR would let it supply the
  `.claude/` config and any repo-local skill that judges it. The PR's
  changes reach the model only through `diff.patch`.
- **No `Bash`.** `gh --jq` is gojq, whose `env` / `$ENV` builtins read the
  whole process environment, the model key included, and a prefix rule
  like `Bash(gh pr view:*)` cannot exclude a flag. So the workflow fetches
  the PR context, and the model gets no shell.
- **`Edit(<verdict file>)`, never `Write`.** Claude Code rejects a
  `Write(<path>)` allow-rule at startup, and a bare `Write` cannot be
  path-scoped. `Edit(<path>)` covers every file-modifying tool and only
  that path.
- **`Skill(apptension-sdlc:check-docs-drift)`.** A headless run denies any
  tool `--allowedTools` does not list, so a repo-local skill cannot load
  this one without it. This skill declares no `allowed-tools`, so the
  rule grants nothing else.
- **Marketplace from its default branch.** A PR cannot supply the skill
  that judges it.

## Extending the check

A repo that wants its own criteria writes a repo-local skill that invokes
`check-docs-drift` and states its bindings and criteria. Its workflow
invokes that skill and allows `Skill(apptension-sdlc:check-docs-drift)`.
The base checkout keeps the repo-local skill out of the PR's reach too.

## Enforcing the verdict

The enforce step runs even when the provider step fails, and reads the
verdict file:

- No file → fail.
- Line 1's first four non-whitespace characters, case-insensitive, are
  the verdict. `PASS` passes and `FAIL` fails; anything else, an empty
  file included, fails.
- The explanation is everything after line 1, or line 1 itself when
  nothing follows. It goes to the step summary and the job log as
  untrusted text, fenced and with workflow commands stopped.
- A `FAIL` whose explanation is still the pre-created default is **no
  verdict**: an infrastructure failure, reported as one, never a docs
  gap. A fork PR, which gets no secrets, and a missing or rotated key both
  land here.

**Self-edit exception.** The Claude action refuses to run on a PR that
edits its own workflow file, so that PR always ends with no verdict.
When the PR's changed files include the workflow file, the enforce step
warns that the docs were not judged and exits 0. A failed lookup of the
changed files counts as "not included". The exception covers no verdict
only; a judged `FAIL` always fails. A PR that edits the workflow
alongside a real undocumented change passes unjudged, and a human
reviewer is the backstop. The Codex path runs on such a PR and gets a
real verdict.

## Testing a change to the check

A PR cannot exercise its own change to the check. The skill loads from
the marketplace's default branch, and a repo-local skill from the base
commit, so a change to either first runs on the next PR after it lands
there. A PR that edits the workflow file hits the self-edit exception on
the Claude path.
