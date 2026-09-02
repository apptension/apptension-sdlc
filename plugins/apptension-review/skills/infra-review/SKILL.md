---
name: infra-review
description: Use when the user wants a methodical infrastructure & operations review of the current repository — audits IaC quality, 12-factor compliance, CI/CD presence, secrets handling, and observability. Outputs a markdown risk report and optionally posts it as a GitHub Issue. Trigger on intent like "infra audit", "review infrastructure", "check 12-factor compliance", "audit ops".
---

# Infra review

Perform a methodical infrastructure & operations audit of the
current repository. The skill is read-only — it never modifies a
file in the audited repo and never calls cloud APIs. Output is a
single markdown risk report printed to chat, optionally posted as
a GitHub Issue.

## Prerequisites

- Current working directory is the repository root to be audited.
- `gh` is required only if the user asks for the report to be
  posted as a GitHub Issue. The report itself works without `gh`.

## Output mode

Pick the output mode from the user's request before starting:

- **Issue mode** if the user's request contains intent like "as an
  issue", "create issue", "post to GitHub", "open a ticket". Confirm
  with `gh auth status` before starting work — if `gh` is missing
  or unauthenticated, warn the user and fall back to chat mode.
- **Chat mode** (default) otherwise — print the markdown report
  directly in the conversation.

## Step 1: Inventory & detection

Walk the repo to identify what infrastructure & ops machinery
exists. Record what is present **and what is absent** — absence is
a first-class finding, not a reason to skip a section.

Use `Glob` patterns and `find` over the file tree. Do not crawl
every directory exhaustively; target known patterns:

- **IaC tooling:** `*.tf`, `*.tf.json`, `Pulumi.yaml`, `Pulumi.*.yaml`,
  `cdk.json`, `serverless.yml`, `serverless.*.yml`, `*.bicep`,
  `playbook*.yml`, `ansible.cfg`, `Chart.yaml`, `kustomization.yaml`,
  `terragrunt.hcl`, `main.tf`, raw k8s manifests in `k8s/` /
  `kubernetes/` / `manifests/`.
- **CI/CD:** `.github/workflows/*.yml`, `.gitlab-ci.yml`,
  `Jenkinsfile`, `.circleci/config.yml`, `.travis.yml`,
  `bitbucket-pipelines.yml`, `azure-pipelines.yml`, `.drone.yml`.
- **Containers:** `Dockerfile*`, `docker-compose*.yml`,
  `compose*.yml`, `.dockerignore`.
- **Config / secrets handling:** `.env*` files at any depth,
  `config/`, `settings/`, and grep app/IaC code for references to
  `aws-secrets-manager` / `SecretsManager` / `ssm:` / `vault:` /
  `Doppler` / `Sops`.
- **Observability hints:** import / require statements for
  `@sentry/*`, `sentry-sdk`, `@opentelemetry/*`,
  `pino` / `winston` / `bunyan` / `structlog`, `prom-client`,
  `datadog-` / `dd-trace`, `newrelic`; `/health` / `/healthz` /
  `/livez` / `/readyz` patterns in app routes.
- **Pre-commit / hooks:** `.pre-commit-config.yaml`,
  `.husky/`, `lefthook.yml`, `lefthook.yaml`.

Build an inventory map for later steps. Note version numbers when
visible (e.g. Terraform version pinned in `versions.tf`).

## Step 2: Read project conventions

Read whichever of these exist at the repo root:

- `CLAUDE.md`
- `AGENTS.md`
- `GEMINI.md`
- `README.md` — scan for deployment / ops / infrastructure
  sections only; ignore the rest.

Scope is the target repo. Do not read the user's global
`~/.claude/CLAUDE.md`.

These files weight findings and answer "is this intentional?"
questions; they do not gate the audit.

## Step 3: Read bundled defaults

Read `references/apptension-defaults.md` from this skill's own
directory. It contains severity bumps and additional checks layered
on top of the generic baseline. If the file is absent, fall back to
pure-generic severity assignment with no warning.

## Step 4: Deep-read detected infra files

For every artifact discovered in Step 1, read the file in full —
not just headers or snippets:

- IaC modules: read top-level config plus at least one module
  implementation if modules are used.
- CI workflows: read every workflow file. Inspect job structure,
  secret usage, triggers, deploy steps.
- Dockerfiles: read in full. Check base image, USER directive,
  multi-stage builds, dependency caching.
- `.env*` files committed to the repo: read enough to confirm
  whether real secrets are present versus placeholder values
  (`.env.example`).

If the repo has more than ~50 IaC files, sample: read top-level
configs in full, then one representative module per directory.
Note in the report that the audit was sampled.

## Step 5: Methodical review

Walk each category below. Be thorough — absence is a valid
finding, and "the project clearly doesn't need this" must be
defensible from what you read.

### 5a. Inventory snapshot

Summarise what's in the repo and what's missing. Critical
absences (no IaC on a non-trivial stack, no CI, secrets in repo,
no error monitoring) flagged here and re-surfaced in critical
risks.

### 5b. Infrastructure as Code quality

- Modularity and reuse versus copy-paste sprawl.
- State management: where is state stored? Remote backend? Locking
  enabled? Any sign of state files or `.tfstate` committed to git?
- Provider / module / image version pinning.
- Drift risk signals: `# managed manually` comments, references to
  manual console changes.
- Hardcoded values that should be variables.
- Multi-environment / multi-region setup: actually parametrised,
  or copy-pasted with values swapped between directories?

### 5c. 12-factor compliance

For each of the twelve factors, rate ✅ (compliant) /
⚠️ (partial or unclear) / ❌ (violated) / ⏭️ (genuinely N/A for
this stack — be conservative; explain why).

1. **Codebase** — one tracked repo per app, many deploys.
2. **Dependencies** — explicitly declared and isolated (lockfile,
   vendored, container-locked, etc).
3. **Config** — stored in environment, not in code or committed
   config files.
4. **Backing services** — DBs, queues, caches treated as attached
   resources reachable via config.
5. **Build, release, run** — strictly separated stages, evidence
   in CI / artifact handling.
6. **Processes** — app runs as stateless processes; no local
   filesystem state assumed.
7. **Port binding** — app self-contained, exports HTTP via port,
   no external app server hard-dependency.
8. **Concurrency** — scales out via the process model.
9. **Disposability** — fast startup, graceful shutdown (signal
   handlers visible, drain logic where it matters).
10. **Dev/prod parity** — environments configured similarly; gaps
    documented.
11. **Logs** — treated as event streams (stdout / structured),
    not written to files inside the container.
12. **Admin processes** — one-off admin tasks run in the same
    environment as the app, not via SSH-into-prod hacks.

Render as a scorecard in the final report.

### 5d. CI/CD pipeline

- Pipeline exists at all (absence = critical for a non-toy repo).
- Triggers: push, PR, manual dispatch; branch protection signals
  visible from `required_status_checks` references and "required"
  job names.
- Build / test / lint / typecheck / format steps in pipeline.
- Secret handling: secrets via the provider's secret store, not
  inline; no obvious leaks in workflow logs.
- Security scanning: SAST, dependency audit, container scan,
  secret scan jobs.
- Deployment automation versus documented manual steps.
- Artifact versioning: immutable tags / SHAs versus moving tags
  (`latest`).
- Required reviewers / approvals visible from workflow file
  declarations.

**Dead workflow detection.** For each workflow's `on.push.branches:`
/ `on.pull_request.branches:`, cross-reference the listed branches
against the repo's active branch(es). Sources of active-branch
truth, in order:
- `git symbolic-ref refs/remotes/origin/HEAD` (default branch).
- Branches with recent commits (`git for-each-ref --sort=-committerdate refs/remotes/origin/ --count=5`).
- Branch names referenced in `CLAUDE.md` / `AGENTS.md` / `README.md`.

If a workflow lists *only* branches that match none of the above
(e.g. workflow triggers on `main` / `master` but the repo's active
branch is `release-5.0`), the workflow's auto-trigger path is dead.
Manual `workflow_dispatch` may still work, so the workflow isn't
necessarily safe to delete — but it isn't running on its own
anymore. Severity: warning, with a recommendation to either align
the trigger to an active branch or remove the workflow if its
deployment target is also unused (see also 5e).

**CI efficiency.** A pipeline that exists but burns disproportionate
runner minutes is itself a finding. Check:
- **Path filtering on workflow triggers.** `on.push.paths:` /
  `on.pull_request.paths:` / `dorny/paths-filter` action. Without
  any path scoping, every workflow fires on every change — a
  README typo runs the entire matrix.
- **Monorepo "affected" patterns.** `pnpm nx affected -t ...`,
  `turbo run --filter='[origin/main...HEAD]'`, `lerna run --since`,
  `pants --changed-since`. In a monorepo, the alternative is
  running every package's pipeline on every change.
- **Matrix bloat.** Versions in `strategy.matrix.<axis>:` that are
  EOL, deprecated, or duplicated. Matrices that multiply axes
  (`os × node × python`) without justification.
- **Redundant jobs across pipelines.** If both GitHub Actions and
  Bitbucket Pipelines / GitLab CI / Jenkins exist with overlapping
  lint+test+build steps, the same change runs twice.
- **No caching of the right things.** `actions/setup-node` / `pnpm`
  store cached, but no caching for build outputs, Nx / Turbo cache,
  Docker layer cache, or Python wheel cache.

Severity: warning when waste is significant (rough rule of thumb —
total jobs per push / PR is >2× the number of distinct deployable
packages, or path filtering is absent on a monorepo).

### 5e. Environments & secrets management

- Number of distinct environments visible from IaC / CI config.
- Environment separation: separate cloud accounts / projects /
  namespaces versus a shared one.
- Secrets storage: secret manager / vault references versus
  plaintext in repo, in CI variables only, or in `.env*` files.
- Production resource ownership: heuristic — do provider /
  account / project names in IaC suggest client ownership or
  consultancy ownership?
- Database backups, disaster-recovery signals (snapshot policies,
  cross-region replication, RPO/RTO mentions).

**Active vs scaffolding deployment paths.** Boilerplate forks
frequently inherit multiple deployment targets (e.g. AWS CDK +
Render + VPS docker-compose) where only one is actually used.
Mixed-paths repos cost maintenance, confuse readers, and create
mismatched-config drift. When two or more deployment paths are
detected, score each path's liveness using purely static signals:

1. **Trigger-branch match.** Does the deploy workflow's
   `on.push.branches:` include the repo's active branch (see 5d
   for branch-truth sources)? If a deploy workflow only triggers
   on a branch that isn't active, its auto-deploy path is dead.
2. **Recent commit activity.** `git log --since='90 days' -- <path>`
   over each path's exclusive files (e.g. `render.yaml`,
   `docker-compose.prod.yml`, `packages/infra/`). Paths with no
   recent commits while others have churn are likely inactive.
3. **Documentation references.** Mentions in `CLAUDE.md` /
   `AGENTS.md` / `README.md` / `docs/` that name a specific target
   as the deployment target.
4. **Counter-signals only weakly support liveness.** A recent edit
   to a config file (e.g. a model name update inside `render.yaml`)
   can be template-sync rather than active use — note as
   inconclusive, not as proof of active.

Score-based outcomes:

- **One path clearly active, others scaffolding.** Warning:
  "Multiple deployment paths detected; `<active>` is the active
  target, `<inactive list>` appear to be upstream-boilerplate
  scaffolding." Suggest deleting the inactive paths or quarantining
  them under `scaffolding/`.
- **No path clearly active OR ambiguous.** Warning: "Multiple
  deployment paths detected; active path is unclear from repo
  state alone." Suggest a one-line declaration in `CLAUDE.md` /
  `AGENTS.md` / `docs/agent-context/` naming the active target so
  future readers (humans and AI agents) don't need to re-derive
  this each time.
- **All paths plausibly active.** Note (ℹ️) only; no warning.

This check is also the natural place to surface upstream-
boilerplate contamination — `.env.*.example` files for unused
deploy targets, Dockerfiles only consumed by inactive paths, etc.

### 5f. Observability & operations

- Application error tracking: error-tracker SDK integrated?
  (Sentry / Rollbar / Honeybadger / Bugsnag / equivalent.)
- Logging: structured (JSON) versus plain text? Centralised? Goes
  to stdout (12-factor compliant) or to files inside the
  container?
- Metrics / tracing instrumentation present?
- Health-check endpoints in app code or IaC liveness/readiness
  probes.
- Version visibility in the deployed app: commit SHA exposed via
  response header, footer, `/version` endpoint, or artifact tag.
- Runbooks / operational docs referenced anywhere.

## Step 6: Severity classification

Each finding gets one of four severities. Apptension defaults
from Step 3 **bump** severity upward but cannot downgrade a
generically-critical finding.

- 🔴 **Critical:** secrets committed to repo, no CI at all on a
  shipping project, no IaC in a non-trivial stack, state file in
  git, deployments documented as manual-only, no error monitoring
  on a production-shipping app.
- 🟡 **Warning:** partial 12-factor compliance on important
  factors (config, logs, processes), missing security scans in
  pipeline, no pre-commit hooks, environment parity gaps,
  hardcoded environment-specific values, version-pinning gaps.
- 🟢 **Suggestion:** IaC modularity improvements, additional CI
  steps that would help, observability gaps that aren't critical
  (metrics missing but logs present), tagging / cost-allocation
  hygiene.
- ℹ️ **Note:** informational; positive findings worth
  acknowledging, context for other findings, ideas for next
  iteration.

Every 🔴 finding must carry a defensible *why* in its body.
"Critical: no CI" is not enough; "Critical: no automated CI/CD
pipeline detected; deployments rely on manual steps documented in
README, which is incompatible with the team's deployment-must-be-
scripted requirement and creates high regression risk" is.

## Step 7: Build the report

Render the report in markdown with this exact section ordering:

```markdown
# Infrastructure & Ops Review — <repo name> (<YYYY-MM-DD>)

**Verdict:** 🟢 Looks healthy / 🟡 Some attention needed / 🔴 Critical risks present

## Executive summary

<3–4 sentences: overall posture, biggest risks, what's strong, what's missing>

## Inventory

| Area | Found | Status |
|------|-------|--------|
| IaC tool | <Terraform 1.5 / Pulumi / none> | ✅ / ⚠️ / ❌ |
| CI provider | <GitHub Actions / none> | ... |
| Containers | <Dockerfile + compose / none> | ... |
| Secrets storage | <AWS Secrets Manager / .env in repo / unclear> | ... |
| Error monitoring | <Sentry / none> | ... |
| Pre-commit hooks | <present / none> | ... |

## Critical risks (🔴)

<numbered list. Each item: short title, location (file or area), why it's critical, recommended fix.>

## Warnings (🟡)

<numbered list, same shape.>

## 12-factor scorecard

| # | Factor | Status | Notes |
|---|--------|--------|-------|
| 1 | Codebase | ✅ | ... |
| 2 | Dependencies | ✅ | ... |
| ... | ... | ... | ... |
| 12 | Admin processes | ⏭️ | N/A — no admin tasks shipped |

## Suggestions (🟢) and notes (ℹ️)

<grouped, brief. Positive findings go under notes.>
```

Use `mktemp -t infra-review.XXXXXX.md` for the scratch file when
piping to `gh issue create --body-file`. Clean up afterwards.

## Step 8: Output

**Chat mode (default):** print the markdown report inline, then a
one-paragraph headline summary: verdict + counts by severity +
top 1–3 critical risks.

**Issue mode:** write the markdown to the scratch file from
Step 7, then:

```bash
gh issue create \
  --title "Infrastructure & Ops Review — $(date +%Y-%m-%d)" \
  --body-file "$REPORT_PATH"
```

Capture the resulting issue URL and print it in chat along with
the headline summary. Then remove the scratch file.

If `gh issue create` fails (auth, repo not detected, no write
access), fall back to chat mode — print the markdown report and
warn the user that the issue could not be created.

## Hard rules

- **Pure static read.** Never run `terraform plan`, never call
  cloud APIs, never `kubectl`, never `helm install`. Read files;
  reason; report.
- **Absence is a finding.** A repo with no CI, no IaC, no
  monitoring isn't out of scope — that's the report's main story.
- **Recommend within the existing stack.** If they use Pulumi,
  don't suggest Terraform. If they use GitLab CI, don't suggest
  migrating to GitHub Actions.
- **Don't flag absence of things the project genuinely doesn't
  need.** No DB → don't flag missing migrations. Pure static site
  → don't flag missing health endpoint.
- **Every critical needs a defensible *why*.** Severity must be
  justifiable from what's in the repo.
- **Tool-class, not tool-specific.** "An error-tracking tool
  (e.g. Sentry, Rollbar, Honeybadger)" is fine; "you should use
  Sentry" is not, unless Sentry is already in the repo.
- **Bundled defaults augment, never override.** Rules from
  `references/apptension-defaults.md` can bump severity and add
  checks; they cannot downgrade a generically-critical finding.
- **No editorialising on the team.** Findings describe the
  artifact, not the team's competence.
- **Don't comment on lines you didn't read.** If something is
  too large to read in full and you sampled, say so in the report.
- **No memory or conversation citations in any form.** The
  report body must not mention agent memory, prior conversations,
  notes from other sessions, or any source the reader cannot
  access. This includes negative or meta-references like "memory
  says X, but you wouldn't know" or "the agent recalled Y earlier"
  — those still leak invisible context into the report. Memory
  may inform what to investigate; the resulting finding must be
  expressible from repo state alone, with no trace of the memory
  in the output.
- **Present bundled rules as general standards, not as skill
  internals.** Rules in this skill (its steps, its severity
  definitions, its bundled reference doc) carry their own *why*
  precisely so the report can state them as standards. Phrase
  them as industry / team / common conventions ("industry
  standard is to...", "common practice is to...", "the team's
  stated expectation is...", "by convention..."). Never as
  "per Apptension defaults", "the rubric says", "this skill
  checks for...", "per Step 5e", "as the audit calls out".
  Reader doesn't need the rule's origin, only the rule and
  its *why*.

  - Bad: "Per Apptension defaults, 1–2 review approvals
    expected before merge."
  - Bad: "The 'active deployment target' check from the
    Apptension rubric does not apply here."
  - Good: "Industry standard is 1–2 review approvals on PRs.
    No CODEOWNERS file or required-reviewer signal in workflow
    YAMLs — confirm in Settings → Branches."

- **Don't explain checks that don't apply.** If a category,
  factor, or rule isn't relevant to this repo (multi-path
  deployment declaration when there's no deployment target,
  vendor-lock check on a non-consultancy repo, IaC modularity
  when there's no IaC at all), silently skip it. The absence
  of a finding under a category is already a signal;
  explanatory notes like "this check doesn't apply because X"
  add words without evidence and tend to drag skill-internal
  vocabulary into the report.

## Tooling

The skill uses:

- `Bash` for `find`, `git ls-files`, `gh auth status`,
  `gh issue create`, and `mktemp`.
- `Glob` for file-pattern detection.
- `Read` for all file contents — IaC, CI workflows, Dockerfiles,
  app config, project conventions, and the bundled defaults
  reference.
- `Grep` for spotting library imports / inline references (e.g.
  `@sentry/`, `aws-secrets-manager`, `/healthz`).
- A scratch markdown file under `mktemp -t infra-review.XXXXXX.md`
  for piping to `gh issue create --body-file`.

## Error handling

Stop with a clear message or degrade gracefully, depending on the
case:

- **Empty / non-existent working directory** → stop with a clear
  message.
- **Not a git repo** → continue with a warning. The skill works
  in non-git directories but loses heuristics like
  `git ls-files`.
- **No infra artifacts detected at all** → still produce a
  report. "Inventory: nothing detected" becomes its own finding;
  for a non-trivial repo this is critical. Confirm scope with the
  user before treating it as terminal.
- **Issue mode requested but `gh` unauthenticated / no repo
  context** → fall back to chat mode, print the report, warn the
  user.
- **Very large repo (thousands of IaC files)** → sample as
  described in Step 4; note in the report that the audit was
  sampled.
