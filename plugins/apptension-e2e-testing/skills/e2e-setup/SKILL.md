---
name: e2e-setup
description: Detect a repo's package manager, language, and workspace layout, then install @playwright/test if it's missing — honoring the repo's own conventions instead of imposing defaults. Takes an optional [target path] and defaults to the current repo. Trigger on intent like "set up e2e testing", "install playwright", or "run e2e-setup".
argument-hint: "[target path]"
---

# Setup Playwright

Sets up a **self-contained Playwright e2e package under the chosen suite
location** (default `e2e/web/`): its own `package.json` + scripts,
`playwright.config.ts`, saved auth state, and test dirs all live there. A
`### E2E bindings` section in the repo's bindings file (`CLAUDE.md`, or
`AGENTS.md` when the repo keeps one and has no `CLAUDE.md`) records the
location and every other answer this skill asks, so a re-run reads them back
instead of asking again. Detect the repo's conventions, propose defaults,
scaffold the structure and config, then install Playwright and its browsers
**inside the suite location**. Never run a discovered bootstrap script
(`postinstall`/`bootstrap`/`setup`) — that is always a human's call.

This plugin bundles its own Playwright MCP server (`mcp.json`, run as
`npx @playwright/mcp@latest --headless --isolated`) so the `generate` skill
can verify selectors live with no separate setup. The version is `@latest`
on purpose: the plugin is not re-released each time `@playwright/mcp`
publishes, and at `0.0.x` npm's `^`/`~` ranges collapse to an exact pin
anyway. Step 2 detects a server you already run and, on Claude Code, offers
to disable the bundled one so only yours remains.

Paths below are relative to this skill's own directory.

## Steps

A run that kept the stub at step 7 named the keys to fill, so the run after it
may have only the login left to do. Check for that first. Read the `Location`
row of the bindings file's `### E2E bindings` section, or take `e2e/web` when
there is no section, then run:

```bash
node scripts/write-auth-setup.mjs <target path> --check --location <location>
```

It writes nothing, and it prints key names, never a value. Read `status`:

- `ready`: `auth.setup.ts` is still the stub, `@playwright/test` resolves from
  the suite, and the suite's `.env` sets `E2E_BASE_URL`, `E2E_USER_EMAIL` and
  `E2E_USER_PASSWORD`. Tell the human in one line that this run finishes the
  login and nothing else. `@playwright/test` resolving says nothing about the
  browser binaries, which live in a per-machine cache, so install any the
  config needs and this machine lacks:

  ```bash
  node scripts/install-browsers.mjs <target path> --location <location>
  ```

  Playwright's installer skips every browser already present, so on the
  machine that ran the first setup it downloads nothing. Then go straight to
  step 7 with that location. Detection, the approval gate, the MCP check, the
  device wizard and the package install all finished on the run that wrote
  the stub.
- `no-stub`, `not-installed` or `needs-keys`: start at step 1.

1. Run the detector against the target path (default: the current repo):

   ```bash
   node scripts/detect.mjs [target path]
   ```

   Read the JSON report it prints. It never modifies the target repo. Note the
   **package manager** (`npm`/`pnpm`/`yarn`/`bun`) — you use it in step 4 — and
   any Playwright already installed.

   If `existingE2eFramework` is non-null (`cypress` or `selenium`), the repo
   already runs another E2E framework. Surface it to the human **before**
   installing Playwright: name the framework found and that this will add
   Playwright alongside it, not replace it — migrating the existing suite is
   out of scope. Continue on their go-ahead.

2. **Propose defaults, then get one human approval before any write.** This
   is the ask-once step: everything it settles is persisted, so a re-run
   never re-asks the same question unless the human wants to change an
   answer.

   **Propose defaults from discovery.**

   - **Suite location.** Offer this as an editable question, the same
     as convention and auth below — never as a read-only summary line,
     and never with a single option. `AskUserQuestion` takes two to four
     listed options: a one-option question it rejects, and the rejection
     reads as license to state the one path and move on, which defaults
     the location silently — the one thing this gate must not do; more
     than four it rejects too. Every listed option is a concrete path,
     because the widget returns the chosen option's label and that label
     passes straight to `setup.mjs --location` — a non-path label like "a
     different location" would set the suite location to that literal
     text. The human types a path discovery never listed through the
     widget's built-in "Other" row, the same type-your-own escape the
     device tabs use (it returns the typed path, and never counts toward
     the two-to-four floor). Build the listed options this way, in order
     until four are filled: option one is the recommended path — the
     suite dir step 1's detector or an existing `playwright.config`
     reveals, else `e2e/web`; then, on a monorepo, one candidate per
     detected workspace app directory (its `<app-dir>/e2e`), up to three
     of them — but only for web, non-mobile packages, preferring the ones
     the detector flags `web`. Skip a package the detector flags `mobile`:
     `web-server.mjs` vetoes a mobile (Expo/React Native) package because
     it serves no browser, so a suite anchored there could never boot the
     app under test. Deduplicate the list as you build it — a detected app-dir
     candidate that equals the recommended path is dropped, not listed
     twice. When fewer than two distinct paths remain — a single-suite
     repo, or one whose lone app dir is the recommended path — add the
     first conventional suite path not already listed as the second
     option: `e2e/web`, else `e2e/`, else `tests/e2e/`. This is what keeps
     the two options distinct even when the recommended path is itself
     `e2e/web` or `e2e/`. A
     monorepo with more app dirs than fit is not truncated silently: the
     unlisted ones are still reachable through "Other," so a repo whose
     suite belongs somewhere unlisted is set here rather than in a
     follow-up run. Every path that leaves this gate — a listed option or
     an "Other" value — must be **repo-relative and inside the target**:
     `setup.mjs` runs it through `assertSafeLocation`, which hard-fails an
     absolute path or one that escapes the repo root. A typed path that is
     absolute or escaping is re-asked here, not passed on. A rejection for
     too few or too many options means the question was built wrong: fix
     the listed-option count and re-ask; never accept the recommended path
     as a default. The approved path passes to `setup.mjs --location`
     (step 6) and writes the `Location` row of the `### E2E bindings`
     section at the upsert below, so a
     re-run reads it back as an editable answer.
   - **Test convention.** The option pair is "Page Object Model (POM) —
     shared `selectors`/`page`/`assertion` files" vs "self-contained
     specs," recommending Page Object Model. Expand every abbreviation on
     first use: the first mention of Page Objects in the summary reads
     "Page Object Model (POM)," never the bare acronym. The approved value
     writes the `Convention` row of the `### E2E bindings` section at the
     upsert below — `pom` for Page Objects, `flat` for self-contained
     specs — so `generate` and `discover` read it and never re-ask.
   - **Auth scheme.** Ask how the test user logs in. The option pair is
     "Email and password" vs "OAuth or SSO," recommending email and
     password, and the approved value writes the `Auth scheme` row as
     `email-password` or `oauth`. Setup scaffolds the email and password
     login either way. Never offer HTTP basic auth here: it is a layer in
     front of the app, not a way to log in, and the config turns it on
     from `E2E_BASIC_AUTH_USER` whatever this answer is. A re-run whose
     `Auth scheme` row reads `basic` pre-fills `email-password`.
   - **Linter.** Step 1's detector reads the repo root and reports
     `report.linter` — `eslint` (a flat/legacy config or the `eslint` dep),
     `biome` (`biome.json`/`biome.jsonc` or `@biomejs/biome`), or `none`
     when it recognises neither. Propose it as the default. It decides the
     suite's lint setup: `eslint` and `none` get the flat
     `eslint.config.mjs` + `eslint-plugin-playwright` stack (today's
     behaviour — a repo with no recognised linter has no convention to
     violate); `biome` gets **no** ESLint config, script, or dependencies,
     so setup follows the repo's linter instead of imposing ESLint. A
     `biome` repo whose `@biomejs/biome` reaches 2.4.2 gets Biome's
     Playwright rules instead. `report.biome` carries that version, the
     one installed at the root, else the declared range. Below 2.4.2, or with no version,
     the suite gets no lint config and a `scaffold.notes` line says why.
     Detection is root-only and recognises only ESLint and Biome, so a
     monorepo whose linter lives in a workspace, or a repo on oxlint /
     Standard / Deno lint, reads as `none` — **the human corrects the
     detected value here** when it is wrong, since it is only the proposed
     default.
   - **TypeScript version.** Step 1's detector reads the repo root's
     `package.json` and reports `report.typescript` — the declared
     `typescript` dependency/devDependency range, or `null` when the repo
     declares none. Propose it as the version to pin in the sub-package, so
     specs typecheck against the same TypeScript the app uses instead of
     whatever an unpinned install happens to resolve. With `null` (no
     TypeScript declared at the root — e.g. a plain-JS repo), propose no
     pin: the human confirms an unpinned install or names a version.

   **Show the summary and gate before any write.** Always present a
   summary of these discovered-or-defaulted values for approval or
   correction — not only when a value is missing. A value discovery
   cannot fill (e.g. no env clue for the auth scheme, no monorepo pattern
   to propose) is asked outright, with no silent default.

   - The suite-location question shows the **resolved absolute
     destination** for its preselected path: "Suite location: `e2e/web`
     → will be created at `<abs path>/e2e/web`." When the human types a
     different path, resolve and show its absolute destination the same
     way before the write.
   - Run `git rev-parse --show-toplevel` against the target path. If the
     target is not the git repo root, add this note to the summary:
     "target path `<target>` is a subdirectory of the git repo root
     `<root>`; the suite and the `### E2E bindings` section will be
     anchored here, not at the repo root — confirm or re-run with the
     repo root as the target."

   **Re-run behaviour.** Resolve the bindings file with
   `resolveBindingsFile(repoRoot)` from `scripts/bindings.mjs`
   (`CLAUDE.md`, or `AGENTS.md` when the repo keeps one and has no
   `CLAUDE.md`). When that file already carries a `### E2E bindings`
   section, read its rows and pre-fill them into the summary instead of
   proposing fresh defaults. Let the human **edit** each value, not only
   confirm the set. When a newer plugin version introduced a binding the
   section lacks, surface it and prompt for it additively — never drop a
   row the newer version still uses. A repo-root `.e2e-scaffold.json`
   found on this path — a section already exists, so full migration does
   not fire — may still hold rows the section is missing (a section an
   older version wrote, or a partial one). Fold those missing rows into the
   summary first, the same additive merge, and delete the manifest (`rm`)
   only after the approved upsert has written the section — the same
   after-the-gate deletion the migration path uses, never on sight.
   Deleting it in this step, before the gate, would lose those rows if the
   run is declined or interrupted before the section is written.

   **Migration (first run only).** When a repo-root `.e2e-scaffold.json`
   exists and the bindings file has no `### E2E bindings` section yet,
   read the manifest and render the section from it with
   `manifestToBindingsSection` (`scripts/bindings.mjs`), then fold its
   rows into the pre-filled summary in place of a fresh proposal — the
   human still edits and approves as in any other re-run.

   **Write after the gate.** The section is composed here but written to
   the bindings file only after the human approves the summary, mirroring
   `apptension-sdlc:setup`'s write-after-gate — step 6 is what releases it
   to disk, alongside the scaffold. Step 6 renders the section with
   `scripts/bindings.mjs` from the approved answers and writes that
   output under the same target-file rule as `apptension-sdlc:setup`'s
   `### Dev flow bindings` section: a heading probe finds the section,
   and the rendered output takes its place. The pre-filled summary
   already carries every existing row's value, so the rendered rows are
   those values after the human's edits, and a human-written value is
   never downgraded. On a migration, delete the manifest (`rm`) after
   that write. State plainly that the manifest is deleted and this skill
   never writes one again.

   **Pass the answers on.** Invoke `setup.mjs` (step 6) with
   `--location <chosen>`, `--linter <linter>`, and `--typescript <version>`
   only when the human overrode the detected TypeScript version — omit it to
   let setup keep re-detecting the repo's version on every run. The auth
   scheme needs no flag: it is recorded in the `### E2E bindings` section by
   the upsert above, and setup scaffolds nothing from it. The test
   convention needs no flag either: the gate settles it and the upsert
   above writes the `Convention` row (`pom` or `flat`), which `generate`
   and `discover` read. A re-run flips the convention the same way it edits any other
   answer — the human picks the other option at the summary and the upsert
   updates the row in place.

   **`E2E_BASE_URL` stays in `.env`.** This step records no base-URL row
   in the `### E2E bindings` section — a suite may point at a remote
   environment, so the base URL varies per run rather than being a
   one-time setup answer.

3. Detect any Playwright MCP server the user already configured, so the one
   this plugin bundles does not silently become a duplicate:

   ```bash
   node scripts/detect-mcp.mjs <target path>
   ```

   Read the JSON `found` array and the sibling `bundledDisabled` flag. Each
   `found` entry names the `harness`, the `file` it is declared in, the
   `server` name, and whether its `scope` is `user` or `project`. The server
   this plugin bundles is declared in the plugin's own manifest, not in any
   of these files, so it never appears here — every entry is a genuinely
   user-configured server. `bundledDisabled` is `true` when a previous setup
   run disabled this plugin's own bundled server (Claude Code only).

   - **`found: []`**:
     - `bundledDisabled: false` — no user server anywhere and the bundled
       one is active. Tell the human exactly one Playwright MCP server,
       bundled by this plugin, is available to the generation step.
     - `bundledDisabled: true` — no user server anywhere, but a previous run
       disabled the bundled one too, so generation currently has none. On
       Claude Code, report this and offer to re-enable it. **Only on the
       human's explicit yes**, run:

       ```bash
       node scripts/disable-plugin-mcp.mjs <target path> --enable
       ```

       On no, leave it disabled and say so. On Cursor / Codex, report the
       state and that re-enabling or removing the entry is the human's call.
   - **`found: [...]`** — report each entry (harness, file, server name).
     Then, by harness:
     - **Claude Code** — offer to disable this plugin's bundled server so the
       user's own is the only one. **Only on the human's explicit yes**, run:

       ```bash
       node scripts/disable-plugin-mcp.mjs <target path>
       ```

       It appends `plugin:apptension-e2e-testing:playwright` to
       `disabledMcpServers` under the project entry in `~/.claude.json`
       (idempotent). On no, leave both and say so.
     - **Cursor / Codex** — report the duplicate and that removal is the
       human's call (remove their own declaration, or leave both — each is
       `npx --isolated --headless`, spawned lazily). There is no per-server
       disable key to offer.

   Never disable anything without the human's explicit yes.

4. Install Playwright into the sub-package **first**, so the device wizard in
   step 5 can enumerate devices from a real install. This is a single cd-free
   call that resolves the suite location from `<target path>`, creates it if
   needed, and adds `@playwright/test` and `typescript` as **devDependencies**
   with the detected package manager. `--location <chosen>` is passed from
   step 2's summary here whenever the chosen location is not the default
   `e2e/web`; otherwise the install lands in `e2e/web` regardless of what
   was chosen:

   ```bash
   node scripts/install-playwright.mjs <target path> --location <chosen>   # --pm <npm|pnpm|yarn|bun> to override the detected manager; --linter <eslint|biome|none> to pass step 2's choice; --typescript <version> to pass step 2's override
   ```

   Pass `--linter <linter>` here too when the repo lints with Biome: it
   keeps the ESLint stack out even if `e2e/web` already carries a flat
   eslint config from an earlier scaffold. Omit it and install-playwright
   detects and follows the repo's linter on its own.

   `typescript` is pinned to the repo root's declared version (explicit
   `--typescript`, then a persisted override, then `report.typescript`) so
   specs typecheck against the same TypeScript the app uses — bare
   `typescript` with no version suffix when the repo declares none.
   A TypeScript suite (`report.language` is `ts`) also gets `@types/node`,
   pinned to the repo root's declared `@types/node` (`report.typesNode`) and
   bare when the repo declares none, so the scaffolded `fixtures/base.ts`
   passes `tsc --strict`. A JavaScript suite gets no `@types/node`.
   Pass `--linter auto` or `--typescript auto` to ignore a persisted
   override for this one install and re-detect instead.

   It resolves the manager in this order — a committed lockfile
   (`package-lock.json` / `yarn.lock` / `pnpm-lock.yaml` / `bun.lockb` /
   `bun.lock`), then the
   Corepack `packageManager` field (e.g. `"yarn@4.0.2"`) for a repo that pins a
   manager without committing a lock, then **npm** when neither is present — and
   runs that manager's dev-dependency add: `npm install -D` / `yarn add -D` /
   `pnpm add -D` / `bun add -D @playwright/test`. It is a plain dev-dependency
   add, **not** Playwright's `create`/`init` initializer (which would generate a
   competing config and example spec that the scaffolder in step 6 owns). The
   lint stack — `eslint`, `eslint-plugin-playwright`, and
   `@typescript-eslint/parser` — rides in the same add during step 6, once the
   scaffolder has written `eslint.config.mjs`, and only then: a sub-package
   already on a legacy `.eslintrc`, or a repo whose linter is Biome, gets
   neither the flat config nor these deps, so its existing lint keeps working
   and no ESLint is imposed on it. A Biome suite holding a `biome.json` on a
   repo Biome of 2.4.2 or later gets `@biomejs/biome` in the same add instead,
   pinned to `report.biome`, and the same one lint run. Biome exits 1 for
   findings and for a configuration error alike, so when the suite's `lint`
   script runs Biome, only output carrying "Some errors were emitted while
   running checks" reads as `findings`, and anything else is `crashed`. A
   kept `lint` script running another tool keeps exit 1 as `findings`. `eslint` is pinned to the repo root's
   declared version when that version is a single `X.Y.Z`, `^X.Y.Z` or
   `~X.Y.Z` that can resolve to ESLint 8.57 or newer. It falls back to `^10`
   when the root declares none, declares one held below 8.57, or declares a
   compound range or a protocol such as `catalog:`. On a Node that ESLint 10
   does not support (below 20.19, 21.x, 22 below 22.13, or 23.x) the fallback
   is `^9`. The suite pins
   `@typescript-eslint/parser` to `^8`, which supports ESLint 8.57 through 10.
   After that add, the script runs the suite's `lint` script once. Lint
   findings (exit 1) return `lint: "findings"` with the status left `ok`. Any
   other failure, an ESLint crash (exit 2) or a lint run that never started,
   returns `"status": "error"` with `lint: "crashed"`.

   Before running the add it prints the **root files it may create or change
   outside `e2e/web`** — the manager's lockfile and, for pnpm, the workspace
   manifest. The prediction is non-empty only when
   `e2e/web` is an actual member of the repo's workspace (its `workspaces` /
   `pnpm-workspace.yaml` patterns match `e2e/web`), where the manager resolves
   up to the workspace root; a standalone repo — or a monorepo whose patterns
   exclude `e2e/web` — keeps its lockfile inside `e2e/web` and the list is
   empty. pnpm writes to the nearest `pnpm-workspace.yaml`'s lockfile even for
   a suite its patterns exclude, so a pnpm suite outside the workspace is added
   with `--ignore-workspace`. The script hashes the manager's root files before
   and after every add, whatever the prediction said, and returns as
   `rootFilesTouched` the ones the add created or changed. Surface
   `rootFilesTouched` to the human so
   the blast radius is honest and not scoped to `e2e/web` alone — including a
   root lockfile the install *creates* that was not there before.

   Because `e2e/web` is a **self-contained sub-package** (its own
   `package.json`), the install writes a lockfile *inside* `e2e/web` — matching
   the host manager (`yarn.lock` in a yarn repo, and for Yarn Berry also a
   `nodeLinker: node-modules` `.yarnrc.yml` so the sub-package resolves a real
   `node_modules`). This per-package lockfile is intentional, not a stray npm
   island: it is what keeps the e2e suite installable on its own. A repo whose
   manager can't be resolved falls to `npm`, so the only case that yields a
   `package-lock.json` here is a target with no lockfile and no `packageManager`
   field.

5. Choose the projects to test with a short wizard. Each selected value becomes
   its own Playwright project.

   Ask the wizard as **one** `AskUserQuestion` call holding four questions,
   which the widget shows as tabs behind a single submit, in this order:
   **Desktop**, **Desktop resolutions**, **iOS**, **Android**. Every tab is
   multi-select, and a tab left empty means none on that tab: the answer
   leaves an empty tab's question out. The structure is fixed at four tabs,
   the widget's per-call maximum, with iOS and Android as separate tabs and
   every tab at its full option count. The Desktop tab has exactly three
   concrete options, one per engine Playwright runs. The Desktop resolutions,
   iOS and Android tabs have exactly four each. The pick widget's built-in
   "Other" row is the "type your own" escape on every tab, so the concrete
   options stay at those counts.

   First fetch the device buckets **once** — both device tabs slice this one
   result; never call the script again per tab. Get the options live from the
   Playwright installed in step 4, never hardcoded, so they stay valid for that
   version. Pass the same `--location <chosen>` used in step 4 whenever the
   chosen location is not the default — the `### E2E bindings` section is
   not written until step 6, so nothing yet recovers it automatically:

   ```bash
   node scripts/list-devices.mjs <target path> --all --location <chosen>
   # resolves @playwright/test from the chosen suite location (then the target
   # root), and returns every bucket the two device tabs need in one call:
   #   { ios:     { phones: [3 diverse], tablet: [newest 1] },
   #     android: { phones: [3 diverse], tablet: [newest 1] } }
   # phones are a DIVERSE pick (one per generation-line, brand-mixed) rather than
   # near-identical variants of the latest model. For debugging a single bucket,
   # --platform ios|android --form phone|tablet [--count N] still work.
   ```

   1. **Tab 1 — Desktop** (header `Desktop`):
      - **Chromium** → desktop `chromium`
      - **Firefox** → desktop `firefox`
      - **Safari** → desktop `webkit`
      - *Other* (widget free-text) → one of the three keys above.

      Playwright runs only these three engines. Chromium covers
      Chromium-based browsers such as Opera at the engine level, so a typed
      Chromium-based browser maps to `chromium`. Say so to the human: the
      project runs Playwright's Chromium build, not Opera itself. `setup.mjs`
      fails on any other key and names the three valid ones.

      The picks pass through `--browsers` (chromium / firefox / webkit). If
      nothing is chosen across **all tabs**, default to **Chromium** so setup
      never scaffolds zero projects.

   2. **Tab 2 — Desktop resolutions** (header `Resolutions`). The question
      text says the picks apply only to the desktop engines chosen on the
      Desktop tab. The tab is always in the call, because one call fixes its
      tabs before any answer. When no desktop engine is chosen, ignore its
      picks:
      - **1920x1080**
      - **1366x768**
      - **2560x1440**
      - **1440x900**
      - *Other* (widget free-text) → any exact `WxH`, multiple allowed.

      The picks pass through `--resolutions` (comma-separated `WxH`), applied
      **uniformly across every chosen desktop engine** — a cartesian product
      into projects named `<engine>-<WxH>` (e.g. `chromium-1920x1080`), so the
      suite runs each browser at each resolution. With **nothing** chosen here,
      each desktop project keeps the single 1920×1080 default and the plain
      `<engine>` name. This tab never affects mobile projects.

   3. **Tab 3 — iOS** (header `iOS`): the **3 diverse iPhones** from
      `.ios.phones` + the **newest iPad** from `.ios.tablet` (four options).
      *Other* = type any exact iOS device name.

   4. **Tab 4 — Android** (header `Android`): the **3 diverse Android phones** from
      `.android.phones` + the **newest Android tablet** from `.android.tablet`
      (four options). *Other* = type any exact Android device name.

   Worked example — one call, four multi-select questions, one submit:

   ```
   AskUserQuestion(questions: [
     Desktop:     [Chromium, Firefox, Safari]                    # 3 + Other
     Resolutions: [1920x1080, 1366x768, 2560x1440, 1440x900]     # 4 + Other
     iOS:         [<ios.phones ×3>, <ios.tablet ×1>]             # 4 + Other
     Android:     [<android.phones ×3>, <android.tablet ×1>]     # 4 + Other
   ])
   ```

   Collect every chosen desktop engine into `--browsers`, every chosen
   resolution into `--resolutions`, and every chosen device name across the iOS
   and Android tabs into `--devices`.

6. Scaffold and finish setup in **one call**. `setup.mjs` runs the post-wizard
   pipeline — scaffold, then the pinned Playwright install, then the browser
   binaries — resolving every path from `<target path>` (no `cd`). Pass desktop
   choices to `--browsers`, every chosen resolution to `--resolutions`, and
   every chosen device name to `--devices` (names contain spaces but no commas,
   so comma-separate them). Also pass `--location <chosen location>`,
   `--linter <linter>`, and `--typescript <version>` (only
   when the human overrode it) — the same answers from step 2's
   approval gate — so a first run scaffolds the chosen location, linter,
   and TypeScript pin instead of silently defaulting.
   `--linter`
   is what records a `biome` choice so no ESLint is
   written; omit it and the scaffolder still detects and follows the repo's
   linter, just without persisting the choice for the next run. `--typescript`
   likewise persists an override; omit it and the sub-package's `typescript`
   is pinned fresh from `report.typescript` on every run. Pass `auto` as the
   value of `--linter` or `--typescript` to clear a persisted
   override for that field instead of setting one — the next run re-detects
   it. The auth scheme takes no flag here: it lives in the `### E2E bindings`
   `Auth scheme` row that `scripts/bindings.mjs` renders below, and setup scaffolds nothing
   from it. On a default-location, ESLint-or-none run the flags can be
   omitted:

   ```bash
   node scripts/setup.mjs <target path> --browsers <comma-separated> --resolutions <comma-separated WxH> --devices "<Device One>,<Device Two>" --location <chosen location> --linter <eslint|biome|none> --typescript <version>   # add --with-deps on CI/Linux
   ```

   `setup.mjs` prints one JSON result on stdout. Install and browser-download
   progress goes to stderr. Read stdout whole, exactly as the command prints
   it. A `tail`, `head` or `grep` on it drops fields this step reads, and a
   `tail` drops `status` itself, which sits at the top. Getting them back
   means running the whole install again. Read `probe-port.mjs` below the same
   way. A cut probe result costs a second probe, not a second setup.

   Everything is created under the chosen suite location (default `e2e/web`),
   except one line in the repo root's `.gitignore`. The bundled Playwright MCP
   server writes snapshots and console logs to `.playwright-mcp/` at the root,
   so setup adds `.playwright-mcp/` there unless a rule already covers it.
   The scaffolder merges into the
   `package.json` from step 4 (adding the `test:e2e` scripts, a `lint` script
   when the repo lints with ESLint or has no linter, and pinning the installed
   `@playwright/test` version) and writes
   `playwright.config.ts` with all chosen desktop + device projects. Every one
   of those projects is split in two: `<name>` runs everything except
   `*.smoke.spec.ts` (granular, the nightly run), `<name>-smoke` runs only
   `*.smoke.spec.ts` (the merge-blocking gate) — matched by filename, never a
   `{ tag: '@smoke' }` annotation, so a spec nobody remembered to tag still
   lands somewhere instead of silently shrinking the gate. `test:e2e:smoke`
   and `test:e2e:granular` select their half via `--project`; a re-run on a
   scaffold-owned dir regenerates both scripts (and the config) when the
   chosen browsers/devices change, so a stale project name never lingers in
   `package.json`. It also writes `eslint.config.mjs` — the flat config that
   turns on
   `eslint-plugin-playwright`'s recommended rules and makes `waitForTimeout`, a
   missing `await`, and `networkidle` fail `npm run lint` rather than surface as
   a flaky run — but only when the repo lints with ESLint (or has no linter) and
   the sub-package has no eslint config yet, so a repo that already lints keeps
   its own and a Biome repo gets no ESLint at all. A Biome repo on 2.4.2 or
   later gets a nested `<location>/biome.json` instead (`"root": false`,
   `"extends": "//"`, so the root config still applies) naming
   `noPlaywrightWaitForTimeout`, `noPlaywrightMissingAwait` and
   `noPlaywrightNetworkidle` as errors, plus `expect-assertion.grit`, a
   GritQL plugin that warns on a test with no `expect()` and no
   `to<Matcher>()` call, and a `lint` script (`biome lint .`). Biome's own
   `useExpect` stays off because it flags every Page Object spec. A suite
   `biome.json`/`biome.jsonc` already there is left as it is, with a
   `scaffold.notes` line naming the rules to add. A TypeScript suite also gets a `tsconfig.json` and a `typecheck`
   script (`tsc --noEmit`). The config extends the repo root's
   `tsconfig.base.json`, else its `tsconfig.json`, and overrides `types`,
   `noEmit`, `rootDir`, `files`, `include` and `exclude`, so the check starts
   from the suite's own files and none of the app's. An app file a suite file
   imports is still checked, because `tsc` follows imports. With no root config it is
   standalone, with `strict: true` and NodeNext module resolution. After the
   install, a TypeScript older than 4.7, which has no NodeNext, gets
   CommonJS and Node resolution in that standalone file instead, and
   `install.tsconfigRewritten` names the installed version. The version is the
   one the suite resolves, a workspace copy hoisted to the repo root
   included. A standalone file
   somebody edited is left alone. An existing suite `tsconfig.json` or
   `typecheck` script is kept as it is, with whatever file scope it sets, and
   a JavaScript suite gets neither.
   A suite at the repo root gets neither too, and a `scaffold.notes` line
   says why. Read the JSON:

   - `"status": "ok"` — setup succeeded. Report `scaffold.created` (the paths
     written), `browsers.engines` (the binaries installed), and
     `rootFilesTouched` (root files changed **outside** the chosen suite
     location, e.g. a lockfile or workspace manifest — report them alongside
     the creations so the summary is not misleadingly scoped to that
     location). When `install.lint` is `"findings"`, the suite lints with
     errors in files already there; report that and name `<pm> run lint` in
     the suite location as the command that lists them. On a
     scaffold-owned (spec-less) dir a re-run **regenerates** the config to match
     the current `--browsers`/`--devices`; an identical re-run changes nothing.
     When the repo uses a task runner (nx/turbo/lerna), `scaffold.notes` carries
     a line naming it and saying setup did **not** register the chosen suite
     location with it —
     whether the runner already runs the suite depends on the runner's own
     project/task config, which setup does not read — with the run command when
     a `test:e2e` script exists. Report that note.
   - `"status": "error"` — the suite's `lint` script crashed right after the
     install (`install.lint` is `"crashed"`), so the lint stack cannot run.
     Browsers were not installed. Report `install.message` to the user; it
     names the command and ends with the last lines of its output, where
     ESLint prints the error.
   - `"status": "conform"` — the chosen suite location already held specs, so
     nothing was
     changed (no install, no config write). Present `scaffold.present`/
     `scaffold.missing` and ask how to proceed. If the user approves filling the
     gaps, re-run with `--create-missing` (creates only what's missing, never
     overwriting an existing config or spec).

   Also read `webServer` — it says whether the suite can start the app itself:

   - `"status": "resolved"` — `scaffold.env` (below) already wrote
     `E2E_WEB_SERVER_COMMAND`/`E2E_WEB_SERVER_CWD` into the suite location's
     `.env` (default `e2e/web/.env`); nothing to export by hand. Check `scaffold.env`'s `E2E_BASE_URL` entry too — setup
     fills it from the first source that answers: an exact `E2E_BASE_URL` the
     repo declares, then a declared `PORT`, then a port the start command names
     as a flag (a `--port`/`-p`, or `vite preview`'s 4173), then — for a
     framework that reads the generic `PORT` (Next/CRA/Nuxt; Vite and Angular
     ignore it) — a `PORT` set inline in the start script or exported in the
     environment, then the framework's documented default
     (Vite 5173, Next/Nuxt/CRA 3000, Angular 4200, webpack-dev-server 8080),
     and only then a URL alias like `BASE_URL` or `NEXT_PUBLIC_APP_URL`. The
     aliases sit last on purpose: one is often the deployed site, and a suite
     that logs in and clicks buttons must not point at production. It stays
     `"blank"` only when nothing answers, and without it the config has no `url`
     to wait on.

     A framework default is a guess, not a reading of the running server, and is
     now reported with source `"framework-default"` (a config-file port or a
     command port reports `"detected"`). When `E2E_BASE_URL`'s source is
     `"framework-default"` or `"blank"`, probe the port the app actually binds:

     ```bash
     node scripts/probe-port.mjs <target path>
     ```

     It boots the app's dev server, reads the port its process group binds via
     `lsof`, and tears the group down (no orphaned process on any exit). The
     server's output goes to `.e2e-testing/probe.log`, which the script adds
     to the repo's `.gitignore` unless a rule already covers it. Read the
     JSON `status`:

     - `"resolved"` — report the observed `port`. If it matches the framework
       default already written, the default was right. If it differs, the app
       binds that port at runtime (a config-file port, or a free port chosen at
       boot); setup did **not** pin it, because a value written once would be
       wrong next run. Tell the human to pin the port in the app's config (a
       `vite.config.ts` `server.port` a re-run then resolves statically) or set
       `E2E_BASE_URL` in the suite location's `.env`.
     - `"port-in-use"` — the resolved `port` already answers HTTP, so the probe
       did not boot a second server (it would bind a throwaway port, and the
       responder may not even be this app). Tell the human to confirm that
       `port` is the app under test, or free it and re-run the probe.
     - `"deps-missing"` / `"no-lsof"` — the probe could not run (app deps not
       installed, or `lsof` unavailable); setup kept the static answer above.
       Say so.
     - `"not-bound"` — the server did not bind a reachable port in time; setup
       kept the static answer. Report the `logTail`.
     - anything else (`"no-start-command"`, `"ambiguous"`, `"error"`) — the app
       couldn't be resolved to a bootable dev server; report it and keep the
       static answer above.
   - `"status": "no-start-command"` — say no `dev`/`start`/`serve` script was
     found, so the suite will only ever test an app the human starts themselves.
   - `"status": "ambiguous"` — present `candidates` and ask which one serves the
     app under test, then tell them to use that path's command.

   And read `scaffold.env` — how the suite location's `.env` was filled. `keys` lists every
   `E2E_*` name with where its value came from: a `<file>:<NAME>` source means
   setup mirrored that file's value under the `E2E_` name (aliases like
   `BASE_URL` or `BASIC_AUTH_USER` are recognized; an exact `E2E_*` name in the
   repo's own env files wins outright); `"detected"` means setup resolved it
   from the `webServer` itself — its command/cwd, a port pinned in the framework
   config, or a command-flag port; `"framework-default"` means the URL is the
   framework's documented default, a guess the probe step above checks against
   the running server; `"kept"` means a value already in that `.env` —
   from a prior run or typed by hand — was left untouched; `"blank"` means no
   source matched. Report which keys came from where, but never a value —
   `scaffold.env` never carries one, by design, since this JSON lands in a
   transcript. Tell the human which keys are still `"blank"`, leaving out
   `E2E_AUTH_MODE`: blank there selects the shared saved login, the default.
   Name it once instead, as the switch for a backend that rotates refresh
   tokens (`E2E_AUTH_MODE=per-worker`; the `playwright-testing-patterns` skill
   says when to pick it). Then tell the human how the same suite runs against
   a staging env behind HTTP basic auth: export `E2E_BASE_URL`,
   `E2E_BASIC_AUTH_USER`, `E2E_BASIC_AUTH_PASSWORD`, `E2E_USER_EMAIL`,
   `E2E_USER_PASSWORD` and an empty `E2E_WEB_SERVER_COMMAND` in the shell,
   then run `npm run test:e2e` from the chosen suite location, which holds
   that script and the `.env` the config reads. The config's `.env` loader never overrides a
   var the shell already set, so the local `.env` stays as it is, and the
   empty command keeps the run from booting a local app. Playwright sends the
   basic-auth credentials only when the server answers 401, so the same keys
   do nothing locally. When step 7 drove
   a working login, `auth.setup.ts` is runnable and the remaining gaps are only
   those blank keys. When step 7 kept the stub, the login is also still to be
   written before tests pass. Its steps go in `fixtures/login.ts` (under the
   chosen suite location), which `auth.setup.ts` and per-worker mode both call,
   and `write-auth-setup.mjs` writes that pair once the keys are filled.

   `global-setup.ts`, under the chosen suite location, is scaffolded as a documented no-op and wired into
   the config as `globalSetup`. Nothing has to be filled in for the suite to
   run; say it is where suite-wide test data gets seeded and reset, so specs
   stop depending on whatever the target database happens to hold. Against a config
   the scaffolder does not own — hand-authored, or already wiring a
   `globalSetup` of its own — the hook is **not** written and `scaffold.notes`
   says which case it is: the line to add by hand, or the existing hook to seed
   in instead. Report every note verbatim.

   The scaffolder never writes an example spec or page object, and never writes
   a secret value into `.env.example` (under the chosen suite location), which stays the committed list of
   names for CI secrets. After a successful run the suite lives under the
   chosen suite location (default `e2e/web`) and runs via `npm run test:e2e`
   (`:ui`, `:report`, `:smoke`, `:granular`). This step is also where step 2's
   approval releases the `### E2E bindings` section to disk. Render it from
   every answer the human approved at step 2's gate:

   ```bash
   node scripts/bindings.mjs --location <chosen location> --convention <pom|flat> --auth-scheme <scheme> --linter <linter> --typescript <version>
   ```

   Pass `--typescript` with the TypeScript version the gate settled, the
   detected one or the human's override. Omit it only when the human
   confirmed an unpinned install. The script prints the section, heading
   included, and exits 1 without `--location` or on a `--convention`
   other than `pom` or `flat`. Write its output to the resolved bindings
   file unchanged: as a new section when the file has none, or in place
   of the whole existing section, per step 2's write rule. Every row in the section comes from
   this output, so a row the script omits is removed and reads as
   auto-detected on the next run. That is how an unpinned TypeScript
   choice clears an old `TypeScript` row. On a migration, this same write
   is what upserts the section, and deletes the manifest per its
   migration rule above.

7. **Draft a working login.** The scaffolder ships `auth.setup.ts` and
   `fixtures/login.ts`, under the chosen suite location (default `e2e/web`), as
   stubs. When the target exposes a login URL and credentials, replace it with a
   runnable login, driven — for selector discovery — over the bundled Playwright
   MCP, and validated by a real run. Secret **values** are never read here; the
   gate reads only the `scaffold.env.keys` **sources** from step 6. On a run
   the `ready` check sent straight here, the check's `blank` list stands in for
   them. A key it lists reads as `"blank"`, and every other key as set.

   **Gate.** Proceed only when, in `scaffold.env.keys`, `E2E_BASE_URL`,
   `E2E_USER_EMAIL`, and `E2E_USER_PASSWORD` each have a source other than
   `"blank"`. For `E2E_LOGIN_URL`: if its source is other than `"blank"`, use it;
   if `"blank"`, ask the human once for the login URL (a path like `/login` or an
   absolute URL — not a secret) and set it on the existing `E2E_LOGIN_URL=` line
   in the suite location's `.env` in place — do not append a second `E2E_LOGIN_URL=` line, the
   loader keeps the first occurrence of a key, so a duplicate would be ignored.
   If any of `E2E_BASE_URL` / `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` is `"blank"`,
   **do not** drive a login: leave the stub in place and tell the human it ships
   as a stub, not a working login, naming the blank keys to fill in `.env`, and
   that running this skill again after they fill them does only the login. Stop.

   **Discover selectors (secret-safe, best-effort).**
   - When `E2E_BASIC_AUTH_USER` is `"blank"`, the login page is reachable without
     a secret. Do **not** restore the target's saved auth for discovery — the
     bundled Playwright MCP runs `--isolated`, so its context already starts
     logged out, which is exactly the state a login page must be viewed in.
     Navigate to the login URL with `browser_navigate`, take one
     `browser_snapshot`, and read the email field, password field, and submit
     control from the accessibility tree. Do **not** type any value. Express
     each as a Playwright locator: prefer `getByLabel(...)` / `getByRole(...)`
     over CSS, per this plugin's defaults. The script writes each locator after
     `page.` and drops a leading `page.` from the value, so `getByLabel('Email')`
     and `page.getByLabel('Email')` render the same line.
   - When `E2E_BASIC_AUTH_USER` has a source other than `"blank"`, the base URL is
     behind HTTP Basic auth and a secret-safe MCP session cannot reach it. Skip
     live discovery and use conventional defaults: `getByLabel('Email')`,
     `getByLabel('Password')`, `getByRole('button', { name: /sign in/i })`. Tell
     the human these are defaults, unverified against the live page.

   **Write the file.**

   ```bash
   node scripts/write-auth-setup.mjs <target path> \
     --email "<email locator>" --password "<password locator>" \
     --submit "<submit locator>" --wait "'**/'" --location <chosen>
   ```

   Pass `--location <chosen>` when the chosen suite location is not the
   default. The scripts do not read the `### E2E bindings` section — the
   agent does, and threads the value on as `--location` — so it is not
   recoverable automatically: pass it explicitly, as every earlier step does.

   `--wait` is spliced verbatim into `page.waitForURL(<value>)` in the generated
   file, so it must be a quoted JS string or regex literal, not a bare glob —
   set it to the URL the app lands on after login: `'**/'` if it returns to the
   base URL, or e.g. `--wait "'**/dashboard'"` (note the inner quotes) for a
   specific path. This writes a pair under the chosen suite location and
   lists both in `written`: `fixtures/login.ts`, a runnable `login(page)` that
   reads credentials from `process.env`, and `auth.setup.ts`, which calls it
   and saves `.auth/user.json`. The login steps live only in `login.ts`, and
   per-worker mode reuses them. If the script instead reports `refused`
   (naming whichever of the two files is hand-authored — a suite with its own
   auth logic), it wrote neither: leave both files alone, tell the human, and
   integrate the login into their existing files manually rather than
   overwriting them.

   **Validate (this is the real login).** Run the `setup` project so Playwright
   reads `.env`, applies `httpCredentials` from `E2E_BASIC_AUTH_USER/_PASSWORD`
   (already wired in the config), performs the login, and writes an authenticated
   `.auth/user.json` under the chosen suite location:

   ```bash
   cd <target path>/<chosen suite location> && npx playwright test --project=setup
   ```

   On success, `.auth/user.json` holds the logged-in session that every project
   reuses (each has `storageState` + `dependencies: ['setup']`). On failure — a
   wrong selector or post-login URL — invoke `superpowers:systematic-debugging`:
   re-snapshot if the page is reachable, otherwise adjust the selectors with the
   human, rewrite with `write-auth-setup.mjs`, and re-run until the setup project
   passes. Do not leave a red setup project behind.

Each script above (`detect`, `detect-mcp`, `install-playwright`,
`disable-plugin-mcp`, `scaffold`, `install-browsers`, `list-devices`,
`probe-port`) also remains independently runnable for debugging — `setup.mjs`
sequences all of them except `list-devices`, `detect-mcp`, `disable-plugin-mcp`,
and `probe-port` (the last a live-boot step surfaced to the human, never
auto-run).
