# Release age

Read at step 2 for the `release_age` probe, at step 5 when the issue table
holds `release-age`, and at approval item 5 when the operator chose `run`
for it.

A release age is the time since a package version was published. A repo
with a minimum release age resolves no version younger than that, so none
reaches its lockfile. A version already locked stays until the lockfile is
regenerated under the setting. A
version published through a hijacked maintainer account is usually caught
and yanked within hours to a couple of days, so the floor keeps it out
without pinning or vendoring.

## Threshold

| Setting | Value |
|---|---|
| Threshold | 7 days |

A week clears the usual detection window with margin and still takes every
update a week later. This row is the only place the number is written.
Every value below is it, converted to the manager's unit.

## Managers

A **lockfile** is a file this table or the not-applicable list below
names. A **package root** is a directory and one lockfile in it, so a
directory holding both `package-lock.json` and `uv.lock` is two roots.

A **manifest-only root** is a tracked manifest that declares at least one
dependency, has no lockfile of its own manager in its directory, and is
no workspace member. A `package.json` beside only a `uv.lock` still
qualifies, because npm resolves it without that lock.
Every install there resolves afresh, so it needs the guard most. Two
manifests qualify:

- A `package.json` with any of `dependencies`, `devDependencies`,
  `optionalDependencies` or `peerDependencies`. Its manager is the name in
  its `packageManager` field, or npm without one.
- A `pyproject.toml` with `[project] dependencies` or `[dependency-groups]`,
  where uv's own search finds a config: a `[tool.uv]` table in it, or the
  nearest `uv.toml` or `[tool.uv]` table above it, per the facts below. Its
  manager is uv. A `pyproject.toml` that search finds no uv config for may
  belong to pip, Poetry or another tool, so it is not applicable.

A manifest is a **workspace member** when a package root above it lists
its directory in that root's `package.json` `workspaces` field, the
`packages` list of the root's `pnpm-workspace.yaml`, or the `members` list
of the root's `[tool.uv.workspace]` table. A member installs
under that root's lockfile and setting, so the root covers it. A lockfile
in a parent directory alone proves nothing: a nested `package.json` that
no workspace list names installs on its own, and so does a nested
`pyproject.toml`.

| Manager | In use when | Setting | Value | Unit | Floor | Floor declared in |
|---|---|---|---|---|---|---|
| npm | a `package-lock.json` or `npm-shrinkwrap.json` | `min-release-age` in the root's `.npmrc` | `7` | days | 11.17.0 | all three: `package.json` `devEngines.packageManager` set to `{"name": "npm", "version": ">=11.17.0", "onFail": "error"}`, `package.json` `engines.npm` set to `">=11.17.0"`, and `engine-strict=true` in `.npmrc` |
| pnpm | a `pnpm-lock.yaml` | `minimumReleaseAge` in `pnpm-workspace.yaml` | `10080` | minutes | 10.16.0 | `package.json` `devEngines.packageManager`, or `packageManager: "pnpm@<version>"` at or above the floor |
| Yarn Berry | a `yarn.lock` holding a `__metadata:` block | `npmMinimalAgeGate` in `.yarnrc.yml` | `"7d"` | duration | 4.11.0 | `package.json` `packageManager: "yarn@<version>"` at or above the floor |
| Bun | a `bun.lock` or `bun.lockb` | `minimumReleaseAge` under `[install]` in `bunfig.toml` | `604800` | seconds | none | none |
| uv | a `uv.lock` | `exclude-newer` in the nearest uv config, see below | `"7 days"` | duration | 0.9.17 | `required-version = ">=0.9.17"` beside the setting |

Facts the files do not show:

- A manager below its floor ignores the setting without a warning, or
  misreads it: Yarn 4.10 reads `"7d"` as 7 minutes. npm 11.17 is the first
  that also honours the Bypass exclusion.
- npm 10.9 and later refuse to run below a `devEngines` floor. Older npm
  ignores `devEngines`, and refuses to install only under `engines.npm`
  with `engine-strict=true`. So npm declares all three.
- uv before 0.9.17 cannot parse a duration. It warns, drops the whole
  `[tool.uv]` table, `required-version` included, and runs unguarded. The
  lock is the backstop: a current uv records `exclude-newer-span` there,
  so a lock that lacks it shows an old uv rewrote it. CI catches that only
  for a root it runs `uv sync --locked` or `uv lock --check` in, on a
  current uv.
- Yarn Berry with no `npmMinimalAgeGate` uses its default: 0 before 4.15,
  1 day from 4.15. Both are below the threshold.
- uv reads one config: the nearest `uv.toml`, or `pyproject.toml` with a
  `[tool.uv]` table, searching from the root up to the repository root. A
  root with a `[tool.uv]` table of its own takes nothing from a parent
  directory. User-level uv config lives on one machine and never counts.
- Compare a floor as a version number, never as text: 0.10.0 is above
  0.9.17. A range counts at the lowest version it allows.
- Each setting takes its manager's other duration forms (Yarn `"1w"`,
  uv `"1 week"` or `"P7D"`): convert them to days. A uv `exclude-newer`
  holding a date instead of a duration freezes installs at that date. It
  counts as `missing`, because the repo stops taking updates.

Every other manager is not applicable, because the repo cannot set a
release age for it:

- Yarn 1: a `yarn.lock` whose header comment carries `# yarn lockfile v1`.
- Lockfiles of other ecosystems, such as `poetry.lock` and `Pipfile.lock`.
- Bare pip. Its `--uploaded-prior-to` lives in user config or on the
  command line, never in a file the repo tracks.
- Every ecosystem outside the table.

## Check

Read-only. Run it from the repository root.

1. List the tracked lockfiles with `git ls-files`. Each one, with its
   directory, is a package root. Add every manifest-only root.
2. Name each root's manager from the table, or mark the root not
   applicable.
3. For each supported root, read its setting and its floor from the files
   the table names. npm, pnpm, Yarn and Bun read them in the root. uv reads
   the config the facts above name. A file counts only when git tracks it:
   an untracked one lives on one machine.
4. Record one result per root:

   | Result | When |
   |---|---|
   | `present` | The setting, converted to days, is at or above the threshold, and the floor is declared at or above the table's version where the table names a mechanism |
   | `missing` | The setting is absent or below the threshold; the floor is absent, below the table's version, or declared in `devEngines` with an `onFail` other than `error`; or a uv lock lacks `exclude-newer-span`. Record which, and the value found, or `none` |
   | `not applicable` | The manager is outside the table |
   | `unknown` | A file this root's result depends on does not parse. Name it |

5. Roll the roots up into one result for the entry:

   | Roll-up | When |
   |---|---|
   | `missing` | At least one supported root is `missing`. List any `unknown` root beside the missing ones |
   | `unknown` | `git ls-files` failed, or a root is `unknown` and none is `missing`. Name the file |
   | `not applicable` | No root is supported |
   | `present` | At least one root is supported, and every supported root is `present` |

   Take the first row that holds.

Done when the roll-up and the per-root list are with the caller.

## Configure

Run after the gate, when the operator answered `run` at the installer
question.

1. For each `missing` root, compose the setting from the table, and the
   floor where the table names a mechanism, in the file Check read. Where
   Check found no file, use the root's own: add to an existing file, or
   create it. Bun has no floor a repo can declare: say so in the diff, and
   name the Bun version that contributors and CI need to run.
2. For each uv root changed in step 1, run `uv lock` with a uv at or above
   the floor. Resolved package versions should stay as they were. The
   lock's format and option metadata, such as `revision`, `[options]` and
   `default-groups`, may change. Name any resolved version that moved: it
   is a downgrade the setting forced.
   Every lock is a written path, because a CI job that runs
   `uv sync --locked` in that root fails on a stale one. Name each uv root
   no CI job checks that way, and propose a `uv lock --check` step for
   it.
3. Find the CI jobs that install with that root's manager. Where a job's
   runtime is below the floor, compose a bump to the lowest current LTS
   that meets it. An `actions/setup-node` job on a Node version whose
   bundled npm predates 11.17 is the common case: Node 24.19 bundles npm
   11.17. Add `check-latest: true` to that step, because a runner's cached
   Node can lag the latest release.
4. Show every change as one diff, and ask for approval. Write only on
   `yes`, uncommitted, and report each path written for the run's file
   list.
5. Say once that every contributor needs the floor version locally:
   npm's `devEngines` check stops `npm run` as well as `npm install`.

Done when the approved changes are written and their paths reported, or
the operator declined and nothing was written.

## Bypass

A same-day release the repo needs, such as a security fix, goes in as a
per-package exclusion:

| Manager | Exclusion |
|---|---|
| npm | `min-release-age-exclude[]=<package>` in `.npmrc` |
| pnpm | the `minimumReleaseAgeExclude` list in `pnpm-workspace.yaml` |
| Yarn Berry | the `npmPreapprovedPackages` list in `.yarnrc.yml` |
| Bun | the `minimumReleaseAgeExcludes` list under `[install]` in `bunfig.toml` |
| uv | `exclude-newer-package = { <package> = false }` in `[tool.uv]` |

The exclusion lands in the same pull request as the dependency change,
beside a comment linking the advisory or incident behind it. It comes out
once that release is older than the threshold. A reviewer sees all of
it. An override on the command line, such as `--min-release-age=0`,
reaches no reviewer, so it never counts as a bypass.

## Bots

Dependabot's `cooldown: default-days: 7` and Renovate's
`minimumReleaseAge: "7 days"` hold a bot's update pull requests to the same
threshold. Check does not probe them. A filed issue recommends the one that
matches a `.github/dependabot.yml` or Renovate config the repo already has.
