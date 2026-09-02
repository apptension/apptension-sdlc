---
name: generate
description: Gather an issue's ticket body, code diff, and unit tests as context, judge which user-facing behaviors need a browser to exercise end to end, then draft a human-approved test plan from those. Takes a ticket reference by shape — a GitHub issue number, a GitHub or Jira URL, a Jira key, or a user path — plus an optional [target path]. Trigger on intent like "which behaviors in issue N need an E2E test", "gather e2e test context for issue N", "draft a test plan for issue N", or "/apptension-e2e-testing:generate".
argument-hint: "<issue number | URL | JIRA-KEY | user-path> [target path]"
---

# Generate E2E Tests

Gathers everything the E2E test-case generation methodology needs, scoped
to one issue at a time — never the whole repo — then judges which
user-facing behaviors need a browser to exercise end to end, drafts a
human-approved test plan from those, generates Playwright specs with live
selector verification, writes them to disk, and runs them — stopping for
the human on anything that is not a clean pass.

Paths below are relative to this skill's own directory.

## Argument by shape

The argument arrives as `$0` (`$ARGUMENTS` holds the full string, including
any target path). Classify its shape first — nothing else infers it:

    node scripts/classify-argument.mjs "$0"

It prints `{ kind, value, tracker }`. Route on `kind`:

| Shape | `kind` | What it means | Action |
|---|---|---|---|
| digits only | `github` | GitHub issue number | Gather context for that number (step 1). |
| a URL | `github`/`jira` | number or key extracted from the path | Route as that tracker; a URL matching neither is `unusable`. For a `github` URL, when the classifier returns `owner`/`repo`, confirm they match the target repo (`gh repo view --json nameWithOwner` against the target path) before fetching; on mismatch, **stop** and report that the URL points at a different repository — never fetch the same number from the current repo. A bare number carries no `owner`/`repo` and is treated as the current repo as before. For a `jira` URL, when the classifier returns `host`, confirm it is the configured Atlassian instance (the one the Atlassian MCP is connected to) before fetching; on mismatch, **stop** and report that the URL points at a different Jira instance — never fetch the same key from the configured instance. A bare Jira key carries no `host` and is treated as the configured instance as before. |
| `UPPER-123` | `jira` | Jira key | Fetch the ticket and its children over the Atlassian MCP (below). |
| `lower-kebab-case` | `user-path` | a directory under the spec dir | **Stop.** User-path targeting is recognised but not implemented yet — say so and stop. |
| absent | `absent` | nothing was passed | **Stop** and tell the user this skill needs a ticket reference. |
| none of these | `unusable` | e.g. a URL resolving to neither a number nor a key | **Stop** and report the argument as unusable — never guess a ticket from it. |

The sets are disjoint: a user path is lowercase kebab-case with at least one
letter, so it never looks like a number or a Jira key.

**Never infer the ticket** from the current branch, the latest commit, or an
open pull request — a wrong ticket silently generates specs for the wrong
change, and review will not catch it because the files look reasonable. An
absent argument is a stop, not a cue to go looking.

### Jira tickets go through the MCP

`gather-context.mjs` speaks `gh` and `git` only, so it never reaches Jira.
For a `jira` argument, fetch the ticket body over the Atlassian MCP and
compute the local diff the same way the script does (a local `git diff`
against the base branch is tracker-agnostic). There is no GitHub PR fallback
for a Jira key. Ticket fetch, classification, the test plan, no-diff
routing, and spec *writing* all work for Jira: pass the Jira key as the
`ticket` in step 6's `write-specs.mjs` payload (e.g. `"ticket": "ABC-123"`)
the same way a GitHub number is passed, and every generated spec carries it
in its `// issue:<ticket>` provenance line.

## Steps

1. Run the gathering script against the issue and target repo (default:
   the current repo):

   ```bash
   node scripts/gather-context.mjs <issue number> [target path]
   ```

   Read the JSON it prints:

   - `ticketBody` — the issue's description and acceptance criteria,
     including its `## Testing guide` section if one is attached. Never
     fetched separately.
   - `diffSource` — `"git"` (a local diff against the detected base
     branch), `"gh-pr"` (fell back to the issue's linked pull request,
     because there was no local diff to read), or `"none"` (neither
     source had anything — route it per "Routing a ticket with no diff,"
     rather than stopping).
   - `branch` / `base` — the branch the diff was actually taken on, and
     the base branch it was compared against (`null` when no local diff
     was attempted). Sanity-check these against the issue you're
     actually working: if `branch` or `base` don't look like they belong
     to this issue, don't trust `diffSource: "git"` at face value — it
     only means *some* local diff was found, not that it's the right
     one. Prefer the PR fallback, or ask the human, instead of guessing.
   - `changedFiles` — every file the issue's diff touched.
   - `testFiles` — the subset of `changedFiles` matching a unit-test
     naming convention (`*.test.*`, `*.spec.*`, `__tests__/`,
     `test_*.py`, `*_test.py`, `_test.go`, `_spec.rb`), with their
     current contents. Read them for what they teach about the change:
     the domain vocabulary the team actually uses, the business rules
     spelled out as assertions, and the edge cases whoever wrote them
     had already thought of. They are material for writing a better
     plan, never a filter on it — nothing in this skill drops a case
     because a unit test exists. Empty when the diff changed no test
     files — read that as "zero unit tests in this diff," not as a
     missing or failed step, and not as a signal about coverage.

     **Only trust these contents on `diffSource: "git"`.** The script
     reads them from the local checkout, and the `"gh-pr"` path is
     reached precisely because that checkout has no diff against base —
     so a test the PR *added* is missing from `testFiles` entirely
     (filtered out as a nonexistent path, silently), and one it
     *modified* comes back with the base branch's contents. On that path
     read the changed tests from the PR instead — `gh pr diff` has no
     pathspec argument, so isolate one file's hunk through the files API:

     ```bash
     gh api repos/{owner}/{repo}/pulls/<PR#>/files --jq '.[] | select(.filename=="<path>") | .patch'
     ```

     A diff is the better source there anyway: it shows the assertions
     this issue added, which is what sub-step 1 needs, rather than the
     whole file's worth of pre-existing ones.

### Routing a ticket with no diff

`diffSource: "none"` is not a dead end. Nobody commits code to an epic, so a
ticket with no diff is either an epic waiting to be broken down or a task
before its first commit. Tell them apart by whether the ticket has children —
this is the one discriminator, and it is the same for both trackers:

- `hasChildren === true` → propose `discover <ticket>` rather than
  stopping — the ticket's own reference (a GitHub number or a Jira key,
  whichever this ticket is). The human runs `discover` to break the epic
  down.
- `hasChildren === false` → ask the human, because it may be a task before
  its first commit. Do not proceed and do not guess.
- `hasChildren === null` (the sub-issue lookup failed — a transient `gh`/API/
  permission error) → **stop** and tell the human the child check could not
  complete; do not treat it as "no children" and do not guess. Re-running
  once is fine, but never silently route.

The child *check* differs by tracker; the rule above does not:

- GitHub: read `hasChildren` from `gather-context.mjs` — `true` | `false` |
  `null` whenever `diffSource` is `"none"`.
- Jira: query the ticket's child issues over the Atlassian MCP (an Epic's
  children, or a parent's sub-tasks). The discriminator is whether any
  children exist — not the issue type; a childless Epic routes like any
  other childless ticket.

The discriminator is the absence of a diff, never the tracker's issue type.

2. Judge which behaviors the ticket and diff introduce need a browser to
   exercise end to end. Skip this step entirely when `diffSource` is
   `"none"` and apply **Routing a ticket with no diff** instead — there is
   no diff to judge against:

   1. **Enumerate behaviors.** From `ticketBody`'s acceptance criteria,
      cross-checked against `changedFiles`, `testFiles` and the actual
      diff, list the concrete user-facing behaviors this issue
      introduces or changes. Acceptance criteria are the primary source
      but not 1:1 — split a bundled criterion into separate behaviors,
      collapse near-duplicate criteria into one, or add a behavior the
      diff shows that no criterion mentions (sourced from the diff area
      instead).

      A changed unit test is one of those diff areas, not a lesser one:
      an edge case asserted in `testFiles` and named in no criterion is
      a behavior this issue changes, so enumerate it like any other and
      let sub-step 3 judge it. Borrow the tests' vocabulary while you're
      there — a behavior worded the way the codebase words it survives
      review better than one worded from the ticket alone.

      A pure refactor with no identifiable user-facing behavior yields
      an empty list here — don't fabricate an entry to have "something"
      to report, but continue to sub-step 6: an empty list can still
      gain entries from the Testing guide.

   2. **Locate each behavior's implementation.** Identify which
      `changedFiles` implement it. Where the filename alone doesn't say
      enough, read the actual diff for that path, using the gathering
      step's own `branch`/`base`/`diffSource` (step 1, not this
      sub-step):

      ```bash
      # diffSource: "git"
      git diff origin/<base>...<branch> -- <path>
      # diffSource: "gh-pr" — gh pr diff has no pathspec argument, so
      # isolate one file's hunk through the files API instead:
      gh api repos/{owner}/{repo}/pulls/<PR#>/files --jq '.[] | select(.filename=="<path>") | .patch'
      ```

      The PR number comes from `gh issue view <N> --json
      closedByPullRequestsReferences`, the same lookup
      `gather-context.mjs` does internally.

   3. **Judge against one criterion: does exercising this behavior end
      to end cross a boundary only a browser can cross?**

      `"e2e"` — walking the behavior from the user's side has to leave
      the process the code under test runs in. Any one of these is
      enough:

      - the UI and the network together: a click or a submit that issues
        a request and renders from the response;
      - more than one page or route, including a real redirect;
      - authentication or session state: logging in, staying logged in,
        being turned away;
      - persistence: state that has to survive a reload, or be visible
        on a second page;
      - something the browser itself owns: cookies, storage, history,
        a file download or upload, a new tab.

      `"in-process"` — the whole of the behavior can be exercised
      without a page: a pure function, a reducer, a formatter, a
      validator called in isolation, a type or config change with no
      rendered consequence.

      **The presence or absence of a unit test never enters this
      judgement.** A behavior that crosses a browser boundary earns a
      case whether or not someone wrote a unit test for it — in this
      diff or anywhere else. A behavior that crosses none earns no case
      even when nothing tests it at all. The two axes are unrelated: a
      green unit test says nothing about whether a path survives a real
      browser, a real API, and a real redirect.

      Reading the code is expected here, not avoided. Where a filename
      doesn't settle which boundaries a behavior touches, read the diff
      for that path (sub-step 2) and decide from what it actually does.
      When the diff genuinely leaves it open — the behavior could be
      either, depending on wiring the diff doesn't show — record `"e2e"`
      and say why in `reason`. An unnecessary case costs the human one
      line to strike at step 3's approval gate; a missing one is
      invisible.

   4. **Record `source`** — the acceptance-criterion text the behavior
      came from, or a short diff-area description (e.g. a file or
      directory) when it has no matching criterion. A behavior taken
      from a changed unit test names that file, e.g. `"unit tests
      (Foo.test.tsx)"`.

   5. **Record `reason`** — one sentence naming the boundary crossed, or
      the reason there is none, e.g. `"submit crosses the browser: POST
      to /api/foo, then a re-render from the response"` or `"pure string
      transform in validators.ts; no page, network or persistence
      involved"`.

   6. **Merge in the Testing guide, additively only.** If `ticketBody`
      contains a `## Testing guide` section, read it for behaviors it
      flags that the steps above didn't already produce. Append each as
      a new entry with `classification: "e2e"`, `source: "Testing
      guide"`, and a `reason` summarizing what the guide said. Never use
      it to change an entry already produced above — even one the guide
      explicitly claims needs no E2E case. Skip this sub-step silently
      when there's no such section.

      `"e2e"` here is a deliberate override, not sub-step 3's judgment
      applied and happening to agree: a Testing guide entry is a human
      (or the dev-flow step that writes it) naming a behavior that needs
      E2E coverage directly, the same trust sub-step 5 already extends
      to a human's "add" request during revision. It is not re-judged
      against the boundary criterion — a guide entry for a behavior that
      turns out to be purely in-process still gets a case, on the
      strength of the guide having named it.

   7. **Output** a JSON array of `{behavior, source, classification,
      reason}`, held as context the same way the gathering step's (step
      1's) output is — no file is written by this step. Shape:

      ```json
      [
        {
          "behavior": "User can submit the form with an empty title",
          "source": "AC #2: \"empty title shows a validation error\"",
          "classification": "e2e",
          "reason": "submit crosses the browser: POST to /api/todos, then a re-render from the response"
        },
        {
          "behavior": "Title is trimmed before validation",
          "source": "AC #4",
          "classification": "in-process",
          "reason": "pure string transform in validators.ts; no page, network or persistence involved"
        }
      ]
      ```

      `classification` is always exactly `"e2e"` or `"in-process"` — no
      other values. Every enumerated behavior gets an entry, including
      the `"in-process"` ones: the record of what was considered and
      passed over is the point of judging after enumerating rather than
      while doing it. A diff with zero identifiable behaviors outputs
      `[]`.

### Playwright presence check

Skip this check entirely when step 2 was skipped (`diffSource: "none"`) or
produced no `"e2e"` entries — step 3's zero-cases path (sub-step 2) ends
the run successfully with no app or Playwright involved, and gating that
path here would stop a backend-only or pure-refactor change that never
needed either. The skip is provisional, not permanent: if revision
(sub-step 5) later gives an originally empty draft its first case, that
sub-step re-runs this same check before the revised draft goes back to the
human — see sub-step 5.

Otherwise, before step 3 drafts or presents a plan — and so before step 4
ever boots or attaches to the app — confirm the target repo actually has
Playwright installed somewhere:

```bash
node scripts/check-playwright.mjs <target path>
```

This reuses `resolveLocation` from `run-specs.mjs` instead of a second
detection. No spec paths exist yet at this point, so it runs with an empty
list — only its `no-playwright` status matters here; disambiguating
between several Playwright installs needs real spec paths, and steps 4, 7
and 8 each resolve that for themselves once those exist.

- `no-playwright` — no location in the target repo has `@playwright/test`
  installed. **Stop here**, before drafting or presenting a plan, booting
  the app, or opening the Playwright MCP. Point the human at the
  `e2e-setup` skill.
- Anything else — continue to step 3 as usual. Step 7's
  `validate-specs.mjs` call still runs its own check later, as a fallback
  for an install that changes mid-run.

3. Draft a human-approved test plan from step 2's `"e2e"` entries —
   `"in-process"` entries become no case, and do not appear in the
   draft. Skip this step and apply the no-diff routing, per step 2, when
   step 2 itself was skipped (`diffSource: "none"`) — there is no
   judgement to draft from.

   1. **Assign every case a `flowId` before it appears in the draft.**
      For each `"e2e"` entry, write one concrete test-case title
      describing the user-facing behavior to exercise end-to-end.
      Carry its `source` and `reason` forward verbatim from step 2 —
      never re-derive or reword them. Then assign the case a `flowId`:
      the name of the user path it belongs to, matched against what
      already exists rather than guessed.

      List what already exists first:

      ```bash
      node scripts/list-flows.mjs <target path>
      ```

      This resolves the spec dir the same way `write-specs.mjs` (step 6)
      actually will — through its scaffold-manifest, then
      `playwright.config.ts` `testDir`, then `e2e/specs` fallback — so the
      listing and the eventual write can't disagree about where flows
      live. It returns `{"specDir", "flows": [{"flowId", "specs":
      [...]}]}`; an empty `flows` array means no flow exists yet, not an
      error.

      Match each case against that list, reading the spec filenames as
      the product vocabulary already in use — `apply-promo-code.spec.ts`
      inside `cart` says a promo-code case belongs there, not in
      `checkout`, without opening either file. Assign the matching
      `flowId` when one fits.

      When none fits, propose a new one. Derive it from the vocabulary
      the plan itself already uses for the behavior — the case title and
      its `source`/`reason` — never from the ticket title or the current
      branch name; both name the ticket, not the user path. Validate the
      proposed name as plain kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`)
      before it goes in the draft: `write-specs.mjs` refuses anything
      else outright at step 6, after the plan is already approved, which
      would waste the approval this draft is about to ask for.

      Mark every case proposing a new path so the approval gate (sub-step
      4) can single it out — new paths are approved inside this same
      draft, never through a second question:

      ```markdown
      - [ ] <case title>
        _Flow: <flowId> (new user path)_
        _Traces to: <source>_
        _Why E2E: <reason>_
      ```

   2. **Zero cases.** If the draft ends up with no cases — step 2
      produced no `"e2e"` entries, revision (sub-step 5) dropped every
      drafted case, or every case's new-path proposal was rejected with
      no alternative — it is a single explicit statement, not an empty
      list with no explanation, worded for *why* it's empty:

      - Step 2 output `[]` (no identifiable behaviors in the diff):
        "No user-facing behaviors were identified in this diff."
      - Step 2 judged every behavior `"in-process"`: "No behavior in
        this diff crosses a boundary only a browser can cross."
      - Revision dropped every drafted case: "Every drafted E2E case
        was dropped during revision; no cases remain."
      - Every case's new-path proposal was rejected with no
        alternative: "Every drafted case's path proposal was rejected;
        no cases remain."

      ```markdown
      # Test plan — issue #<N>

      No behavior in this diff crosses a boundary only a browser can cross.
      ```

   3. **Present the draft** — including an empty-plan statement,
      which goes through this same gate, never auto-finalized or
      special-cased — as a markdown checklist, one entry per case, and
      ask the human whether anything needs to change before
      finalizing it, including every proposed new path. Never write a
      file at this point.

      ```markdown
      # Test plan — issue #<N>

      - [ ] <case title>
        _Flow: <flowId>_
        _Traces to: <source>_
        _Why E2E: <reason>_
      ```

   4. **Approval gate.** Finalize only on a clear affirmative reply
      to that question — "approved," "looks good," an explicit yes.
      That single reply also approves every new path marked in the
      draft — there is no separate gate for a new user path; it is
      approved or rejected as part of this plan, the same as any other
      line in it. Anything else — a specific change request, an
      ambiguous or partial reply, or no reply yet — is feedback, not
      approval: revise the draft and present it again, then ask again.
      There is no path from an unpresented or unconfirmed draft to a
      finalized file.

   5. **Revise per feedback, scoped to this issue.** Drop or reword
      requests are always honored. An add request is honored only
      when it traces to this issue's own diff or acceptance criteria
      (e.g., a behavior step 2 missed, or one it judged
      `"in-process"` that the human knows crosses a boundary the diff
      didn't show) — refuse an add
      request for anything else, even genuinely under-tested code
      elsewhere, with a one-line note that it belongs in its own
      issue. A request to change a case's `flowId` is a reword
      request, always honored — re-validate the replacement as plain
      kebab-case the same as sub-step 1.

      An add request that gives an originally empty draft (one that
      skipped the Playwright presence check above, because step 2 started
      with no `"e2e"` entries) its first case re-triggers that check
      before the revised draft is re-presented — the same `no-playwright`
      stop applies. It runs only this once: a later add request to a
      draft that already has a case needs no repeat, since the check
      already ran.

      Rejecting a proposed new path is its own case: when the human
      rejects it and gives no alternative `flowId`, drop that case from
      the draft entirely, with a one-line note recording why, rather
      than writing it to the rejected (or any guessed) directory. When
      they name an alternative instead, that is an ordinary reword —
      apply it and keep the case. Re-present the revised draft and
      return to the approval gate.

   6. **Finalize.** Once approved, write the draft verbatim as
      `.e2e-testing/test-plan-<issueNumber>.md`, relative to the
      target path passed to step 1's script
      (`gather-context.mjs <issue number> [target path]`). This is
      the first and only file this skill writes; nothing before this
      point persists anything to disk. Tell the human the path just
      written.

      Then keep that file out of the target repo's history: append
      `.e2e-testing/test-plan-*.md` to the target repo's `.gitignore`
      unless a pattern already covering it is there (one entry covers
      this run and every later one, so re-runs add nothing). The plan
      is a local record of what was approved — step 5 reads it back
      within this same run, and nothing reads it after that, so it
      isn't tool state the repo has to carry.

      **An approved plan with zero cases ends the run here, successfully.**
      Tell the human the empty-plan statement is the final result and stop
      — do not proceed to step 4. Steps 4-9 exist to boot an app and drive
      specs against it; with nothing to write or run, step 4 would boot the
      app for no reason, and step 7 would call `validate-specs.mjs` with no
      spec paths, which it rejects as a usage error — a confusing thing to
      surface for what is actually a normal, deliberate outcome. An
      all-`"in-process"` diff (a backend-only change, a pure refactor) is
      exactly the case this guards.

4. **Boot the app, or attach to it if it's already running.**

   ```bash
   node scripts/resolve-app-url.mjs <target path> [--location <rel>]
   ```

   The app's URL comes from `E2E_BASE_URL` — exported, or set in
   `e2e/web/.env`. Nothing infers a port from framework defaults any more,
   so there is no wrong guess to diagnose.

   - `"running"` — the app is already up. Reuse `url` and skip to step 5.
     **Do not** start a second one, and note that step 9 will have nothing
     to stop: this app belongs to the human, not to this run.
   - `"no-base-url"` — stop and ask the human to set `E2E_BASE_URL`
      (the `e2e-setup` skill prints the matching
     `E2E_WEB_SERVER_*` values). This is a missing setting, not a failure.
   - `"not-running"` — the URL is correct but nothing is answering. Boot it:

     ```bash
     node scripts/resolve-app-url.mjs <target path> --start [--location <rel>]
     ```

     `--start` runs the command in its own process group, writes
     `.e2e-testing/app.pid`, redirects output to `.e2e-testing/app.log`, and
     polls `E2E_BASE_URL` until it answers.

     - `"booted"` — use `url` for step 5. **Record `pid`** and remember that
       step 9 must run, however this flow ends.
     - `"timeout"` — stop and tell the human, showing `logTail`. The script
       has already stopped the process it started; do not go looking for it.
     - `"deps-missing"` — the app's dependencies are not installed (no
       `node_modules` at the app dir or repo root, no Yarn PnP). Stop and
       tell the human to install dependencies first, naming `dir` and
       `packageManager` from the result (e.g. run `pnpm install` in `dir`).
       Nothing was spawned; rerun `--start` once deps are installed.
     - `"no-start-command"` — stop and ask the human for a URL, or ask them
       to start the app themselves. This is the fallback path, not the
       default one.
     - `"ambiguous"` — present `candidates` to the human, then re-run
       `--start --location <chosen path>`.

5. **Verify each case's selectors live, then author its spec.** Read
   `.e2e-testing/test-plan-<issueNumber>.md`. First, point the MCP
   session's storage state at *this run's* target, then for each unchecked
   case verify its selectors.

   **Decide the spec structure — once per repo.** Before authoring, read
   `pom` from the target's repo-root `.e2e-scaffold.json`:

   - Key present (`true` or `false`): obey it silently. `true` = Page
     Objects, `false` = self-contained specs. Never ask.
   - `--pom` or `--no-pom` passed to this run: use that value and persist it
     (below), overriding any stored one. This is how a repo flips mode; the
     flip applies to the specs this run writes, and leaves existing specs
     alone.
   - Key absent (undecided) and no flag: ask the human once, a single
     question — structure generated tests as shared **Page Objects**
     (house-style `selectors`/`page`/`assertion` split under `pages/`), or
     **Self-contained specs** (no page objects; shared setup factored into
     `fixtures/base.ts`)? A non-interactive run with no flag and no stored
     value defaults to self-contained.

   Persist the decided value so later runs never re-ask:

   ```bash
   node scripts/persist-pom.mjs <target path> --pom      # Page Objects
   node scripts/persist-pom.mjs <target path> --no-pom   # Self-contained
   ```

   **Author by that decision:**

   - **Page Objects (`pom: true`).** For each flow this run touches, author
     the house-style three-file split — see the `playwright-testing-patterns`
     skill, "Page Object Model, split by responsibility":
     - `<flowId>.selectors.ts` — locators only, `getByRole` first, declared
       once as a function of `page`.
     - `<flowId>.page.ts` — user-facing action verbs on a thin `BasePage`,
       composing the selectors.
     - `<flowId>.assertion.ts` — grouped assertions.
     Pass these in step 6's payload as `pageObjects` entries. Wire the page
     object through `fixtures/base.ts` at the `// Generated page objects and
     fixtures plug in here.` seam so each spec receives it as a fixture, and
     each spec then reads as intent (`await guestList.add(name)`), never
     re-declaring a locator.
   - **Self-contained (`pom: false`).** Write no page objects, but still
     remove duplication: any locator or setup preamble a flow's specs share —
     the navigate-then-wait-for-seeded-state opening, a row-by-name locator,
     seed constants — is declared ONCE, in `fixtures/base.ts` (extend the
     `test` fixture) or a single per-flow module the specs import.
     Copy-pasting the same locator across two specs of one flow is a defect
     in this mode, not a style choice.

   - **Load the target repo's saved login before any navigation.** Resolve
     which storage-state file this run's target uses, then restore it into
     the browser context with the `browser_set_storage_state` tool — the
     bundled server runs with `--caps=storage`, so that tool is available:

     ```bash
     node scripts/resolve-storage-state.mjs <target path>
     ```

     It prints `{ loaded, filename }`. `filename` is the target's own
     `e2e/web/.auth/user.json` (written by `setup`) when it exists
     (`{"loaded": true}`), or an empty logged-out state the script writes
     into the target's `e2e/web/.auth/logged-out.json` when it does not
     (`{"loaded": false}`) — always a path inside the target's roots, never
     the plugin cache, which the MCP would reject. It reads only the given
     target, so a
     `[target path]` other than the session workspace can never pick up the
     workspace's own auth. Call `browser_set_storage_state` with that
     `filename` before the first navigation — it clears any existing
     cookies and storage, then restores from the file. The logged-in path
     is read, never written; the logged-out `logged-out.json` is written
     with the same fixed empty content every run, so two `generate` runs in
     one workspace race only on identical bytes, never on each other's auth.
   - Using the Playwright MCP tools (bundled with this plugin — no
     separate setup needed) against the URL from step 4, verify selectors
     from **one accessibility snapshot per page**, not one navigation per
     selector. Navigate to a distinct page the batch of cases touches, take
     a single `browser_snapshot` (it returns that whole page's
     accessibility tree in one call), cache the result, and confirm the
     selectors for every case that touches that page against the cached
     snapshot before moving to the next page. Reuse the same snapshot across
     all those cases; do not re-navigate or re-snapshot per selector. Prefer
     role and test-id selectors over CSS, per this plugin's baked-in
     defaults.
   - The snapshot is the accessibility tree, so it confirms **role and
     name** selectors directly — read them off the snapshot you already
     cached, no further call needed (`browser_find` can search within it if
     you prefer, but reading the cached tree does not depend on it). The tree
     carries neither `data-testid` nor CSS, and searching the tree cannot
     confirm those either. Verify a test-id or CSS selector
     by resolving it as a locator: a single `browser_run_code_unsafe` call
     running `page.getByTestId(id).count()` / `page.locator(css).count()`
     (a read-only count) against the **same already-loaded page** — no
     re-navigation, one snapshot still stands per page. The MCP browser keeps
     Playwright's `data-testid` default, so when the target repo's test-id
     attribute is not that (see `e2e-setup`'s detected `testIdAttribute`),
     verify with the attribute-named locator
     `page.locator('[data-cy="…"]').count()`, not `getByTestId`, which would
     count zero here even though the generated run resolves it. Never treat a
     selector as verified just because the snapshot loaded; a test-id absent
     from the a11y tree is not evidence it resolves.
   - Reserve `browser_run_code_unsafe`'s wider use — in-page JavaScript
     beyond a locator count — and per-selector navigation for the questions
     neither the snapshot nor a locator count can answer: dynamic or
     async-populated content, and values that appear only behind an
     interaction. In-page JavaScript is the fallback, not the default
     inspection tool.
   - With `{"loaded": true}`, verification starts logged in against
     authenticated pages with no manual login step; with `{"loaded":
     false}` it starts logged out. This holds whether `[target path]` is
     the repo you are working in or a different one.
   - If the Playwright MCP tools are not reachable at all, **stop and
     report this to the human** rather than falling back to writing the
     spec from static source alone — that fallback is the exact failure
     mode this step exists to prevent.
   - Once confirmed, author the case's Playwright spec content, following
     the target repo's existing spec style and conventions. (The file
     extension itself is chosen automatically by `write-specs.mjs` in
     step 6, based on the target repo's TS/JS setup.)

     **REQUIRED SUB-SKILL:** invoke
     `apptension-e2e-testing:playwright-testing-patterns` before writing
     spec content and follow its selector and async-handling conventions.
     Do not rely on description-match to load it — spec generation must
     apply these patterns on every case.

     **Each case must be isolated** — self-contained, and independent of
     any other case and of a previous run. A case that reads whatever
     happens to be in the database, or leaves state behind for the next
     one, is a false red on the next machine or the next run. Author every
     case to one of two shapes:

     - **Self-contained (default).** The case creates its own data,
       names it with a collision-resistant token — `crypto.randomUUID()`,
       not a `Date.now()` timestamp, which collides under parallel workers
       — and never depends on a row that happens to already exist. If it
       must change state it did not create, it restores that state with
       **failure-safe** cleanup that runs even on failure: an
       `afterEach`/`afterAll` hook or a `try { ... } finally { ... }`, not
       a bare teardown at the end of the test body (an earlier failure
       skips that). Do **not** mutate a shared, pre-existing singleton
       other cases also touch (a global setting, the one project's
       status): Playwright runs spec files across parallel workers, so
       two cases racing on one record interfere regardless of restore.
       Create a fresh per-case record instead.

       Data no single case owns — the account `auth.setup.ts` logs in as,
       reference data the app needs before any page renders — goes in
       `e2e/web/global-setup.ts`, the no-op hook the setup skill scaffolds
       for exactly this. Seed it there and reset it from the teardown
       function that hook returns. Never write a case that assumes a
       record already exists because it happened to be in the database on
       the machine you generated it on; if the case needs one, either it
       creates it or `global-setup.ts` does.
     - **Serial (deliberate fallback).** Only when cases genuinely must
       share state that cannot be made per-case unique. `serial` orders
       tests only **within one spec file and one project**, so put every
       sharing case into a **single** case entry (step 6 writes one file
       per entry) wrapped in one `test.describe.serial(...)` with its own
       `beforeAll` to seed the shared state and a failure-safe `afterAll`
       to clear it; if multiple browser/device projects run, also scope
       the state per project or pin the set to a single project. Reach for
       this only after the self-contained shape is ruled out, and say why
       in a one-line comment above the block.

6. **Write the specs.**

   ```bash
   echo '<payload>' | node scripts/write-specs.mjs <target path>
   ```

   Payload shape: `{"ticket": <issueNumber>, "cases": [{"flowId": "<kebab-case flow>", "slug": "<kebab-case-slug>", "title": "<case title>", "content": "<full spec file text>"}], "pageObjects": [{"flowId": "<kebab-case flow>", "role": "selectors|page|assertion", "content": "<full file text>"}]}`.
   One case per step-5 case, in the same order as the test plan. Each case
   is written to `<specDir>/<flowId>/<slug>.spec.<ext>`. `pageObjects` is
   present only in Page Object mode (`pom: true`) — omit it entirely for
   self-contained; each entry is written to `<pagesDir>/<flowId>.<role>.<ext>`
   verbatim, with no provenance comment.

   `<target path>` is the **repo root** — the same path every other step in
   this skill takes, never the `e2e/web` sub-package. The script resolves the
   spec directory relative to the repo root, so an `e2e/web` target would
   write to `e2e/web/e2e/web/specs/`; it refuses that outright with
   `{"status": "error"}` rather than writing to the doubled path. Pass the
   repo root and let the script find the sub-package. Don't reach for
   `--spec-dir` to correct a path that looks wrong — on a repo the setup
   skill scaffolded, the resolved directory is already the one the generated
   `playwright.config.ts` collects.

   Read the JSON report's `results` array. For each entry whose `result`
   starts with `refused-`, tell the human plainly. `refused-invalid-slug`
   means the case's `flowId` or `slug` isn't a plain kebab-case component
   and was rejected outright — nothing was written for it, and the only way
   forward is re-running with a corrected value. `refused-exists` means a
   file already sits at that path: the script never overwrites, and there
   is no flag that makes it. Present the path and stop; whether to delete
   that file, rename the case, or leave it alone is the human's decision,
   and it happens outside this skill.

   Read `pageObjectResults` the same way when the payload carried
   `pageObjects`. A `refused-exists` means a page object already sits at that
   path — flipping to Page Object mode never overwrites an existing file, so
   tell the human and leave it. `refused-no-pages-dir` means the target has no
   `pages` dir in its manifest (not a scaffolded Page Object repo);
   `refused-invalid-role` or `refused-invalid-flow` mean a malformed entry —
   fix and re-run.

   Every created spec carries `// issue:<issueNumber>` as its first line.
   That comment is the committed record of which run produced the file —
   it survives formatters, and nothing reads it back. This skill now leaves
   nothing else behind for the target repo's history: the test plan was
   gitignored when it was written (step 3's Finalize sub-step), and
   `.e2e-testing/app.log` and `.e2e-testing/app.pid` are transient boot state
   to add to the target repo's `.gitignore`.

7. **Validate the generated specs before running them.** The specs from
   step 6 are on disk but unproven — a syntax error or a bad import reads as
   a plausible file and only surfaces later as an opaque `not-run` once the
   app is driving them. Catch that here, cheaply, before the app is involved.

   ```bash
   node scripts/validate-specs.mjs <target path> <spec path>… [--location <rel>]
   ```

   The spec paths are the `specPath` of every non-refused entry in step 6's
   report — the skill wrote them in this same run, so nothing has to be
   looked up.

   This runs `playwright test --list` over just those spec files, through
   the target repo's own `@playwright/test`. `--list` loads and compiles
   each spec module without running it or touching the app, so a load error
   surfaces now instead of as a `not-run` in step 8.

   Read `results`. Each entry's `result` is one of:

   | `result` | Meaning |
   |---|---|
   | `valid` | The spec compiled, its imports resolved, and it appeared in the listing |
   | `invalid` | The spec failed to load — syntax error or bad import; `error` carries the failure |
   | `not-listed` | The spec loaded without error but the runner listed no test for it — excluded by the repo's `testMatch`/`testIgnore`, or it defines no test. It would resurface as a `not-run` in step 8, so it gates here too |
   | `missing` | The given path has no file on disk |

   - **Every entry `valid`** — say so and continue to step 8.
   - **Any entry not `valid`** — **stop here.** Present each such case: its
     `specPath`, `title` (from the plan), `result`, and its `error`
     **verbatim**. A report-wide `stderrTail` may also be present when the
     failure could not be tied to one spec — a config-level error, say — so
     surface it too. Then stop, and run step 9 to stop the app this run may
     have booted.

   Do not edit, regenerate, or re-run the spec — the same division of labour
   as step 8. A fresh `/apptension-e2e-testing:generate` invocation is how
   the human acts on it once they've decided.

   The non-`validated` statuses `no-playwright`, `ambiguous` and `error`
   each stop the flow and mean exactly what they do in step 8 — `error`
   here also covers a missing package-manager binary or an empty spec-path
   list, which are infrastructure, not a broken spec. Run step 9 on each of
   those exit paths too.

8. **Run the generated specs and gate on the result.** The app from step 4
   must still be running — these specs drive it.

   ```bash
   node scripts/run-specs.mjs <target path> <spec path>… [--location <rel>]
   ```

   The spec paths are the `specPath` of every non-refused entry in step 6's
   report — the skill wrote them in this same run, so nothing has to be
   looked up.

   This runs only the given spec files, once, through the target repo's own
   `@playwright/test` and whatever `retries` its config already sets. It
   never passes a `--retries` of its own, and never runs the repo's wider
   suite.

   Read `results`. Each entry's `result` is one of:

   | `result` | Meaning |
   |---|---|
   | `passed` | Succeeded on the first attempt |
   | `flaky` | Failed at least once, passed on a config-provided retry |
   | `failed` | Still failing after any configured retries |
   | `skipped` | At least one test in the file was skipped, and nothing failed or was flaky |
   | `missing` | The given path has no file on disk |
   | `not-run` | The file is there, the runner reported nothing for it |
   | `filtered` | A re-run flag excluded the spec, so the runner never ran it — the omission is what the flag asked for, not a load error |

   A repo with no `retries` configured never produces `flaky` — only
   `passed` and `failed`.

   `filtered` appears only when `run-specs.mjs` is invoked with
   `--last-failed` or `--only-changed`, which the command above does not
   pass — this step always runs the full given set. Those flags are for a
   manual or dev re-run that deliberately narrows it. When one is active,
   Playwright omits the specs it excluded from its report, and a spec it
   never mentions is reported `filtered` rather than `not-run`. One
   exception: if the report carries top-level errors, something did fail to
   load, so the absence is no longer attributable to the flag and every
   unmentioned spec stays `not-run` — a broken import under `--last-failed`
   gates, it does not read as an intentional skip.

   `filtered` says the spec was absent from the report while a filter was
   active. It does not by itself prove the filter is *why*: a spec the repo's
   `testMatch`/`testIgnore` excludes, or one defining no test, is also absent
   from a clean report. **Step 7 is what rules that out**, and it runs first
   on every invocation of this skill: its `not-listed` result covers exactly
   that case, from a `playwright test --list` that passes no re-run flags, and
   it gates there. So `filtered` is only trustworthy downstream of a passing
   step 7 — which is why a caller reusing these flags outside this skill must
   run `validate-specs.mjs` before `run-specs.mjs`, not instead of it.

   - **Every entry `passed` or `filtered`** — say so and finish. The flow
     completes normally; no gate. Name any `filtered` entry as excluded by
     the flag, never as passing: it did not verify anything, it was not
     asked to.
   - **Any entry neither `passed` nor `filtered`** — **stop here.** Present each such case:
     its `specPath`, `title` (from the plan), `result`, and its
     `failingTest` and `error` **verbatim**. Then stop. `failingTest` and
     `error` exist only for `flaky`, `failed`, and `skipped` — they're
     absent entirely, not empty, for `missing`, `not-run`, and
     `filtered`. A `not-run`
     case may also carry `reportErrors` and `stderrTail` on the overall
     report when the runner produced no per-case detail at all.

     Each such case may also carry an `artifacts` array — the on-disk paths
     Playwright already wrote for it, each an object with a `name` (`trace`,
     `screenshot`, `video`) and a `path`. Name each path for the case it
     belongs to so the human can open the evidence. The key is absent when
     the run captured none. Also name the overall report's `htmlReport` path
     once — the HTML report covering the whole run — so it can be opened with
     `npx playwright show-report <path>`. Surface artifacts only for the
     not-`passed` cases; do not list them for a case that passed.

     A failing case may also carry `networkFailures` — an array of
     `{ method, url, status }` for each response of status 400 or more seen
     while it ran. Surface it verbatim for the not-`passed` cases: it is usually
     what explains the failure the artifacts only show the symptom of (the
     `POST` behind a dead button returning 500). The key is absent when there
     was nothing to report, and never present on a `passed` case.

     Do not diagnose whether the case is a bad test or a real bug it caught.
     Do not regenerate, discard, edit, or re-run it. What happens next is
     entirely the human's call — tell them a
     fresh `/apptension-e2e-testing:generate` invocation is how they'd act on it once they've
     decided. Presenting the result *is* the whole of this step's job.

   Non-`ran` statuses each stop the flow too, and each says something
   different:

   - `no-playwright` — no location in the target repo has `@playwright/test`
     installed. Point the human at the `e2e-setup` skill.
   - `ambiguous` — several locations have Playwright and none of them
     contains the specs. Present `candidates`, then re-run with
     `--location <chosen path>`.
   - `report-unreadable` — the runner produced no parseable JSON report.
     Show `stderrTail`; this is usually a Playwright config or install
     problem in the target repo, not a test failure.
   - `timed-out` — the run exceeded its wall-clock ceiling and was killed,
     a wedged run rather than a failed assertion. Show `message` (it names
     the `timeoutMs`) and `stderrTail`. The ceiling defaults to ten minutes;
     a repo with a legitimately long suite can raise it with the
     `E2E_RUN_SPECS_TIMEOUT_MS` env var.
   - `error` — show `message`. Also covers an empty spec-path list.

9. **Stop the app this run started.**

   ```bash
   node scripts/resolve-app-url.mjs <target path> --stop
   ```

   Run this after step 7 or step 8 has reported its result — on **every**
   exit path, including the ones that stop for the human: any `invalid`
   spec from step 7, any non-`passed` case from step 8, and each of
   `no-playwright`, `ambiguous`, `report-unreadable`, `timed-out` and
   `error`. A run that gates still has to leave the machine clean, and step
   7 gates while the app booted in step 4 is still up.

   Read the JSON:

   - `"stopped"` — the process group is down.
   - `"already-stopped"` — it had exited on its own; nothing to do.
   - `"not-running"` — no pidfile, so this run never started an app. That is
     the expected result when step 4 returned `"running"` and attached to
     one the human was already running. It is not an error, and it is not a
     reason to go looking for the process by any other means.

   ### Never kill by pattern

   `--stop` acts only on the pid `--start` recorded, which is the whole
   point: it cannot reach a process this run did not create. Nothing in
   this skill may widen that.

   **Forbidden, without exception:** `pkill`, `pkill -f <anything>`,
   `killall`, `kill $(lsof -ti:<port>)`, `kill $(pgrep ...)`, or any other
   command that selects a process by name, command line, or port. These
   match processes in unrelated checkouts and on unrelated ports — a
   `pkill -f vite` has already killed a developer's dev server in a
   different project.

   If `--stop` reports `"not-running"`, that **is** the answer. If a
   process seems to have survived, report that to the human with the pid
   from step 4 and stop; choosing what to kill is theirs, not yours.

   Docker stacks, databases, and anything else the human started
   themselves are out of scope — this step stops one process group and
   nothing else.

## Migrating an existing flat suite

A repo whose specs were generated before path directories has them flat in
one directory, with `.e2e-testing/generated-*.json` ledgers beside them. Run
this once, per repo, before the next `generate`.

```bash
node scripts/migrate-specs.mjs <target path>
```

It touches nothing and reports three lists:

- `moves` — `<file>` → `<flowId>/<file>`, for every spec whose leading
  filename segment matches a directory already in the spec dir or a flow
  named in `--map`;
- `unmapped` — every spec it could not map. These need a `--map` entry;
- `ledgers` — the `generated-*.json` files it found.

For each `unmapped` spec, read it and propose a `flowId` to the human. The
script reads filenames only, deliberately: inferring a flow from a spec's
contents is your job, and the human's call to accept. One `--map` entry
teaches a flow, and its leading-segment siblings follow — a `checkout` flow
named once maps every `checkout-*.spec.ts`.

```bash
node scripts/migrate-specs.mjs <target path> --map checkout-guest.spec.ts=checkout --apply
```

`--apply` refuses while anything is still `unmapped` and moves nothing —
there is no partial migration. Moves use `git mv`, so each file keeps its
history.

The ledgers are a separate, explicit act:

```bash
node scripts/migrate-specs.mjs <target path> --apply --delete-ledgers
```

`--apply` alone names them and leaves them. Ask the human before passing
`--delete-ledgers`; never pass it on your own initiative. The repo-root
`.e2e-scaffold.json` is not a ledger and is never touched — it belongs to the
`e2e-setup` skill.

## Why local diff first, PR as fallback

`gather-context.mjs` tries a local `git diff` against the detected base
branch before it ever asks GitHub for a linked pull request. That order
matches how this skill is actually invoked: mid-implementation, before a
PR exists, when the only diff worth reading is whatever's sitting on the
current branch. `gh pr diff` is purely a fallback, for the "standalone"
case — running this from a checkout with no local divergence from the
base branch, where the issue nonetheless already has a PR open
elsewhere. Local diff wins whenever it finds anything; the PR is only
consulted once the local diff comes back empty or errors out.

## How the base branch is detected

The base branch has no connection to the issue being worked — it's
whatever the target repo's remote reports as its default, via `git
symbolic-ref refs/remotes/origin/HEAD`. If that symref isn't set (some
CI checkouts skip it), the script falls back to checking whether
`origin/main` exists, then `origin/master`, in that order — never
guessing beyond those two conventional names. If neither exists either,
`base` comes back `null` and no local diff is attempted at all; the
script goes straight to the PR fallback. Pass `base` explicitly to skip
detection entirely and name the branch yourself.

## Why the browser-boundary judgement is skill prose, not a script

Step 2 does three things a script cannot: it names the user-facing
behaviors a diff introduces, it reads the changed unit tests for the
vocabulary and edge cases their author already worked out, and it decides
whether exercising each behavior has to leave the process — which means
following what the code under a given path actually reaches. All three
need code and English understood, not matched. `gather-context.mjs` is
the contrast: fixed git/gh commands filtered by a naming convention, 100%
mechanical and portable across any target repo.

The tempting thing to script is the part that was tried and removed:
pairing `Foo.tsx` with `Foo.test.tsx` is pure file-name matching, so a
script could do it in an afternoon. It was the wrong question. A matching
test file said nothing about whether the path survives a real browser, a
real API, and a real redirect, and it drove the one destructive action in
this flow — deleting a candidate case. The scriptable question and the
useful one were not the same question.

There is also no stable contract to script against yet: the `## Testing
guide` section this step reads is written by a not-yet-built dev-flow
step, whose own format is still undecided. A parser today would target a
guess; prose gets re-read by the agent against whatever's actually there
once that step ships.

## Why the test plan needs explicit approval

This step is the only gate between step 2's unreviewed judgement and a
file that steps 4-6 read to write actual Playwright specs. A behavior
called `"e2e"` that crosses nothing, a mistitled case, or a
scope-creeping "add" request that slips through here becomes a spec file
downstream — at that point it's code, not a draft, and far more
expensive to unwind.
The approval gate exists to keep that correction cheap: catch it
here, in a markdown checklist, before it's anything else.

## Why the run gate stops instead of fixing

A spec that reads plausibly and a spec that actually works are
indistinguishable at the end of step 6. Step 8 exists to tell them apart,
and its whole value is that it stops on the difference rather than
completing quietly.

It stops rather than reacting because the plugin cannot tell the two
interesting cases apart, and guessing is worse than asking. A `failed` case
is either a bad generated spec or a real bug the spec just caught — and
those have opposite correct responses. Regenerating would destroy the
evidence in the second case; "fixing" the spec until it passes would hide
the bug outright. So the plugin reports and stops. Bug triage is out of
scope for this plugin, deliberately.

`skipped`, `missing`, and `not-run` gate for the same reason as `failed`,
even though none of them is a failing test: in all three the spec did not
actually verify anything, and reporting that as a pass is the exact failure
mode this step exists to prevent.

`filtered` is the one non-`passed` result that does not gate, and the
difference is who decided. The other four are the runner reporting that it
could not verify the spec; `filtered` is the caller having said not to run
it, via `--last-failed` or `--only-changed`. Gating there would stop the
flow on exactly the specs the flag was passed to skip. That is also why the
top-level-error carve-out exists: it is the line between "the caller
excluded this" and "this failed to load", and without it the flag would
launder a genuine breakage into a clean run.
