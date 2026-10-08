# Gaps with an installer

Read at step 5 when the issue table holds `automated-review-workflow`,
`issue-template`, `release-age` or `verification-maintenance-workflow`, or
the entries `intake-workflow` or `docs-drift-workflow`.

Four gaps have an installer: three installer skills, and the Configure
procedure in [release-age.md](release-age.md#configure). Three get a
run-or-file question before the approve prompt, beside the candidate
questions. `run` removes the row
from the issue table, queues the installer for after the gate, and names
the removal on the gate's `Installing instead:` line, so no row silently
vanishes. Each installer's own gate governs every file and variable it
touches, and it reports the paths it wrote.

| Gap | Question | Asked on | Enter accepts |
|---|---|---|---|
| `automated-review-workflow` | Run or file | Team runs only | `file` |
| `issue-template` | Run or file | Team and `solo` | `run` |
| `release-age` | Run or file | Team and `solo` | `file` |
| `verification-maintenance-workflow` | None of its own: proposed on the gate's `Installing instead:` line | Team runs only | The gate's answer |

## automated-review-workflow

`code-review-setup` installs the review workflow from a bundled template,
substituting only per-repo keys.

```
Automated review: this gap has an installer. Run code-review-setup in
this session instead of filing the issue? Its own approval shows every
file before anything is written. (run / file, enter accepts file)
```

`file`, or no answer, keeps the row. The filed issue's `Concretely, for
this repo` describes the review workflow to add for this repo's stack and
host, naming no skill.

Both paths need the repository variable `AUTOMATED_REVIEWER`, set to
exactly one of `claude` or `codex`. A missing or unsupported selector, or a
second active review workflow, is a configuration failure fixed with the
review setup. It is never a reason to run both providers or skip review.
Guest runs never see the question: `guest_filable: false` holds the entry
back, and the installer commits the owner to a model credential exactly as
filing would.

## issue-template

`install-task-template` writes `.github/ISSUE_TEMPLATE/task.yml` from a
bundled template, filling the Area dropdown from labels the repo already
has. One form file needs no credential and grants no agent write scope, so
a guest run offers it as readily as a team run.

```
Task template: this gap has an installer. Run install-task-template in
this session instead of filing the issue? Its own approval shows the
file before anything is written. (run / file, enter accepts run)
```

`file` keeps the row, and the filed issue's `Concretely, for this repo`
describes the form to add, its path and its fields, naming no skill.
Either answer leaves `area-labels` as its own row: a repo with no area
taxonomy gets a template with no dropdown.

## release-age

Configure in [release-age.md](release-age.md#configure) writes the setting
and the package-manager version floor into each failing package root.

```
Release age: setup can apply this fix itself. Write the setting and the
package-manager version floor into this repo now instead of filing the
issue? You see every change before anything is written. Until a teammate
or a CI job upgrades to the floor version, their installs fail.
(run / file, enter accepts file)
```

`file`, or no answer, keeps the row. The default is `file` because the
floor can fail a CI job or a teammate's install, which the repo's owners
schedule. Both answers are offered on `solo`: the fix needs no credential
and grants no agent write scope.

## verification-maintenance-workflow

On a team run, propose `setup-verification-maintenance` under `Installing
instead:` at the gate. Show the target, the weekly schedule proposal, the
agent provider and credential, the project bootstrap and the exact files
before approval. Reuse an existing supported provider choice; otherwise
the operator chooses. The installer compares rendered files and config and
leaves a matching install untouched.

A declined install keeps an actionable setup issue naming that skill. A
guest run reports this paid-credential, write-permission gap and neither
installs nor files it. The install may precede the project skill's
creation; scheduled runs then report the missing target and open no PR.

## Provider selectors for intake and docs drift

- `intake-workflow` requires `ISSUE_INTAKE_PROVIDER` set to `claude` or
  `codex`, plus the matching secret (`ANTHROPIC_API_KEY` or
  `OPENAI_API_KEY`).
- A `docs-drift-workflow` built on `check-docs-drift` requires the
  provider variable the bindings name, or that skill's default, the same
  way. A repo's own docs check, confirmed as a candidate, carries its own
  wiring and needs neither.

A missing or unsupported selector is a configuration failure, never a
reason to skip the check or fall back. With `claude` selected, permissions
and headless behaviour are the defaults. The variables, secrets and
provider wiring live in the `issue-intake` and `check-docs-drift` skills.
