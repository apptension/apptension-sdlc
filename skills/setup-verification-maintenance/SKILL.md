---
name: setup-verification-maintenance
description: Use when installing or updating scheduled maintenance for a project-owned verification skill, including when setup offers maintenance after finding or creating that skill.
requires:
  - id: verification-maintenance-workflow
    label: Scheduled verification skill maintenance
    area: ci
    optional: true
    confirm: true
    detect:
      path: .github/workflows/verification-maintenance.yml
    intent: >-
      A scheduled agent checks the project-owned verification instructions
      against source and the live application, while a separate trusted job
      publishes only corrections with complete proof.
    grants:
      - Read access to repository contents and pull requests in analysis;
        contents, pull-request, status and Actions read access in preflight.
      - Contents, pull-request and status write access plus Actions read access
        in the trusted publisher; pull-request write access plus contents,
        status and Actions read access in the separate recovery job.
      - The selected model-provider credential in the analysis job only.
---

# Set up verification skill maintenance

Install one GitHub Actions workflow for the project-owned verification skill.
Preflight routes retained corrections to trusted recovery before application
bootstrap or agent analysis. Analysis may correct that skill and its owned
helpers with read-only GitHub permissions. A separate publisher validates the
correction and may open one draft pull request.

## 1. Locate the installer

Authenticated publication and recovery support GitHub.com only. For GitHub
Enterprise Server, report the unsupported host and preserve the existing install.
Enterprise support needs a trusted server origin and Actions bot identity;
`GITHUB_SERVER_URL` alone cannot establish receipt ownership.

Resolve this skill's directory. The runtime is
`tools/verification-maintenance/cli.py` inside it, and its `templates/`
directory holds the workflow and prompt. In a full plugin install the sibling
skill sits at `../maintain-verification-skill/`.

An isolated copy supplied by Cezar carries the runtime and templates and may
omit the sibling skill. Pass an explicit `--maintenance-skill` path from an
installed `maintain-verification-skill` directory when the sibling is absent.
An existing target installation can provide the runtime at
`.github/verification-maintenance/cli.py`. If neither runtime exists, stop
with this recovery instruction: install or reinstall the
full `apptension-sdlc` plugin in the active client, then invoke this skill from
that installed plugin. A partial workflow assembled from prose is not a valid
installation.

Finish this step with readable paths for the CLI, templates, maintenance
`SKILL.md`, and its `LICENSE`.

## 2. Resolve the fixed configuration

Support GitHub Actions first. For another CI provider, report that scheduled
verification maintenance is unsupported and stop without creating a GitHub
workflow.

Resolve these values from the repository and the operator:

| Field | Rule |
|---|---|
| `target` | Use the selected project verification `SKILL.md`. Discovery inspects standard client skill roots, but an explicit binding may name another repository-local directory. A missing target is allowed so creation can land later; an invalid or ambiguous selection blocks installation. |
| `integration_branch` | Read the integration branch from the repository's Dev flow bindings. Ask when the binding does not settle it. |
| `repository` | Read the canonical `owner/name` with authenticated `gh`. |
| `provider` | Preserve a valid installed choice on a re-run. For a new install, reuse a concrete `claude` or `codex` value from the `Automated reviewer` binding when it suits this job. Ask when neither source settles which paid provider to use. |
| `schedule` | Propose `17 4 * * 1`, a weekly Monday run in UTC. Preserve an installed schedule on a re-run. |
| `bootstrap` | Record the project-owned shell commands that prepare dependencies and the verification runtime. Use repository commands, including required environment setup. An empty list is valid when the runner image already supplies everything. |
| `app_secrets` | Optional mapping from application environment variable names to GitHub Actions secret names. Include credentials needed to drive authenticated or external paths. Store names only, never values. |
| `model` | Optional provider model identifier. Preserve an installed value. Empty selects the provider action's default. |

The schedule runs only after the workflow reaches the repository's default
branch. When the integration branch differs from the default branch, name the
delivery step needed to put this workflow on the default branch while it still
checks out and publishes against the configured integration branch.

For an upgrade, use the current full plugin and replace the installed workflow
and runtime together through the approval below. The old `publish` CLI command
is removed; `prepare-publication` consumes trusted artifact IDs, not `--bundle`.
When default and integration branches differ, coordinate the workflow update
on the default branch with the matching runtime/configuration on the integration
branch. Update the workflow there too if it supports manual dispatch. Finish
delivery before starting a new run; an old analyzed checkout still has old tools.

Store the resolved object in a temporary JSON file. Never place credential
values in it. Finish this step when every field is settled and the configured
target has one canonical repository-relative path.

## 3. Render and review

Run the installer without `--write`, passing the repository root, temporary
config, this skill's templates, and the maintenance skill path when the default
sibling is unavailable. The preview returns every changed path, its full
rendered content, a unified diff for existing files, and any conflicts. Read
the complete preview.

Present one reviewable approval with:

- Every changed path and rendered content or diff.
- The fixed target, integration branch, weekly cadence, bootstrap commands,
  provider, optional model, and application environment-to-secret mapping.
- Analysis permissions `contents: read` and `pull-requests: read`.
- Preflight read permissions for contents, pull requests, statuses and Actions.
- Publisher permissions `contents: write`, `pull-requests: write`,
  `statuses: write` and `actions: read`.
- Recovery permissions `pull-requests: write`, with contents, statuses and
  Actions read access only. Only the publisher can write receipt statuses.
- The receipt trust boundary, requested 30-day artifact retention, and recovery
  and rerun limits described below. Include coordinated branch delivery for an
  upgrade; existing retained branches without receipts remain manual cases.
- The required secret name: `ANTHROPIC_API_KEY` for Claude or
  `OPENAI_API_KEY` for Codex. The secret value stays outside the session.
- Each application secret name needed by `app_secrets`. Its value also stays
  outside the session and reaches only bootstrap and the selected agent step.
- The conflict list and whether each differing installed file would be
  replaced.

Setup's adoption gate may already approve this exact rendered installation.
Reuse that approval. Otherwise wait for approval before `--write`. Replacement
requires explicit approval of the displayed conflicts; approval of a fresh
install does not authorize replacing a later divergent file.

## 4. Install and verify

Run the same command with `--write`. Add `--replace` only for the conflicts the
operator approved. The installer validates every destination before its first
write and refuses the whole install on an unapproved conflict or symlink.

The installation contains:

| Target | Purpose |
|---|---|
| `.github/workflows/verification-maintenance.yml` | Scheduled and manual workflow |
| `.github/verification-maintenance/config.json` | Fixed trusted configuration |
| `.github/verification-maintenance/*.py` | Standard-library runtime copied from this skill's `tools/verification-maintenance/` |
| `.github/verification-maintenance/prompt.md` | Prompt template rendered by the trusted runtime |
| `.github/verification-maintenance/instructions/maintain-verification-skill/` | Maintenance contract and upstream license |

Run the preview once more with the same inputs. Completion requires an empty
`changed` list. Parse the workflow as YAML, confirm the selected provider's
secret exists by name, and run the installed CLI's `discover --root` command.
A missing configured target is an accepted waiting state: scheduled runs write
a blocked report and spend no provider call until creation lands. Any other
discovery result must agree with the configured target.

Report installed paths, schedule, provider, permissions, discovery status,
provider secret name, and application secret names. Leave the files uncommitted
for the repository's normal development flow.

## Recovery and rerun limits

Explain these operating rules with the rendered installation approval:

- Preflight leaves an open maintenance PR intact and suppresses analysis. An
  unmerged retained branch also suppresses analysis and enters independent
  recovery inspection. Unavailable or malformed API state blocks the run.
- The publisher retains a receipt before attaching its correction commit,
  reads back the exact bytes, and authenticates their SHA-256 digest with a
  target-specific commit status from the expected GitHub Actions bot. The
  status links the original run and immutable receipt artifact. It authenticates
  publication ownership, not a passing verification check; keep this status out
  of required merge checks. A receipt artifact alone is not authorization.
- Repository writers and other trusted write-enabled workflows remain trusted.
  The read-only analysis agent cannot authenticate its own receipt. Publisher
  and recovery tools run from trusted integration/base checkouts and consume
  retained files as data, without executing them.
- Bundle, evidence and receipt uploads request 30-day retention. Recovery checks
  their immutable IDs, original workflow/run/attempt, exact bundle bytes and
  referenced evidence hashes. Missing or expired artifacts prevent recovery,
  even when the branch and status survive. A failed or cancelled original run
  is eligible; only the installed workflow's scheduled runs or manual dispatches
  from the default or configured integration branch qualify.
- Recovery requires the original base to remain current, the exact correction
  commit with that base as its sole parent, and the full validated tree. It
  opens a draft PR with the original run/evidence link. Recovery never creates,
  advances, resets, deletes or overwrites the retained branch.
- If publication stops before branch attachment, the next run performs fresh
  analysis. Recovery starts from an existing branch tip; it does not discover
  unattached commits or create a missing branch from pending receipts.
- Stale bases, human-changed tips, replacement commits with identical trees,
  closed unmerged corrections, conflicting or uncertain ownership, and legacy
  branches without authenticated receipts require manual inspection. Read the
  Actions summary for the branch, known tips, original evidence link when
  authenticated, and failed proof. Inspect the diff and evidence, then publish
  the inspected correction manually or preserve wanted work before manually
  removing the obstruction and running fresh verification. For service or
  permission failures, restore access and retry recovery with the branch intact.
- Partial-job reruns that mix earlier analysis artifacts with a newer run
  attempt are refused. Before branch attachment, rerun analysis as well. After
  attachment, start a fresh scheduled or manual run for recovery rather than
  rerunning only the publisher. Preserve the publisher checkout across receipt
  preparation, upload and finalization; its private Git-directory witness is
  required for finalization, but not for later recovery.
- Workflow concurrency serializes participating runs, not human pushes. GitHub
  creates PRs by branch name without an expected-head-SHA condition. The runtime
  checks branch, base and PR state before and after creation, reconciles ambiguous
  responses without an immediate second POST, and reports races with any known
  PR URL for inspection. It leaves the branch and PR alone. An existing PR
  suppresses duplicates; it does not prove a human-changed head is still verified.
