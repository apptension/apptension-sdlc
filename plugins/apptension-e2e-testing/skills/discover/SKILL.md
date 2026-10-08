---
name: discover
description: Propose the user paths an app has, from its own code or from a seed epic's sub-issues, then write whole-path smoke tests for the ones a human picks. Takes an optional epic or story reference by shape — a GitHub issue number or URL — and an optional [target path]. Trigger on intent like "what paths does this app have", "we need E2E tests for the critical paths", "find user paths to test", or "/apptension-e2e-testing:discover".
argument-hint: "[issue number | URL] [target path] [--pom | --no-pom]"
---

# Discover User Paths

Proposes the user paths an app has, caps the list at something a human will
actually read, and writes a whole-path test for each path they pick. Where
`generate` starts from one ticket's diff and asks which of its behaviors need
a browser, this starts from the app and asks which of its journeys deserve a
merge-blocking test.

The division of labour is fixed and deliberate: **the machine proposes, the
human decides.** Importance is not inferred — the DOM does not say that
"checkout with an expired card" matters more than "footer link opens"; both
are an `<a>`. Code only hints where to look, and auth and payments are
usually the core. What earns a test is settled at step 3 by a person.

Writing that list from a blank page costs an hour and half of it comes out
forgotten. Judging a ready list costs ten minutes. That trade is the whole
premise of this skill.

Paths below are relative to this skill's own directory.

## Argument by shape

`$ARGUMENTS` holds the full string. Sort its tokens into three parts before
classifying anything:

1. A `--pom` or `--no-pom` flag: set it aside for step 4.3's spec structure.
2. A **path token**: one that contains `/` without `://`, starts with `.` or
   `~`, or names an existing directory and is not digits only. The first
   path token is `[target path]` for every later step. With none, `[target
   path]` is the repository you are working in.
3. `<argument>`: the first remaining token, or an empty string when none
   remains, which classifies as `absent`.

So `discover /path/to/repo` scans that repo, and `discover 419
/path/to/repo` seeds from issue 419 against it. Classify `<argument>`'s
shape first — nothing else infers it:

    node ../generate/scripts/classify-argument.mjs "<argument>"

It prints `{ kind, value, tracker }`. Route on `kind`:

| Shape | `kind` | Action |
|---|---|---|
| absent | `absent` | **Scan the app.** Steps 1 through 4 below — code always, plus step 2's live crawl when its four preconditions hold. |
| digits only | `github` | **Seed** from that issue's sub-issues (step 1's seeding half). |
| a GitHub URL | `github` | Same as digits. When the classifier returns `owner`/`repo`, confirm they match the target repo (`gh repo view --json nameWithOwner` against the target path) before fetching; on mismatch, **stop** and report that the URL points at a different repository. |
| `UPPER-123` or a Jira URL | `jira` | **Stop.** Recognised, and not actionable here: seeding reads a ticket's sub-issues over `gh`, which is GitHub-only, so there is no Jira path to seed candidates from. (`generate` does write specs for a Jira key; this is `discover`'s own seeding limit, not that one.) Say so and stop before step 1. |
| `lower-kebab-case` | `user-path` | **Stop.** That names a user path, and this skill's job is to propose paths, not to be handed one. |
| none of these | `unusable` | **Stop** and report the argument as unusable — never guess a ticket from it. |

An absent argument is the primary case here, not a stop: an app with no
tickets is exactly the situation this skill exists for. That is the opposite
of `generate`, where an absent argument is a stop.

## Steps

Four steps, roughly a ten-minute budget, each skippable, ordered
cheapest-first in human time. Before them, one that is not skippable:
settling which directory holds the app.

0. **Resolve the app's location first, and stop if it is not one directory.**

   ```bash
   node ../e2e-setup/scripts/web-server.mjs <target path> --scan-location [--location <rel>]
   ```

   This runs **before** step 1, because step 1's scope is the directory this
   resolves to. A monorepo has more than one app in it, and a code scan rooted
   at the repo instead of at the app proposes paths from the wrong one — a
   React Native screen becomes a candidate user path, and nothing downstream
   catches it, because a human reviewing the list at step 3 has no reason to
   doubt that the paths came from the app they meant.

   Read the status:

   - `"resolved"` — step 1's scope is `location`. **It scopes the code scan
     and nothing else.** Do not carry it into the later script calls; see
     "One flag, three meanings" below.
   - `"ambiguous"` — **stop.** Present `candidates` and ask which app to
     discover paths for, then re-run with `--location <rel>`. Do not pick
     one, and do not fall back to scanning the repo.
   - `"unknown-location"` — **stop.** The `--location` given names no
     directory detection found; show `candidates` and ask again.
   - `"no-web-app"` — **stop** and say so. Every candidate is an Expo or
     React Native package, which this skill has no browser paths to
     propose from.

   `--scan-location` is the flag that matters here. Without it the script
   answers a different question — which location can *boot* the app — and
   that one requires a `dev`/`start`/`serve` script. Reading code requires
   no such thing: a repo booted by a custom `E2E_WEB_SERVER_COMMAND`
   declares no start script of its own, and a repo whose app is already
   running does not need one either. Both are supported here, and both
   would be turned away by a boot-shaped question. Booting stays step 4.2's
   job, and it reads the env override as before.

   Detection finds a monorepo's members from a `workspaces` field, a
   `pnpm-workspace.yaml`, or — where neither declares any — a scan of
   `apps/*` and `packages/*`. A repo that is a monorepo by directory
   convention alone still resolves.

   **One flag, three meanings.** `--location` names a different directory to
   each script that takes it, and forwarding one script's answer to another
   breaks the run:

   | Script | What `--location` selects | What step 0's answer does to it |
   |---|---|---|
   | `web-server.mjs --scan-location` | the directory holding the app's source | this is the one that answers it |
   | `resolve-app-url.mjs` | the directory whose start script boots the app | a web-signalled child with no `dev`/`start`/`serve` script reports `no-start-command`, even where the repo root could boot it |
   | `validate-specs.mjs`, `run-specs.mjs`, `list-viewports.mjs`, `check-viewport-walk.mjs` | the directory where `@playwright/test` is installed | after normal setup that is `e2e/web`, so passing the app directory reports `no-playwright` before anything runs |

   So step 0's resolved location goes to step 1 and stops there. The other
   two questions have their own resolvers and answer themselves: called with
   no `--location`, `resolve-app-url.mjs` resolves the bootable location and
   the spec scripts resolve the single location carrying Playwright.

   **A `--location` the human gave is different.** It is their answer, not a
   derived one, so pass it on to `resolve-app-url.mjs` as well — they named
   the app directory, and it is the boot resolver's `--location` too. Still
   never pass it to the spec scripts: those select a Playwright package, and
   a human naming the app directory has not answered that question.

1. **Read the code — in a sub-agent, with a written-down scope.**

   Dispatch a sub-agent so this reading happens in its own context. Reading
   an app's surface is the step that otherwise eats twenty minutes and the
   whole context window, and none of the raw file contents are needed after
   the candidate list exists.

   **Root the sub-agent at step 0's `location`, not at the repo.** Say the
   directory in its prompt and tell it not to read outside it. A sibling app
   is out of scope even when it is the more prominent one in the README.

   **The scope is these four areas and nothing else:**

   - **route definitions** — whatever declares the app's URLs;
   - **auth configuration** — sign-in, session, provider setup;
   - **route guards** — whatever decides who is turned away from which route;
   - **payment modules** — checkout, billing, payment-provider SDK usage.

   **Not every component.** A component tells you a button exists; a route
   tells you a journey exists. The sub-agent greps for these four areas
   itself, using whatever the framework in front of it actually does —
   Next.js app directories, React Router configs, Vue Router, Django
   `urls.py`, Rails `routes.rb`, and so on. There is deliberately no
   scripted file list: a routing-pattern list confident enough to be a
   script is either enormous or wrong for the framework at hand, and a
   wrong-but-certain file list is worse than a good grep. (This plugin
   already made and reversed this call once — see `generate`'s "Why the
   browser-boundary judgement is skill prose, not a script".)

   Ask the sub-agent for one entry per candidate user path:

   ```json
   [
     {
       "path": "checkout",
       "area": "payments",
       "source": "code",
       "evidence": "app/(shop)/checkout/page.tsx, lib/stripe/session.ts"
     }
   ]
   ```

   - `path` — a plain kebab-case name (`^[a-z0-9]+(-[a-z0-9]+)*$`), because
     it becomes a `flowId` and `write-specs.mjs` refuses anything else.
   - `area` — exactly one of `auth`, `payments`, `guarded`, `public`.
   - `source` — `"code"` for a candidate the sub-agent found by reading
     files, `"crawl"` for one the live click-through found (step 2), or
     `"issue #<N>"` for one seeded from a sub-issue below. This is what
     step 3's disclosure and per-candidate tagging read from — never
     re-derive it there.
   - `evidence` — the file(s) that suggested the path (for `"code"`), the
     URL and the click trail that reached it (for `"crawl"`), or the
     sub-issue's title/body (for `"issue #<N>"`), so a human reviewing the
     list can check it without re-reading the app or the ticket.

   **When an issue number was given, seed from it as well.** Sub-issues are
   a breakdown a person already wrote, and on a feature that is planned but
   not yet built there is no code to read at all:

   ```bash
   node scripts/list-children.mjs <issue number> [target path]
   ```

   Read the JSON:

   - `children` is an array — turn each child's title and body into
     candidate paths (`source: "issue #<child number>"`), alongside
     whatever the code scan produced.
   - `children` is `[]` — the ticket is a story, not an epic. Draw
     candidates from its own `title` and `body` (`source: "issue #<N>"`,
     the seed ticket's own number).
   - `children` is `null` — the sub-issue lookup failed. **Stop** and say
     the child check could not complete. Do not treat it as "no children",
     and do not silently fall back to the code scan alone.
   - A child with `body: null` had its own fetch fail. Its title is still a
     usable seed; note the missing body rather than dropping the child.

2. **Click through the live app — in a sub-agent, behind four
   preconditions.**

   Reading the code shows which routes exist. It does not show what is
   reachable, and it cannot see a state with no distinct route — a step
   inside a wizard, a panel behind a modal. Clicking fills that in.

   It is also the one step here that can change data, so it refuses to
   start unless **all four** hold. Three are machine-checkable:

   ```bash
   node scripts/check-crawl-preconditions.mjs <target path> [--location <rel>]
   ```

   Pass `--location` when the `### E2E bindings` Location row names a suite
   outside the default `e2e/web` — it is the suite directory whose `.env`,
   `.auth`, and `crawl-blocklist.json` this check reads. Omit it for a suite
   at the default location.

   | `checks[].id` | Holds when |
   |---|---|
   | `base-url` | `E2E_BASE_URL` resolves to a usable http(s) URL |
   | `auth-state` | the target has a saved session at `<location>/.auth/user.json` |
   | `blocklist` | the blocklist resolves — bundled defaults, plus whatever `<location>/crawl-blocklist.json` adds |

   The fourth is the human's, and no script can stand in for it: **ask
   whether this environment is safe to click through, naming the resolved
   `baseUrl`, and wait for an explicit yes.** Never infer it. A URL
   containing `localhost` or `staging` is not an answer — people do run
   staging against production data — which is why the script reports
   `humanConfirmation: { required: true, inferable: false }` for every URL
   it ever resolves, and why `machineReady: true` means the three checks
   pass and the gate is still open, never "go".

   Ask before dispatching anything, so the answer costs nothing in
   parallelism, then **dispatch this sub-agent and step 1's in the same
   message** — they share no state, and the crawl is the slower of the two.

   **When any precondition fails, or the human says no or anything short of
   yes, the crawl does not run.** That is not an error: continue with step
   1's candidates and carry the failed check's `id` into step 3's
   disclosure, so the list says what it is missing and why. Do not offer to
   fix the precondition and re-ask in the same breath — a human who wanted
   the crawl will say so.

   **The sub-agent's contract:**

   - **It reads its own routes.** Before opening a browser it greps route
     definitions, and only those — not auth config, not guards, not payment
     modules. Taking the routing table from step 1's sub-agent would
     serialise the two; one grep done twice is the cheaper trade.
   - **It restores the saved session before its first navigation**, from
     `node ../generate/scripts/resolve-storage-state.mjs <target path>
     [--location <rel>]` — passing the same `### E2E bindings` Location row
     the precondition check above used — via `browser_set_storage_state`. It
     never performs a login of its own — that mechanism already exists and is
     not rebuilt here.
   - **It visits each route, then explores at most 4 clicks deep from it.**
     Same-origin only. A link off-origin is not followed at all.
   - **It clicks links and navigation controls, and nothing else.** It never
     submits a form. It never accepts a dialog — `browser_handle_dialog`
     always dismisses. It skips any control whose accessible name matches a
     pattern from the script's `blocklist` array.
   - **If the MCP tools are not reachable, it stops and says so** rather
     than reporting from the routes it read.

   Ask it for candidates in step 1's shape, with `source: "crawl"` and
   `evidence` carrying the URL and the click trail that reached the path:

   ```json
   [
     {
       "path": "invite-teammate",
       "area": "guarded",
       "source": "crawl",
       "evidence": "/settings/team → 'Team' tab → 'Add member' panel (2 clicks)"
     }
   ]
   ```

   Merge its candidates with step 1's. Where both name the same `path`,
   keep one entry and record both sources (`code, crawl`) — a path two
   independent methods found is better evidenced, not duplicated.

3. **Human review — at most 30 candidates, each one write-now or skip.**

   1. **Audit coverage, then drop what already has a path directory.**

      ```bash
      # Location row present:
      echo '{"candidates": <step 1/2 candidates>, "scanSources": [<sources that ran>]}' \
        | node scripts/audit-coverage.mjs <target path> --location <location>
      # Location row absent:
      echo '{"candidates": <step 1/2 candidates>, "scanSources": [<sources that ran>]}' \
        | node scripts/audit-coverage.mjs <target path>  # e2e-location-default
      ```

      Pass `--location <location>` whenever the `### E2E bindings` Location
      row exists, `e2e/web` included. The spec dir then follows that suite's
      own `playwright.config` `testDir`, so a conform suite with
      `testDir: './tests'` is audited against `<location>/tests`. A `testDir`
      of `.` or none keeps `<location>/specs`. With the row absent, omit it
      and the spec dir follows the Playwright config's `testDir`, or
      `<config dir>/specs` when the config names none, landing on `e2e/specs`
      only when no usable Playwright config is found. Two kinds of config
      are skipped: one whose `testDir` is an expression, such as
      `join(__dirname, 'tests')`, and one with no `testDir` outside the
      locations the runner starts from: the repo root, a workspace member or
      `e2e/web`, each with a `package.json` declaring `@playwright/test`.

      `scanSources` names only what actually ran this call — `"code"`, and
      `"crawl"` and/or `"issue #<N>"` when they did too — the same values
      sub-step 4's disclosure sentence draws its `<sources>` clause from.

      Returns `{"specDir", "scanSources", "untested", "noSmokeTest",
      "unmatched"}`. Keep going with `untested` — this scan's candidates
      with no flow directory yet — as the survivor set for the rest of this
      step; an empty array means every candidate already has a directory,
      not an error.

      Report the other two buckets before presenting the checklist below,
      every run, not only a repeat one — this is what turns a filter into
      an idempotent coverage audit:

      - **`noSmokeTest`** — flow directories with no `.smoke.spec` file,
        empty directories included. Each already has a path but never got a
        merge-blocking whole-path test.
      - **`unmatched`** — flow directories this run's candidates never
        named — the closest cheap signal that the app moved on without the
        spec. Report these as **this scan didn't reach them**, never as
        "removed": a code-only run (the common case — the live crawl in
        step 2 needs all four preconditions to hold) can miss a route a
        previous crawl found, and an issue-seeded run may never have looked
        at code at all. Name `scanSources` next to this bucket so the
        reader judges each entry against what actually looked, not against
        an assumed full scan.

      Both list flowId and the spec filenames inside it, so the report
      stands on its own without the reader opening a file in the repo.

      This is why **no rejection state is stored anywhere**. A later run
      re-compares against the directories under the spec dir, so anything
      already tested drops out of `untested` on its own — and a genuinely
      untested path proposed again is a reminder, not noise. The same
      re-comparison is what makes a repeat run safe: it only ever reads the
      spec dir, so nothing already written is duplicated or overwritten.

   2. **Order the survivors** `auth`, then `payments`, then `guarded`, then
      `public`. This is the code's hint about where to look, not a verdict
      on importance — the human still decides what gets a test.

   3. **Cap at 30, and never cap silently.** If more than 30 survive, keep
      the first 30 in that order and state the overage in the same breath:

      > Found 50 candidate paths, 10 already have a path directory, leaving
      > 40 survivors — showing the first 30 by area. Not shown: 6 more
      > under `guarded`, 4 more under `public`.

      A list of 30 that reads as "this is everything" when it isn't is
      worse than an honest partial list.

   4. **Present the candidates as a checklist**, and include the disclosure
      sentence that actually matches how this run's list was seeded and
      whether the crawl ran:

      State what this run's list was built from and what is therefore
      missing from it, in one sentence built from what actually happened —
      never a canned paragraph that claims a narrower gap than the run has:

      > Built from: <sources>. Missing from it: <gaps>.

      `<sources>` names only what ran: `the app's code`, `the live
      click-through`, `issue #<N>'s sub-issues`. `<gaps>` is every clause
      that applies:

      | When | Gap clause |
      |---|---|
      | The crawl did not run | anything reachable only by using the app — a journey with no distinct route, a state behind a modal — and name why: a failed precondition (`base-url`, `auth-state`, `blocklist`), the human's answer, or the MCP tools being unreachable once dispatched |
      | The crawl ran | anything past the 4-click depth cap from a route, anything behind a submitted form, a dismissed dialog, or a control on the blocklist — the crawl never touches those |
      | An issue was given | a sub-issue whose description named no candidate path |

      There is always at least one gap, a successful crawl included. A list
      presented as complete is the one thing this step may never do.

      Either way, name which candidates came from which source when more
      than one is in play (e.g. tag each entry `_Source: code_`, `_Source:
      crawl_`, `_Source: code, crawl_` or `_Source: issue #341_`), so
      approving the list is an informed decision about where each entry's
      evidence actually comes from — not just about whether it sounds
      plausible.

      ```markdown
      # Candidate user paths — <target repo>

      Built from code only (see the note above). 30 of 40 shown.

      - [ ] `checkout` — guest buys a product end to end
        _Area: payments_
        _Source: code_
        _Evidence: app/(shop)/checkout/page.tsx, lib/stripe/session.ts_
      - [ ] `auth` — a new user signs up, signs out, signs back in
        _Area: auth_
        _Source: code_
        _Evidence: app/(auth)/sign-up/page.tsx, lib/auth/config.ts_
      ```

      Ask which paths get a whole-path test now, and say plainly that they
      can add a path no candidate named — that is the step where knowledge
      no machine has enters the list.

   5. **Approval gate.** Finalize only on a clear affirmative naming which
      paths are in. Anything else — a specific change, an ambiguous reply,
      no reply yet — is feedback: revise and present again. There is no
      route from an unconfirmed list to a written file.

      **No file gets the `.smoke.` infix without a human having picked its
      path here.** Step 4 passes `smoke: true` for exactly the checked
      candidates and for nothing else.

      A human-added path is honored the same as a checked candidate, with
      one check: validate its name as plain kebab-case
      (`^[a-z0-9]+(-[a-z0-9]+)*$`) before it goes any further, since
      `write-specs.mjs` refuses anything else after approval is already
      spent.

   6. **Zero paths picked ends the run here, successfully.** Say so and
      stop — do not proceed to step 4. Steps 4's later halves boot an app
      and drive specs against it; with nothing to write, the app would boot
      for no reason and `validate-specs.mjs` would be called with no spec
      paths, which it rejects as a usage error.

      On a repeat run this is the common outcome, not a null one: `untested`
      is often empty precisely because a previous run already wrote
      everything the code scan finds. The `noSmokeTest` and `unmatched`
      buckets already reported above are the deliverable in that case — the
      audit stands on its own even when nothing new gets written.

   7. **Finalize.** Write the approved list verbatim to
      `.e2e-testing/discover-plan-<N>.md` (seeded run) or
      `.e2e-testing/discover-plan.md` (bare scan), relative to the target
      path. Then append `.e2e-testing/discover-plan*.md` to the target
      repo's `.gitignore` unless a pattern already covering it is there —
      one entry covers this run and every later one. Step 4's boot state,
      `.e2e-testing/app.log` and `.e2e-testing/app.pid`, is gitignored by
      `resolve-app-url.mjs --start` itself. Tell the human the path
      written.

      This file is read back while authoring in step 4 and by nothing
      afterwards. It is not cross-run state: no rejection is recorded in it,
      and the next run's exclusion comes from the spec directories, not from
      here.

4. **Write the whole-path tests, through the existing tail.**

   1. **Check the target actually has the smoke/granular project split
      before doing anything else.** The `.smoke.` filename only lands a
      spec in the merge-blocking project when the target's Playwright
      config has that split — writing the file is not enough on its own,
      and there is no point booting the app or verifying selectors for a
      spec that will not do its job:

      ```bash
      node scripts/check-smoke-split.mjs <target path> [--location <rel>]
      ```

      Pass `--location` when the `### E2E bindings` Location row names a
      suite outside the default `e2e/web` — it is the suite directory
      whose `playwright.config.ts` this check reads. Omit it for a suite
      at the default location.

      - `hasSplit: true` — continue to sub-step 2.
      - `hasSplit: false`, `configPath` present — **stop.** A config exists
        but has no smoke project; point at it and say to add a `-smoke`
        project per browser with `testMatch`/`testIgnore` on the smoke
        pattern (the `e2e-setup` skill's own message for this, in
        `scaffold.mjs`'s `noteUnsplitConfig`), or to scaffold a fresh
        `e2e/web` to get one generated.
      - `hasSplit: false`, `configPath: null` — **stop.** No Playwright
        config exists at all; point at the `e2e-setup` skill.

   2. **Boot the app, or attach to it if it is already running.**

      ```bash
      node ../generate/scripts/resolve-app-url.mjs <target path> [--suite-location <rel>] [--location <rel>]
      ```

      Pass `--suite-location` when the `### E2E bindings` Location row names a
      suite outside the default `e2e/web` — it is where the suite's `.env`
      (and so `E2E_BASE_URL`) lives, read regardless of which app directory
      boots. This is a different flag from `--location`, which names the app
      directory whose start script boots the app: pass `--location` only if
      the **human** gave one. Step 0's derived answer is not forwarded, because
      a web-signalled child with no start script of its own would report
      `no-start-command` where the repo root could have booted it. Both
      resolvers narrow candidates the same way, so they agree on the app
      wherever both can answer.

      Read the status and act on it exactly as `generate`'s step 4 does:
      `"running"` reuse the URL and remember that the app belongs to the
      human; `"no-base-url"` stop and ask for `E2E_BASE_URL`;
      `"not-running"` re-run with `--start`, then handle `"booted"`
      (record the pid), `"timeout"` (stop, show `logTail`),
      `"deps-missing"` (stop and tell the human to install dependencies
      first, naming `dir` and `packageManager`, then rerun),
      `"no-start-command"` (stop and ask), `"ambiguous"` (present
      `candidates`, re-run with `--location`).

   3. **Verify each path's selectors live, then author its spec.**

      First, resolve which storage state *this run's* target should verify
      against, the same way `generate` does — the bundled server runs with
      `--caps=storage`, so that tool is available:

      ```bash
      node ../generate/scripts/resolve-storage-state.mjs <target path> [--location <rel>]
      ```

      Pass `--location` when the `### E2E bindings` Location row names a suite
      outside the default `e2e/web`, so the saved login resolves under the
      configured suite dir. Omit it for a suite at the default location.

      It prints `{ loaded, filename }`. `filename` is the target's own
      `<location>/.auth/user.json` (written by `setup`) when it exists
      (`{"loaded": true}`), or an empty logged-out state the script writes
      into the target's `<location>/.auth/logged-out.json` when it does not
      (`{"loaded": false}`) — always inside the target's roots, never the
      plugin cache, which the MCP would reject. It reads only the given
      target, so a
      `[target path]` other than the session workspace can never pick up
      the workspace's own auth. Call `browser_set_storage_state` with that
      `filename` before the first navigation — it clears any existing
      cookies and storage, then restores from the file.

      Then, using the Playwright MCP tools bundled with this plugin, walk
      the path in the browser and confirm every selector the spec is about
      to reference actually resolves. With `{"loaded": true}` verification
      starts logged in against authenticated pages with no manual login
      step; with `{"loaded": false}` it starts logged out — either way,
      this holds whether `[target path]` is the repo you are working in or
      a different one. If the MCP tools are not reachable at all, **stop
      and report it** — writing the spec from static source alone is the
      exact failure this step exists to prevent.

      **Walk it at every viewport class the suite runs.** The MCP browser
      opens at one size of its own, and the suite runs every project, so a
      sidebar a phone collapses passes here and fails there.
      Read the classes once per run, before the first path:

      ```bash
      node scripts/list-viewports.mjs <target path> [--location <rel>]
      ```

      Pass `--location` when the `### E2E bindings` Location row names a
      suite outside the default `e2e/web`. It names the directory holding
      `@playwright/test`, as for `run-specs.mjs`, and after normal setup
      that is the suite directory.

      The script runs `playwright test --list` with a reporter of its own,
      so each size is the one Playwright resolved for that project, with
      the config-level `use`, device spreads and variables already merged.
      It prints `{ status, location, classes, unclassified }`. `classes`
      holds one `{ class, project, width, height }` per class the projects
      cover, in the order `desktop`, `tablet`, `phone`. For each class,
      `desktop` first, call `browser_resize` with its `width` and `height`,
      walk the path, and confirm the same selectors resolve. The MCP
      browser's own size matches no project, so the desktop walk runs at
      the `desktop` entry's size too.

      - Every selector resolves at every class: author the spec as is.
      - A selector fails at a narrow class: ask the human one question for
        that path, naming the class, the project, and the selector that
        failed. Record the answer before authoring:
        - **Cover it.** Explore the narrow layout at that size and find the
          control that reaches the same place, such as a menu toggle. Write
          locators that resolve at both layouts, following
          `playwright-testing-patterns`: `.or()` for variants that never
          share the DOM, or the toggle opened when it is visible. Walk the
          path again at every class before authoring.
        - **Desktop-only.** The spec carries
          `test.skip(({ isMobile, viewport }) => isMobile || (viewport?.width ?? 1280) < 1024, 'desktop-only path, chosen at discover');`
          at file level, above its `test()`. The condition is the one
          `list-viewports` classes by: a mobile project, or one narrower
          than 1024px. So the path runs on desktop projects only. Copy the
          reason string exactly: `run-specs.mjs` matches it, and leaves those
          skips out of the result while a desktop project of the spec ran.
      - `unclassified` names a project with viewport emulation off
        (`viewport: null`), whose size is the window's and has none to
        resize to. Tell the human that path was not checked at that
        project's size.
      - `no-playwright`, `ambiguous` (present `candidates` and re-run with
        `--location`), `error` (show `stderr`, where a config that failed
        to load says why), or an empty `classes`: stop and report it, as
        for the MCP tools being unreachable. An empty `classes` means no
        project has a size to check.

      **Record each walk as it happens.** The record travels in sub-step
      6's payload as `viewportWalk`, and that sub-step checks it before
      any spec is written, so a class left unwalked stops the run. Keep
      one entry per path, and add a class to it only after its walk at
      that class ends:

      ```json
      "viewportWalk": [
        { "path": "checkout", "walks": [
          { "class": "desktop", "result": "resolved" },
          { "class": "phone", "result": "covered" } ] },
        { "path": "admin-reports", "desktopOnly": true, "walks": [
          { "class": "desktop", "result": "resolved" } ] } ]
      ```

      `path` is the path's name, the `flowId` its cases get. `result` is
      `resolved` when the selectors resolved as written, `covered` when
      the human chose to cover a narrow layout and the re-walk resolved.
      `"desktopOnly": true` records the human's desktop-only answer, and
      that path needs a `desktop` entry only.

      A resize changes the window size only. It sets neither `isMobile`, a
      touch screen, nor the user agent, so an app that picks its layout from
      the user agent looks the same at every size here. Sub-step 8 runs
      every project, and that run catches it, except on the projects a
      desktop-only path skips. Those were left out by the human's choice,
      so nothing checks that path there.

      **Decide the spec structure before the first path.** Read the
      `Convention` row of the `### E2E bindings` section in the target's
      bindings file (`resolveBindingsFile` in
      `../e2e-setup/scripts/bindings.mjs`). `generate` reads the same row by
      the same rules, so both skills write one style into the suite:

      - Row present (`pom` or `flat`): obey it. `pom` means Page Objects,
        `flat` means self-contained specs. Never ask.
      - `--pom` or `--no-pom` passed to this run: use that value, overriding
        any stored row, and record it. The flip applies to the specs this
        run writes and leaves existing specs alone.
      - Row absent and no flag: ask the human one question. Should specs
        use shared **Page Objects**, a `selectors`/`page`/`assertion` split
        under `pages/`, or be **self-contained**? A non-interactive run
        defaults to self-contained.

      Record a flag or an answer by upserting the row
      (`| Convention | \`pom\` |` or `| Convention | \`flat\` |`) into the
      `### E2E bindings` section: update an existing row in place, and add
      the section with this row when it is missing. The agent performs the
      upsert directly, with no script.

      Author by that decision:

      - **`pom`.** Keep sub-step 4's shape, one journey per spec, and move
        its locators and assertions into page objects. For each page or
        component a path crosses, write the three-file split from
        `playwright-testing-patterns`, "Page Object Model, split by
        responsibility", in a folder named by its "Page Object folders"
        rule: `pages/<page>/<page>.selectors.<ext>`,
        `pages/<page>/<page>.page.<ext>` (extending `BasePage` from
        `../base.page`, which sub-step 6 writes) and
        `pages/<page>/<page>.assertion.<ext>`, with each assertion method
        named like a matcher (`toBeLoaded`). `<ext>` is the suite's
        language, the one `write-specs.mjs` gives the specs; in a `js` suite
        write plain JavaScript with no type syntax. A page whose folder
        already exists is the suite's own: read its files, add a missing
        selector, action or assertion to them directly, and send only new
        pages in sub-step 6's `pageObjects`. Wire each page object into
        `fixtures/base.ts`, which the scaffold writes in every suite
        language, at the
        `// Generated page objects and fixtures plug in here.` seam,
        importing `../pages/<page>/<page>.page`, so the spec receives it as
        a fixture and reads as intent. Stop before authoring when the seam
        is not there:

        - `fixtures/base.ts` is missing: the scaffold skips it when an
          existing `fixtures/login.ts` exports no `login`. Point at the
          `e2e-setup` skill, whose re-run names that cause.
        - `fixtures/base.ts` exists without the seam line: the suite owns
          that file, and a setup re-run leaves it as it is. Name the file
          and ask the human where the page-object fixtures go.
      - **`flat`.** Write self-contained specs, as sub-step 4 shows.

      **REQUIRED SUB-SKILL:** invoke
      `apptension-e2e-testing:playwright-testing-patterns` before writing
      spec content and follow its selector and async-handling conventions.
      Do not rely on description-match to load it.

   4. **One `test()` per path.** A whole-path test walks an entire journey
      with several assertions along the way. It is not a collection of
      single-behaviour tests: a smoke run made of thirty granular tests is
      a small regression run, and it will flake like one.

      ```typescript
      import { test, expect } from '../../fixtures/base';

      test('a guest buys a product and reaches the confirmation', async ({ page }) => {
        await page.goto('/');

        await page.getByRole('link', { name: 'Espresso blend' }).click();
        await expect(page.getByRole('heading', { name: 'Espresso blend' })).toBeVisible();

        await page.getByRole('button', { name: 'Add to cart' }).click();
        await expect(page.getByTestId('cart-count')).toHaveText('1');

        await page.getByRole('link', { name: 'Checkout' }).click();
        await page.getByLabel('Email').fill(`guest-${crypto.randomUUID()}@example.test`);
        await page.getByLabel('Card number').fill('4242424242424242');
        await page.getByRole('button', { name: 'Pay' }).click();

        await expect(page.getByRole('heading', { name: 'Order confirmed' })).toBeVisible();
        await expect(page.getByTestId('order-number')).not.toBeEmpty();
      });
      ```

      Four assertions, one journey, one `test()`. Contrast the shape this
      is **not**: `test('add to cart increments the counter')`,
      `test('checkout shows the email field')`,
      `test('paying shows a confirmation')` — three tests that each boot a
      browser and none of which proves the journey holds together.

      In a `pom` suite the same journey takes its page objects as fixtures,
      and the page objects carry every locator and assertion:

      ```typescript
      import { test } from '../../fixtures/base';

      test('a guest buys a product and reaches the confirmation', async ({ catalog, product, checkout }) => {
        await catalog.goto();
        await catalog.openProduct('Espresso blend');
        await product.assert.toShowProduct('Espresso blend');

        await product.addToCart();
        await product.assert.toHaveCartCount(1);

        await checkout.payAsGuest(`guest-${crypto.randomUUID()}@example.test`, '4242424242424242');
        await checkout.assert.toShowConfirmation();
      });
      ```

      Still one journey and one `test()`, and no locator in the spec.

      Both examples import `test` from the suite's base fixture. The one
      `e2e-setup` scaffolds attaches page-error and console listeners to
      every test, and a suite's own fixture carries whatever it defines. The
      import is relative from the spec's own directory to
      `<location>/fixtures/base`. `../../fixtures/base` fits the default
      `specs/<flow>/` layout. Count the levels again when the suite's
      `testDir` nests deeper. A `flat` suite whose own fixture lives
      somewhere else imports from that file. Only a suite with no fixture
      at all imports `test` and `expect` from `@playwright/test`, as
      `playwright-testing-patterns` describes.

   5. **Test data has a home already.** A path that needs data must not
      depend on a row that happens to sit in the database on the machine
      the spec was generated on.

      - Data one case owns: create it inside the test, named with
        `crypto.randomUUID()` rather than a `Date.now()` timestamp, which
        collides under parallel workers.
      - Data no single case owns — the account `auth.setup.ts` logs in as,
        reference data the app needs before any page renders — goes in
        `e2e/web/global-setup.ts`, the no-op hook `e2e-setup` scaffolds for
        exactly this. Seed it there and undo it from the teardown function
        that hook returns. Never wipe a database the suite does not own.

   6. **Write the specs.**

      First check the payload below, carrying sub-step 3's record as
      `viewportWalk`:

      ```bash
      echo '<payload>' | node scripts/check-viewport-walk.mjs <target path> [--location <rel>]
      ```

      Pass `--location` exactly as for `list-viewports.mjs`. The script
      reads the classes from the suite itself and the paths from the
      cases' `flowId`s, so every path about to be written is checked
      against every class the suite runs. `write-specs.mjs` ignores
      `viewportWalk`, so the same payload goes to both scripts.

      - `ok`: write the specs with this same payload.
      - `incomplete`: **stop before writing.** `missing` names each path
        and class with no walk, with the `width` and `height` to resize
        to. A case the record leaves out appears there at every class.
        `invalid` names each malformed entry, and each entry for a path
        no case writes. Walk each missing class as sub-step 3 does,
        correct the record, and run the check again.
      - `no-classes`, `no-playwright`, `ambiguous` or `error`: stop and
        report it, as sub-step 3 does for `list-viewports.mjs`.

      Then write:

      ```bash
      echo '<payload>' | node ../generate/scripts/write-specs.mjs <target path> [--location <rel>]
      ```

      Pass `--location` whenever the `### E2E bindings` Location row exists,
      `e2e/web` included, so approved specs land in the suite's resolved spec
      dir — its own `playwright.config` `testDir` when that names a
      sub-directory, else `<location>/specs` — and page objects under
      `<location>/pages/<page>/`. With the row absent, omit it: the spec dir then
      follows the Playwright config's `testDir`, or `<config dir>/specs` when
      the config names none, landing on `e2e/specs` only when no usable
      Playwright config is found, and page objects fall back to
      `e2e/web/pages/<page>/`.

      Payload for a bare scan:

      ```json
      {
        "origin": "discover",
        "cases": [
          { "flowId": "checkout", "slug": "guest-buys-product", "smoke": true, "title": "…", "content": "…" }
        ],
        "viewportWalk": [ { "path": "checkout", "walks": [ … ] } ]
      }
      ```

      In a `pom` suite, add the new page objects as `pageObjects`, one entry
      per file:

      ```json
      {
        "origin": "discover",
        "cases": [
          { "flowId": "checkout", "slug": "guest-buys-product", "smoke": true, "title": "…", "content": "…" }
        ],
        "viewportWalk": [ { "path": "checkout", "walks": [ … ] } ],
        "pageObjects": [
          { "page": "checkout", "role": "selectors", "content": "…" },
          { "page": "checkout", "role": "page", "content": "…" },
          { "page": "checkout", "role": "assertion", "content": "…" }
        ]
      }
      ```

      The script writes each entry verbatim to
      `<pagesDir>/<page>/<page>.<role>.<ext>`. A payload carrying
      `pageObjects` also writes `<pagesDir>/base.page.<ext>` when the suite
      has none. A `flat` suite omits `pageObjects`.

      For a seeded run, send `"ticket": <issue number>` instead of
      `"origin"` — **exactly one of the two, never both.** `ticket` stamps
      `// issue:<N>` as the spec's first line; `origin` stamps
      `// discover`. That line is the committed record of which run produced
      the file.

      `"smoke": true` is what produces the `.smoke.spec.<ext>` filename,
      and therefore what puts the spec in the merge-blocking Playwright
      project. Send it for every case here and only for paths a human
      checked at step 3.

      `<target path>` is the **repo root**, never the `e2e/web`
      sub-package — the script refuses that outright rather than writing to
      a doubled path.

      Read the `results` array. Report any entry whose `result` starts with
      `refused-`:

      | `result` | Meaning |
      |---|---|
      | `refused-invalid-slug` | The `flowId` or `slug` is not a plain kebab-case component. Nothing was written; re-run with a corrected value. |
      | `refused-invalid-smoke` | The `smoke` flag wasn't a boolean, or wasn't `true` on a discover-origin case (every case here must be `true`). A caller bug, not a human decision — fix the payload. |
      | `refused-exists` | A file already sits at that path. The script never overwrites and there is no flag that makes it. Present the path and stop. |

      Read `pageObjectResults` the same way when the payload carried
      `pageObjects`. `exists` means the suite already has that page object:
      the script leaves it as it is, and the spec uses it.
      `refused-invalid-page` or `refused-invalid-role` mean a malformed
      entry, and nothing was written for it; fix the entry and re-run.
      `basePage` is `created` on the run that wrote the base class and
      `exists` otherwise.

   7. **Validate before running.**

      ```bash
      node ../generate/scripts/validate-specs.mjs <target path> <spec path>… [--location <rel>]
      ```

      `--location` here names the directory holding `@playwright/test`, not
      the app — after normal setup, `e2e/web`. Pass the `### E2E bindings`
      Location row as `--location` when the row exists. Without the row,
      omit it and the script finds that location itself. Never pass step 0's
      app location: the script would report `no-playwright` and nothing
      would be validated.

      Spec paths are the `specPath` of every non-refused entry above.

      A clean listing is followed by the suite's own `typecheck` script,
      once, when the suite has a `tsconfig.json` and that script and is
      not the repo root.
      Playwright strips types without checking them, so a spec with a type
      error loads cleanly under `--list`. The typecheck is what fails it.

      Read `status` first. `validated` carries `results`. Any other status
      is a report-level stop that carries no `results`, and **stops here**:

      | `status` | Present |
      |---|---|
      | `no-playwright` | That the Location row's directory has no `@playwright/test` installed, or, with no row, that no location in the target repo has it. Point the human at the `e2e-setup` skill, or at the Location row when it names the wrong directory |
      | `ambiguous` | `candidates` and the spec paths verbatim. It arises only with no Location row: each candidate has Playwright and none contains the written specs. Point the human at the `e2e-setup` skill |
      | `error` | `message` verbatim. It also covers a missing package-manager binary. An empty spec-path list means sub-step 6 wrote no spec: present sub-step 6's report with it, as a fault in this run |

      Apart from an empty spec-path list, each is an infrastructure fault
      and not a broken spec, and a second invocation returns the same
      status. Present it once, then run
      sub-step 9. An empty spec-path list ends the run there, with sub-step
      6's report. Otherwise the written specs stay on disk, and a fresh
      `discover` run would stop on them as `refused-exists`. So once the
      human reports the cause fixed, resume: boot the app as sub-step 2
      does, then run sub-steps 7 to 9 over the same spec paths.

      Read `results`. Each entry's `result` is one of:

      | `result` | Meaning |
      |---|---|
      | `valid` | The spec compiled, its imports resolved, and it appeared in the listing. On a listing that failed on another spec, `valid` means only that no error was traced to this one |
      | `invalid` | The spec failed to load (syntax error or bad import), or the typecheck named it; `error` carries the failure, or the spec's `tsc` lines. When `--list` fails with output that names no spec, every spec it ran on is `invalid` with that same `error`, and the report carries `stderrTail` |
      | `not-listed` | The spec loaded but the runner listed no test for it, excluded by the repo's `testMatch`/`testIgnore` or defining no test, so it would resurface as `not-run` in sub-step 8 |
      | `missing` | The given path has no file on disk |

      Read `typecheck` too, present whenever the listing was clean:

      | `typecheck.status` | Meaning |
      |---|---|
      | `passed` | The suite type-checks |
      | `failed` | `tsc` reported errors. A requested spec's errors are on its entry as `invalid`. `otherFiles` lists errors in any other file, such as a page object, as `{ file, error }` |
      | `error` | The script failed without a `tsc` diagnostic, for example `tsc` is not installed; `message` carries the output |
      | `skipped` | No suite `tsconfig.json`, no `typecheck` script, or the suite is the repo root; `reason` says which |

      - **Every entry `valid`, and `typecheck.status` is `passed` or
        `skipped`**: read `lint` below.
      - **Any entry not `valid`, or `typecheck.status` is `failed` or
        `error`**: **stop here.** Present each such entry's `specPath`
        and `result`, plus its `error` **verbatim** on an `invalid` entry,
        the only kind that carries one. Then present each `otherFiles` entry's
        `file` and `error`, or the typecheck `message`, verbatim, plus a
        report-wide `stderrTail` when present. `stderrTail` comes with
        every failed listing. When every entry that is not `missing` is
        `invalid` with one identical `error`, the runner may have failed
        rather than any spec, for example on a Playwright config or
        install error, so say that rather than naming those specs as
        broken. Then run sub-step 9.

      Once that gate passes, read `lint`. The suite's own linter ran over
      the requested specs: ESLint when the suite has a flat ESLint config,
      Biome when it has a `biome.json` or `biome.jsonc` and no flat ESLint
      config.

      | `lint.status` | Meaning |
      |---|---|
      | `passed` | No findings |
      | `findings` | `findings` lists each one as `{ file, line, ruleId, severity, message }` |
      | `error` | The linter printed no JSON report, for example a config that fails to load; `message` carries the output |
      | `skipped` | The suite has neither a flat ESLint config nor a Biome config; `reason` says so |

      A missing-assertion finding also carries `cause`, read from the
      flagged test's body. Its `ruleId` is `playwright/expect-expect` under
      ESLint and `plugin/expect-assertion` under Biome. Route it by that
      `cause`:

      - **`misnamed-assertion`**: the test calls `<page>.assert.<name>()`
        with a `<name>` outside `^to[A-Z]`, and `methods` lists those
        names, such as `["loaded"]`. Rename each method in
        `pages/<page>/<page>.assertion.<ext>`, where `<ext>` is the extension of the
        spec file, to a matcher-style name (`toBeLoaded`) and
        update every call site under the suite, then run
        `validate-specs.mjs` again over the same spec paths. **One
        attempt.** If the second report still carries a missing-assertion
        finding, or fails the gate above, stop, present that finding or
        that gate failure verbatim, and run sub-step 9.
      - **`no-assertion`**: the test makes no `.assert.` call. Stop.
        Present the finding's `file`, `line` and `message` verbatim, then
        run sub-step 9.

      Every other finding, and a `lint.status` of `error`, continues to
      sub-step 8 and goes verbatim in the report the run ends on, however
      sub-step 8 ends it. `skipped` needs no mention.

      The misnamed-assertion rename is the only edit this sub-step makes.
      Every other stop leaves the spec as written for the human to act on.

   8. **Run them and gate on the result.**

      ```bash
      node ../generate/scripts/run-specs.mjs <target path> <spec path>… [--location <rel>]
      ```

      `--location` means the Playwright package here too, and comes from
      the same Location row exactly as in sub-step 7.

      Read `status` first. `ran` carries `results`. Any other status is a
      report-level stop that carries no `results`, and **stops here**:

      | `status` | Present |
      |---|---|
      | `no-playwright` | That the Location row's directory has no `@playwright/test` installed, or, with no row, that no location in the target repo has it. Point the human at the `e2e-setup` skill, or at the Location row when it names the wrong directory |
      | `ambiguous` | `candidates` and the spec paths verbatim. It arises only with no Location row: each candidate has Playwright and none contains the written specs. Point the human at the `e2e-setup` skill |
      | `report-unreadable` | `stderrTail` verbatim. The runner wrote no parseable JSON report, usually from a Playwright config or install problem |
      | `timed-out` | `message` and `stderrTail` verbatim. The run passed its wall-clock ceiling, which `message` names, and was killed |
      | `error` | `message` verbatim. An empty spec-path list means sub-step 6 wrote no spec: present sub-step 6's report with it, as a fault in this run |

      As in sub-step 7, present it once, then run sub-step 9, and resume
      the same way once the human reports the cause fixed.

      Every entry `passed` finishes normally. Anything else — `failed`,
      `flaky`, `skipped`, `missing`, `not-run` — **stops here**, presented
      with its `specPath` and `result`, plus the report's `htmlReport` path
      once when the result carries one; a run where every spec is `missing`
      ran nothing and carries none. A `failed`, `flaky` or `skipped` entry also carries
      `failureCount` and a `failures` list, presented verbatim; a `missing`
      or `not-run` entry carries neither. Each `failures` entry is one test
      failing one way: its `title`, `location`, `error`, and the `projects`
      it failed on, so a spec failing identically on eight projects is one
      entry naming all eight. Present every entry with its projects. An
      entry may carry `artifacts` (paths, each tagged with its `project`),
      `networkFailures` (responses of status 400 or more, each with method,
      URL, and status), `appLog` (the boot-log lines the app wrote while
      the case ran, captured only on a single-worker run) and
      `sessionExpired` (`{ authMode, hint }`, set when the test started
      logged in and ended on the `E2E_LOGIN_URL` page; surface its `hint`
      verbatim). `networkFailures`, `appLog` and `sessionExpired` come from
      the first project listed, and each key is absent when there was
      nothing to report.

      Do not diagnose whether a failure is a bad test or a real bug it
      caught, and do not regenerate, edit, or re-run it. Those two cases
      have opposite correct responses and the plugin cannot tell them
      apart. Presenting the result is the whole of this step's job.

   9. **Stop the app this run started**, on **every** exit path including
      the ones that stop for the human:

      ```bash
      node ../generate/scripts/resolve-app-url.mjs <target path> --stop  # e2e-location-default
      ```

      `"not-running"` means this run never started an app — the expected
      result when sub-step 2 attached to one the human was already running.
      It is not an error and not a reason to go looking by other means.

      **Never kill by pattern.** No `pkill`, `killall`,
      `kill $(lsof -ti:<port>)`, or anything else that selects a process by
      name, command line, or port. `--stop` acts only on the pid `--start`
      recorded, and nothing here may widen that.

## Why the candidate list is capped, and capped visibly

Thirty is a list someone reads. Sixty is a list someone clicks through
without reading, which produces a set of approved paths nobody actually
judged — the same failure as no review at all, with a record that says
otherwise. The cap protects the review, so it is stated rather than applied
quietly: a human who knows 16 candidates were dropped can ask for them, and
one who doesn't can't.

## Why importance is not inferred

The code says what exists, not what matters. A checkout route and a footer
link are the same shape of thing to a parser, and a heuristic that ranked
them would be guessing with a confident voice. Ordering by area (`auth`,
`payments`, `guarded`, `public`) is as far as the code's hint goes; every
decision past that point is the human's at step 3.

## Why no state is stored between runs

A rejection file would have to be maintained, would go stale the moment the
app changed, and would silently hide a path someone rejected six months ago
for reasons that no longer hold. Comparing against the directories under the
spec dir needs no maintenance and is self-correcting: a path with a test
drops out, and a path without one comes back. A re-proposal of a genuinely
untested path is a reminder, not noise.

## Why the blocklist is not the crawl's first line of defence

The bundled MCP server does not know these patterns. They reach the crawl
sub-agent as text in its prompt, and it is the sub-agent that applies them —
there is no tool-layer interception that could refuse a click.

So the structural rules are the bound that actually holds: no form is ever
submitted, no dialog is ever accepted, nothing off-origin is followed. Those
are shaped so that the destructive actions worth worrying about are mostly
unreachable regardless of naming. The blocklist is the second layer, for the
irreversible control that is a plain button — and a design that leaned on it
alone would be claiming an enforcement it does not have.

## Why the environment confirmation is never inferred

`localhost` is someone's machine pointed at a shared staging database about
as often as it is a throwaway container. `staging` is a name, not a
guarantee about whose data is behind it. Any rule that read the URL would be
right most of the time, and the times it was wrong would be the expensive
ones — which is the shape of heuristic that gets trusted right up until it
deletes something.

Asking costs one sentence per run and stores nothing, so it cannot go stale
when `E2E_BASE_URL` changes to point somewhere else.

## Why this is a separate skill from `generate`

`generate` answers "which behaviors in this ticket need a browser". This
answers "which journeys in this app deserve a merge-blocking test". They
differ in input (a diff versus an app), in output (one behaviour per spec
versus one journey per spec), in which Playwright project the result lands
in, and in who supplies the judgement. Folding them together would mean one
approval gate deciding two unrelated questions.
