# Apptension defaults for `infra-review`

Severity bumps and additional checks layered on top of the
generic baseline `infra-review` audit. Each rule is self-
contained — its rationale is in the rule itself, no external
document needed to interpret it.

## How this file is used by the skill

- The skill reads this file in Step 3 of the workflow.
- Rules here can **bump severity upward** (warning → critical)
  and **add organisation-specific checks** that aren't in the
  generic baseline.
- Rules here **never downgrade** a generically-critical finding.
- If you fork the plugin for another organisation, swap this
  file. `SKILL.md` itself stays generic.

## Severity bumps

For each generic finding listed below, raise the severity to the
indicated level and use the *why* directly in the report body so
the reader understands the reasoning without consulting any other
document.

### Critical bumps

**No CI/CD pipeline detected.** Automated pipelines are a hard
expectation for every shipped project. Deploys may be triggered
manually, but the deploy itself must be scripted. A repo without
any pipeline cannot meet that expectation.

**Secrets or private keys committed to the repo.** Sensitive
material (API keys, database passwords, signing keys, OAuth
secrets) must live in a secret store — AWS Secrets Manager, SSM
Parameter Store, HashiCorp Vault, or equivalent — not in git
history. Anything in the repo is permanently exposed to anyone
who ever clones it, including former contributors.

**No error monitoring detected on a production-shipping app.**
Every environment is expected to have a Sentry-class error
tracker (Sentry, Rollbar, Honeybadger, Bugsnag, equivalent) so
production failures surface quickly with stack traces and
context. Shipping without one means failures hide until users
complain.

**Single environment beyond local.** Projects ship with at least
two non-local environments — typically production plus staging
or QA — separated from each other and configured close to
production. Promoting code directly from local to production
skips the integration step where most environment-specific bugs
appear.

**Manual deployment process documented.** Same rationale as no-CI:
deploys may be *triggered* manually, but the deployment itself
must be scripted. A documented "ssh into the box and run X"
process is incompatible with the deployment-must-be-scripted
requirement and creates a class of incident that automation
prevents.

### Warning bumps

**No pre-commit hooks.** Pre-commit hooks (via `pre-commit`,
`husky`, `lefthook`, etc) are the standard way to catch
formatting / linting / typecheck issues before they reach the
pipeline, shortening the feedback loop and saving CI cycles.
Their absence isn't immediately dangerous, but it's a missed
quality gate.

**Consultancy-owned account or resource referenced in client
repo.** The client should own all production resources — cloud
accounts, DNS zones, monitoring projects, secret stores — so the
project is portable when the engagement ends. Vendor-lock to the
consultancy is an anti-pattern; offboarding becomes a migration
project instead of a credential handover.

## Additional Apptension-specific checks

Not bumps of existing findings, but checks the generic baseline
doesn't cover. Run these in Step 5; report findings under the
relevant category.

**Code-style validation in CI.** Lint, format, and typecheck
checks should run on every push or PR, not only via local
pre-commit hooks. Local hooks are bypassable (`--no-verify`); CI
is not. Report a warning if linting / formatting / type-checking
are absent from the pipeline despite being configured locally
(or vice versa).

**Branch protection signals indicating required reviewers.**
Workflow files often declare jobs as `required` via repo settings
referenced in workflow names or `if:` guards. Look for evidence
that 1–2 review approvals are required before merge. The
expectation is that pull requests need human review, all
automatic checks pass, and there are no outstanding change
requests before merge. Missing review enforcement is a warning.

**Deployed-version visibility.** A deployed application should
expose its commit SHA or immutable artifact tag somewhere
observable — a response header (`X-App-Version`), a footer in
the UI, a `/version` endpoint, or a release artifact named after
the SHA. Without this, "what version is running?" becomes a
manual investigation. Report a warning when no visibility
mechanism is detectable from the code or IaC.

**Boilerplate-fork active-path declaration.** Apptension does a
lot of work on top of forked boilerplates that ship with multiple
deployment paths out of the box (AWS / Render / VPS, etc).
Forks rarely use all of them, but the unused paths stay in the
repo and confuse both humans and AI agents about which target to
maintain. When a fork is detected (multiple deployment paths
present, see SKILL.md Step 5e) and no `CLAUDE.md` / `AGENTS.md` /
`docs/agent-context/` line names the active deployment target,
report a warning recommending one of:
- Add a single declarative line — e.g. *"Active deployment target:
  AWS CDK (deploy-prod.yml / deploy-qa.yml). Other deploy configs
  in the repo are upstream-boilerplate scaffolding, not used."*
- Or quarantine the unused paths under `scaffolding/` so the live
  one is unambiguous from the tree alone.

## Out of scope for static read

Listed so future maintainers don't waste effort trying to bolt
these on:

- **Shared-account detection.** Whether team members share login
  credentials cannot be inferred from a repo. Belongs in a
  manual security review.
- **Quota / load-test signals.** Runtime artifacts (cloud quotas,
  load-test results, traffic forecasts) live outside the repo.
  Belongs in a pre-launch operational checklist, not an audit
  of repo state.
- **Live infra drift.** Comparing IaC state to actual cloud
  resources requires API access, which violates the skill's
  pure-static-read rule.
