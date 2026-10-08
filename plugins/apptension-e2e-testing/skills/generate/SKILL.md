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
in its `// issue:<ticket>` provenance line. A Jira ticket is a bug issue when
its issue type is `Bug`.

## Steps

1. Run the gathering script against the issue and target repo (default:
   the current repo):

   ```bash
   node scripts/gather-context.mjs <issue number> [target path] [--base <branch>]
   ```

   `--base` overrides the auto-detected base branch — the default repo
   detects it from `origin/HEAD`, falling back to `main` then `master`.

   Read the JSON it prints:

   - `ticketBody` — the issue's description and acceptance criteria,
     including its `## Testing guide` section if one is attached. Never
     fetched separately.
   - `diffSource` — `"git"` (a local diff against the detected base
     branch), `"gh-pr"` (fell back to the issue's linked pull request,
     because the local diff was empty or could not be computed), or
     `"none"` (neither source had anything — route it per "Routing a
     ticket with no diff," rather than stopping). On `"gh-pr"`,
     `changedFiles` is the PR's list plus any untracked working-tree
     files, which are local-only and so cannot appear in the PR.
   - `branch` / `base` — the branch the diff was actually taken on, and
     the base branch it was compared against (`null` when no local diff
     was attempted). Sanity-check these against the issue you're
     actually working: if `branch` or `base` don't look like they belong
     to this issue, don't trust `diffSource: "git"` at face value — it
     only means *some* local diff was found, not that it's the right
     one. Prefer the PR fallback, or ask the human, instead of guessing.
   - `pr` — present on `"gh-pr"` only: `{ number, state, inCheckout }`.
     `state` is the pull request's `OPEN`, `MERGED` or `CLOSED`, or `null`
     when its view failed. `inCheckout` comes with `OPEN` and `MERGED`:
     whether this checkout's `HEAD` contains the pull request's head commit
     (`OPEN`) or its merge commit (`MERGED`). Steps 4 to 8 boot and test this
     checkout, so route on it before step 2:

     | `pr` | Do |
     |---|---|
     | `state: "OPEN"`, `inCheckout: false` | **Stop.** Say the run would test this checkout, which lacks pull request `<number>`'s code, and tell the human to run `gh pr checkout <number>` and run `generate` again. The re-run finds a local diff |
     | `state: "MERGED"`, `inCheckout: false` | **Stop.** Say this checkout predates pull request `<number>`'s merge, and tell the human to update it to include the merge, for example by pulling its base branch, and run `generate` again |
     | `state: "CLOSED"` | **Stop.** Say pull request `<number>` closed without merging, so this checkout lacks its code. Ask the human to check out the code to test, such as `gh pr checkout <number>`, and run `generate` again |
     | `state: null` | **Stop.** Say the pull request's state could not be read, so the run cannot confirm it would test the change. Re-running once is fine |
     | Anything else | Continue |
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
     reached only once the local diff comes back empty or errors out —
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
   - `bug` — `"label"` when a label is `bug` or ends in it as a token
     (`type: bug`, `kind/bug`, `type-bug`) and does not negate it
     (`not-a-bug`, `non-bug` and `no-bug` do not count), `"type"` when the GitHub issue
     type is `Bug`, `null` otherwise. Either value makes this a **bug
     issue**: steps 2 and 3 mark which cases trace to the bug, and step 8
     runs the specs against the pre-fix code as well. With `null`, a plan
     case whose `_Traces to:_` starts with `Bug report` also makes it one.

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
      git diff $(git merge-base origin/<base> <branch>) -- <path>
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
      (Foo.test.tsx)"`. On a bug issue, a behavior the report describes
      as broken, the one the fix restores, records `"Bug report: \"<the
      report's words>\""`.

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
      naming a behavior that needs E2E coverage directly, the same trust
      sub-step 5 already extends to a human's "add" request during
      revision. It is not re-judged
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

Read the `Location` row of the `### E2E bindings` section in the target's
bindings file first. When it is present, pass it as `--location` so a suite
relocated to a custom, non-workspace dir (say `services/e2e`) is included in
the detection scan; when it is absent, pass no `--location` and let the
script resolve the location itself:

```bash
# Location row present:
node scripts/check-playwright.mjs <target path> --location <location>
# Location row absent:
node scripts/check-playwright.mjs <target path>  # e2e-location-default
```

Without the location, `detect` never probes a relocated suite dir, so a
suite installed right there on disk reports `no-playwright` and generation
stops. This reuses `resolveLocation` from `run-specs.mjs`, then reads the
resolved location's on-disk install to tell a scaffolded-but-uninstalled
worktree apart from a repo with no suite at all, instead of a second
detection. No spec paths exist yet at this point, so it runs with an empty
list — only the location-level statuses (`no-playwright` and
`scaffolded-not-installed`) matter here; disambiguating between several
Playwright installs needs real spec paths, and steps 4, 7 and 8 each resolve
that for themselves once those exist.

- `no-playwright` — no location in the target repo declares
  `@playwright/test`, so the suite is not scaffolded here. **Stop here**,
  before drafting or presenting a plan, booting the app, or opening the
  Playwright MCP. Point the human at the `e2e-setup` skill.
- `scaffolded-not-installed` — a location declares `@playwright/test`, so the
  suite is scaffolded, but its install is absent in this worktree — no
  `node_modules` and no Yarn PnP loader. This is the ordinary state of a fresh
  `dev-flow` worktree: `node_modules`, `.auth` and `.env` are gitignored and
  never travel between worktrees. **Stop here**, the same as `no-playwright`,
  but point the human at `message` — install the suite's dependencies and
  restore this worktree's `.auth` and `.env`, then re-run. Do not run
  `e2e-setup`; the suite is already set up.
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

      List what already exists first. Read the `Location` row of the
      `### E2E bindings` section in the target's bindings file. When it is
      present, pass it as `--location`; when it is absent, pass neither and
      let the script resolve the spec dir itself:

      ```bash
      # Location row present:
      node scripts/list-flows.mjs <target path> --location <location>
      # Location row absent:
      node scripts/list-flows.mjs <target path>  # e2e-location-default
      ```

      This resolves the spec dir the same way `write-specs.mjs` (step 6)
      actually will — a present `Location` resolves through its own
      `playwright.config` `testDir` (a specific `testDir` relocates the specs,
      a `testDir` of `.` or none falls back to `<location>/specs`), and with
      no `Location` row both fall back to the Playwright config's `testDir`,
      or `<config dir>/specs` when the config names none, then `e2e/specs`
      when no usable config is found (skipped: a config whose `testDir` is
      an expression, and one with no `testDir` outside the root, a
      workspace member or `e2e/web` declaring `@playwright/test`) — so the listing and the eventual write can't disagree
      about where flows live. Passing `--spec-dir <location>/specs` explicitly
      would hardcode the scaffolder default and point a conform suite whose
      `testDir` is elsewhere (say `./tests`) at a directory Playwright never
      runs, so the `Location` row goes through `--location`, which honors that
      config. It returns `{"specDir", "flows": [{"flowId", "specs":
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

      **Give every absence case a control.** A case that asserts a badge,
      a row or an error is absent also passes when its locator matches
      nothing, so on its own it proves nothing. Name the positive check the same spec makes with the same
      locator, usually on a second seeded record that should show the
      element, on a `_Control:_` line under the case's `_Flow:_` line. The
      plan example in sub-step 3 shows one.

      **On a bug issue, every case is a bug case or a guard.** A case
      whose `_Traces to:_` starts with `Bug report` is a **bug case**: it
      must fail on the code before the fix. Every other case is a
      **guard**: it must pass before and after. The approval gate approves
      that split with the rest of the plan. A bug-issue draft with no bug
      case carries this line under its heading, verbatim:

      > No case traces to the bug report, so nothing runs against the
      > pre-fix code.

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
      - [ ] An archived project shows no "Overdue" badge
        _Flow: project-details_
        _Control: an overdue active project, seeded in the same spec, shows the badge through the same locator_
        _Traces to: AC #2: "archived projects never show as overdue"_
        _Why E2E: the badge renders from the project API response on the details page_
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

4. **Boot the app, or attach to it if it's already running.** Read the
   `Location` row of the `### E2E bindings` section in the target's bindings
   file first — it names the suite dir (e.g. `e2e/web`) whose `.env` holds
   `E2E_BASE_URL`. Pass it as `--suite-location` on every call below when it
   is not the default; an absent row means the default and needs no flag.

   ```bash
   node scripts/resolve-app-url.mjs <target path> [--suite-location <rel>]
   ```

   The app's URL comes from `E2E_BASE_URL` — exported, or set in the suite's
   `.env`. Nothing infers a port from framework defaults any more, so there
   is no wrong guess to diagnose.

   - `"running"` — the app is already up. Reuse `url` and skip to step 5.
     **Do not** start a second one, and note that step 9 will have nothing
     to stop: this app belongs to the human, not to this run.
   - `"no-base-url"` — stop and ask the human to set `E2E_BASE_URL`
      (the `e2e-setup` skill prints the matching
     `E2E_WEB_SERVER_*` values). This is a missing setting, not a failure.
   - `"not-running"` — the URL is correct but nothing is answering. Boot it:

     ```bash
     node scripts/resolve-app-url.mjs <target path> --start [--suite-location <rel>]
     ```

     `--start` runs the command in its own process group, writes
     `.e2e-testing/app.pid`, redirects output to `.e2e-testing/app.log`, adds
     both to the target repo's `.gitignore` unless a rule already covers
     them, and polls `E2E_BASE_URL` until it answers.

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

   **Decide the spec structure — once per repo.** `e2e-setup` settles this
   at its approval gate and writes the `Convention` row, so a suite
   scaffolded by the current setup arrives with the row already present.
   Before authoring, read the `Convention` row of the `### E2E bindings`
   section in the target's bindings file (`resolveBindingsFile` from the
   `e2e-setup` skill's `scripts/bindings.mjs`):

   - Row present (`pom` or `flat`): obey it silently. `pom` = Page
     Objects, `flat` = self-contained specs. Never ask.
   - `--pom` or `--no-pom` passed to this run: use that value and record it
     (below), overriding any stored row. This is how a repo flips mode; the
     flip applies to the specs this run writes, and leaves existing specs
     alone.
   - Row absent (undecided) and no flag: the fallback for a suite
     scaffolded before setup wrote the row. Ask the human once, a single
     question — structure generated tests as shared **Page Objects**
     (house-style `selectors`/`page`/`assertion` split under `pages/`), or
     **Self-contained specs** (no page objects; shared setup factored into
     `fixtures/base.ts`)? A non-interactive run with no flag and no stored
     row defaults to self-contained.

   Record the decided value so later runs never re-ask: upsert the
   `Convention` row (`| Convention | \`pom\` |` or `| Convention | \`flat\`
   |`) into the `### E2E bindings` section of the bindings file, under the
   same idempotency rules as `apptension-sdlc:setup`'s `### Dev flow
   bindings` section — a heading probe finds the section, an existing row
   is updated in place, and a missing section is added with this row as
   its `Convention` value. The agent performs this upsert directly, no
   script involved.

   **Author by that decision:**

   - **Page Objects (`pom: true`).** For each page or component the flows
     this run touches, author the house-style three-file split — see the
     `playwright-testing-patterns` skill, "Page Object Model, split by
     responsibility". Name each page by that skill's "Page Object folders"
     rule. `<ext>` is `ts` or `js`, the suite's language as `write-specs.mjs` detects it. The first
     of these the suite has decides it: its own `tsconfig.json` (`ts`), the
     language of its existing specs, then its Playwright config
     (`playwright.config.ts` is `ts`; `.js`, `.mjs` and `.cjs` are `js`). A
     suite with none of those is `ts` when the repo root has a
     `tsconfig.json` or `tsconfig.base.json`, and `js` otherwise.
     - `pages/<page>/<page>.selectors.<ext>` — locators only, `getByRole`
       first, declared once as a function of `page`.
     - `pages/<page>/<page>.page.<ext>` — user-facing action verbs on a thin
       `BasePage`, composing the selectors. Import `BasePage` from
       `../base.page`; step 6 writes that file, so it is never a
       `pageObjects` entry.
     - `pages/<page>/<page>.assertion.<ext>` — grouped assertions, each
       method named like a Playwright matcher (`toBeLoaded`), so the suite's
       missing-assertion lint rule counts `await login.assert.toBeLoaded()`
       as an assertion.
     In a `js` suite, write all three as plain JavaScript. Step 7's `--list`
     loads them as JavaScript, so type syntax such as a typed `page`
     parameter or an `import type` fails it.
     A page whose folder already exists is the suite's own. Read its files
     first, and when a flow needs a selector, action or assertion they lack,
     add it to that file directly. Pass only new pages in step 6's payload as
     `pageObjects` entries. Wire each page object through `fixtures/base.ts`
     at the `// Generated page objects and fixtures plug in here.` seam,
     importing `../pages/<page>/<page>.page`, so each spec receives it as a
     fixture, and each spec then reads as intent
     (`await guestList.add(name)`), never re-declaring a locator.
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
     node scripts/resolve-storage-state.mjs <target path> [--location <rel>]
     ```

     Pass the same `Location` row read in step 3 as `--location` when it is
     present, so the saved login resolves under the configured suite dir.
     When the row is absent, pass no `--location` and the script falls back
     to `e2e/web`.

     It prints `{ loaded, filename }`. `filename` is the target's own
     `<location>/.auth/user.json` (written by `setup`) when it exists
     (`{"loaded": true}`), or an empty logged-out state the script writes
     into the target's `<location>/.auth/logged-out.json` when it does not
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

     A case with a `_Control:_` line gets that control in its own spec,
     asserted through the same locator as the absence check.

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

6. **Write the specs.** Pass the same `Location` row read in step 3 as
   `--location` when it is present, so specs and page objects resolve under
   the configured suite dir. When the row is absent, pass no `--location`
   and let the script fall back to the config's `testDir`, or
   `<config dir>/specs` when the config names none (then `e2e/specs` when no
   usable config is found):
   passing `e2e/web` explicitly would override a repo whose `testDir` points
   elsewhere and write specs where Playwright will not run them.

   ```bash
   # Location row present:
   echo '<payload>' | node scripts/write-specs.mjs <target path> --location <location>
   # Location row absent:
   echo '<payload>' | node scripts/write-specs.mjs <target path>  # e2e-location-default
   ```

   Payload shape: `{"ticket": <issueNumber>, "cases": [{"flowId": "<kebab-case flow>", "slug": "<kebab-case-slug>", "title": "<case title>", "content": "<full spec file text>"}], "pageObjects": [{"page": "<kebab-case page>", "role": "selectors|page|assertion", "content": "<full file text>"}]}`.
   One case per step-5 case, in the same order as the test plan. Each case
   is written to `<specDir>/<flowId>/<slug>.spec.<ext>`. `pageObjects` is
   present only in Page Object mode (`pom: true`) — omit it entirely for
   self-contained; each entry is written to `<pagesDir>/<page>/<page>.<role>.<ext>`
   verbatim, with no provenance comment. A payload carrying `pageObjects` also
   writes `<pagesDir>/base.page.<ext>` from the script's own template (page
   handle, slug, `goto`) when the suite has none, and leaves an existing one
   as it is.

   `<target path>` is the **repo root** — the same path every other step in
   this skill takes, never the `e2e/web` sub-package. The script resolves the
   spec directory relative to the repo root, so an `e2e/web` target would
   write to `e2e/web/e2e/web/specs/`; it refuses that outright with
   `{"status": "error"}` rather than writing to the doubled path. Pass the
   repo root and let the script find the sub-package. `--spec-dir` and
   `--pages-dir` override the section's `Location` outright — reach for them
   only when a case genuinely needs a directory the section doesn't name,
   not to correct a path that looks wrong.

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
   `pageObjects`. `exists` means that page object is already in the suite: the
   script leaves it as it is, and the flow uses it. `refused-invalid-page` or
   `refused-invalid-role` mean a malformed entry, and nothing was written for
   it. Fix the entry and re-run. `basePage` reports the base class: `created` on the run
   that wrote it, `exists` when the suite already had one.

   Every created spec carries `// issue:<issueNumber>` as its first line.
   That comment is the committed record of which run produced the file —
   it survives formatters, and nothing reads it back. Nothing else this
   skill writes belongs in the target repo's history. The test plan was
   gitignored when it was written (step 3's Finalize sub-step), and step
   4's `--start` gitignores the `.e2e-testing/app.log` and
   `.e2e-testing/app.pid` it writes.

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

   A clean listing is followed by the suite's own `typecheck` script, once,
   when the suite has a `tsconfig.json` and that script and is not the repo
   root. Playwright strips types without checking them, so a spec with a type
   error loads cleanly under `--list`. The typecheck is what fails it.

   Read `status` first. `validated` carries `results`. Any other status is a
   report-level stop that carries no `results`, and **stops here**:

   | `status` | Present |
   |---|---|
   | `no-playwright` | That the Location row's directory has no `@playwright/test` installed, or, with no row, that no location in the target repo has it. Point the human at the `e2e-setup` skill, or at the Location row when it names the wrong directory |
   | `ambiguous` | `candidates` and the spec paths verbatim. It arises only with no Location row: each candidate has Playwright and none contains the written specs. Point the human at the `e2e-setup` skill |
   | `error` | `message` verbatim. It also covers a missing package-manager binary. An empty spec-path list means step 6 wrote no spec: present step 6's report with it, as a fault in this run |

   Apart from an empty spec-path list, each is an infrastructure fault and
   not a broken spec, and a second invocation returns the same status.
   Present it once, then run step 9. An empty spec-path list ends the run
   there, with step 6's report. Otherwise resume once the human reports the
   cause fixed, as [Resuming after a stop](#resuming-after-a-stop) says.

   Read `results`. Each entry's `result` is one of:

   | `result` | Meaning |
   |---|---|
   | `valid` | The spec compiled, its imports resolved, and it appeared in the listing. On a listing that failed on another spec, `valid` means only that no error was traced to this one |
   | `invalid` | The spec failed to load (syntax error or bad import), or the typecheck named it; `error` carries the failure, or the spec's `tsc` lines. When `--list` fails with output that names no spec, every spec it ran on is `invalid` with that same `error`, and the report carries `stderrTail` |
   | `not-listed` | The spec loaded but the runner listed no test for it, excluded by the repo's `testMatch`/`testIgnore` or defining no test, so it would resurface as `not-run` in step 8 |
   | `missing` | The given path has no file on disk |

   Read `typecheck` too, present whenever the listing was clean:

   | `typecheck.status` | Meaning |
   |---|---|
   | `passed` | The suite type-checks |
   | `failed` | `tsc` reported errors. A requested spec's errors are on its entry as `invalid`. `otherFiles` lists errors in any other file, such as a page object, as `{ file, error }` |
   | `error` | The script failed without a `tsc` diagnostic, for example `tsc` is not installed; `message` carries the output |
   | `skipped` | No suite `tsconfig.json`, no `typecheck` script, or the suite is the repo root; `reason` says which |

   - **Every entry `valid`, and `typecheck.status` is `passed` or `skipped`**
     — say so and continue to step 8.
   - **Any entry not `valid`, or `typecheck.status` is `failed` or
     `error`** — **stop here.** Present each such entry's `specPath`,
     `title` (from the plan) and `result`, plus its `error` **verbatim** on
     an `invalid` entry, the only kind that carries one. Then present each
     `otherFiles` entry's `file` and `error`, or the typecheck `message`,
     verbatim, plus a report-wide `stderrTail` when present. `stderrTail`
     comes with every failed listing. When every entry that is not
     `missing` is `invalid` with one identical `error`, the runner may have
     failed rather than any spec, for example on a Playwright config or
     install error, so say that rather than naming those specs as broken.
     Then run step 9 to stop the app this run may have booted.

   Do not edit, regenerate, or re-run the spec — the same division of labour
   as step 8. The human acts on the stop, and the run then resumes as
   [Resuming after a stop](#resuming-after-a-stop) says. The one exception is
   the misnamed assertion below.

   Once that gate passes, read `lint`. The suite's own linter ran over the
   requested specs: ESLint when the suite has a flat ESLint config, Biome
   when it has a `biome.json` or `biome.jsonc` and no flat ESLint config.

   | `lint.status` | Meaning |
   |---|---|
   | `passed` | No findings |
   | `findings` | `findings` lists each one as `{ file, line, ruleId, severity, message }` |
   | `error` | The linter printed no JSON report, for example a config that fails to load; `message` carries the output |
   | `skipped` | The suite has neither a flat ESLint config nor a Biome config; `reason` says so |

   A missing-assertion finding also carries `cause`, read from the flagged
   test's body. Its `ruleId` is `playwright/expect-expect` under ESLint and
   `plugin/expect-assertion` under Biome. Route it by that `cause`:

   - **`misnamed-assertion`** — the test calls `<page>.assert.<name>()`
     with a `<name>` outside `^to[A-Z]`, and `methods` lists those names,
     such as `["loaded"]`. Rename each method in `pages/<page>/<page>.assertion.<ext>`,
     where `<ext>` is the extension of the spec file, to a matcher-style
     name (`toBeLoaded`) and update every call site
     under the suite, then run `validate-specs.mjs` again over the same
     spec paths. **One attempt.** If the second report still carries a
     missing-assertion finding, or fails the gate above, stop and present it
     as below.
   - **`no-assertion`** — the test makes no `.assert.` call. Stop. Present
     the finding's `file`, `line` and `message` verbatim, then run step 9.

   Every other finding, and a `lint.status` of `error`, continues to step 8
   and goes verbatim in the report the run ends on, however step 8 ends it.
   `skipped` needs no mention.

   Then read `assertions`, present whenever the listing was clean. The
   script read each spec's matcher calls:

   | `assertions.status` | Meaning |
   |---|---|
   | `passed` | Every spec with a matcher has at least one positive one |
   | `warnings` | `warnings` lists each spec as `{ specPath, rule, message }`. `rule` is `absence-only`. Every matcher in the spec is `toHaveCount(0)`, `not.toBeVisible()` or `toBeHidden()`, so it also passes when its locator matches nothing |

   A Page Object assertion named like a matcher counts as positive, since
   the script does not read its body. A warning continues to step 8 and
   goes verbatim in the report the run ends on, the same as a lint finding.
   It names a spec missing the control step 3 requires.

   ### Resuming after a stop

   Every stop in this step and in step 8 leaves the written specs on disk,
   and a fresh `generate` run would refuse them in step 6 as
   `refused-exists`. So once the human reports the cause fixed, resume over
   the same spec paths: boot the app as step 4 does, then run steps 7 to 9.
   On a bug issue step 8 runs the pre-fix run again, so a stop there
   resumes the same way.
   Leave out any spec the human deleted. An empty spec-path list is the one
   stop with nothing to resume, because step 6 wrote no spec.

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

   - **Every entry `passed` or `filtered`** — say so. Name any `filtered`
     entry as excluded by the flag, never as passing: it did not verify
     anything, it was not asked to. On a bug issue whose plan has a bug
     case and every entry `passed`, read
     [references/pre-fix-run.md](references/pre-fix-run.md) and run it
     before step 9: it runs every spec against the pre-fix commit and
     gates on bug cases failing there. On such a bug issue, a `filtered`
     entry never ran on the fix, so the pre-fix gate has nothing to
     compare it with: report the run as inconclusive and stop. Every other
     run finishes here, with no gate.
   - **Any entry neither `passed` nor `filtered`** — **stop here.** Present each such case:
     its `specPath`, `title` (from the plan) and `result`, plus its
     `failureCount` and `failures` list **verbatim** where it carries them.
     Then stop. `failureCount` and
     `failures` exist only for `flaky`, `failed`, and `skipped` — they're
     absent entirely, not empty, for `missing`, `not-run`, and
     `filtered`. A `not-run`
     case may also carry `reportErrors` and `stderrTail` on the overall
     report when the runner produced no per-case detail at all.

     `failureCount` is the number of tests that ended with the case's
     `result`, one per test per project, so for a `failed` case it matches
     Playwright's failed-test count. `failures` groups them: each entry is
     one test failing one way, carrying its `title` (enclosing `describe`
     titles first, joined with ` › `), `location` (the test's declaration),
     `errorLocation` (where the first error was thrown) and `specFrame`
     (the first spec-file line in that error's stack), each present only
     when the runner reported it, `error`, and the `projects` it failed on. A spec failing identically on eight
     projects is one entry naming all eight, and the projects are often the
     pattern the human needs, such as every mobile project failing and no
     desktop one. Present every entry with its projects. A project is `null`
     when the target repo's Playwright reports none.

     An entry may also carry an `artifacts` array — the on-disk paths
     Playwright already wrote for it, each an object with a `project`, a
     `name` (`trace`, `screenshot`, `video`) and a `path`. Name each path for
     the entry and project it belongs to so the human can open the evidence.
     The key is absent when the run captured none. Also name the overall
     report's `htmlReport` path once — the HTML report covering the whole
     run — so it can be opened with `npx playwright show-report <path>`.
     A run where every spec is `missing` ran nothing and carries no
     `htmlReport`, so name it only when the result has one.

     An entry may also carry `networkFailures` — an array of
     `{ method, url, status }` for each response of status 400 or more seen
     while it ran. Surface it verbatim: it is usually what explains the
     failure the artifacts only show the symptom of (the `POST` behind a
     dead button returning 500). The key is absent when there was nothing
     to report.

     An entry may also carry `appLog` — the lines the app wrote to its boot
     log while the case ran, newest kept. Surface it: it holds the
     server-side stack trace behind the failure the browser signals only
     show the front of. It is captured only when the run used a single
     worker, since parallel workers share one log; a case run in parallel
     carries a report annotation naming that reason instead. The key is
     absent when there was nothing to report.

     An entry may also carry `sessionExpired` — `{ authMode, hint }`, set
     when the test started logged in and ended on the `E2E_LOGIN_URL` page.
     Surface the `hint` verbatim: it names the likely cause (a lost session,
     for example a backend that rotates refresh tokens) and the setting that
     addresses it. It is a diagnosis attached by the suite's fixture and
     leaves the result as it is. The key is absent when the test kept its
     session.

     `networkFailures`, `appLog` and `sessionExpired` come from the first
     project in the entry's `projects`: each project ran separately, and
     merging their evidence would mix runs.

     Do not diagnose whether the case is a bad test or a real bug it caught.
     Do not regenerate, discard, edit, or re-run it. What happens next is
     entirely the human's call. Once they have acted on it, the run resumes
     as [Resuming after a stop](#resuming-after-a-stop) says. Presenting the
     result *is* the whole of this step's job.

   Non-`ran` statuses each stop the flow too, and each says something
   different:

   - `no-playwright` — no location in the target repo has `@playwright/test`
     installed. Point the human at the `e2e-setup` skill.
   - `ambiguous` — several locations have Playwright and none of them
     contains the specs. It arises only with no Location row. Present
     `candidates` and the spec paths verbatim, point the human at the
     `e2e-setup` skill, and stop. Do not re-run with a chosen `--location`:
     an explicit location skips the check that it contains the specs.
   - `report-unreadable` — the runner produced no parseable JSON report.
     Show `stderrTail`; this is usually a Playwright config or install
     problem in the target repo, not a test failure.
   - `timed-out` — the run exceeded its wall-clock ceiling and was killed,
     a wedged run rather than a failed assertion. Show `message` (it names
     the `timeoutMs`) and `stderrTail`. The ceiling defaults to ten minutes;
     a repo with a legitimately long suite can raise it with the
     `E2E_RUN_SPECS_TIMEOUT_MS` env var.
   - `error` — show `message`. Also covers an empty spec-path list.

   Present each once, then run step 9, and resume as
   [Resuming after a stop](#resuming-after-a-stop) says once the human
   reports the cause fixed.

9. **Stop the app this run started.**

   ```bash
   node scripts/resolve-app-url.mjs <target path> --stop  # e2e-location-default
   ```

   Run this after step 7 or step 8 has reported its result — on **every**
   exit path, including the ones that stop for the human: any `invalid`
   spec from step 7, any non-`passed` case from step 8, a pre-fix run
   stop, and each of `no-playwright`, `ambiguous`, `report-unreadable`,
   `timed-out` and `error`. A run that gates still has to leave the machine
   clean, and step 7 gates while the app booted in step 4 is still up.

   The pre-fix run stops the fix app at its step 2 and tears down its own
   app and worktree, so after a pre-fix run that got that far this reports
   `"not-running"`. A pre-fix run that stopped at its step 1 left the fix
   app up, and this reports `"stopped"`.

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
node scripts/migrate-specs.mjs <target path> [--location <rel>]
```

Pass `--location` when the `### E2E bindings` Location row names a suite
outside the default `e2e/web`, so the migration reads and moves specs in
the suite's resolved spec dir — its own `playwright.config` `testDir` when
that names a sub-directory, else `<location>/specs`. With the row absent,
omit it and the spec dir follows the Playwright config's `testDir`, landing
on `e2e/specs` only when the repo has no config. Pass it on every
`migrate-specs.mjs` call in this section, `--apply` included.

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
node scripts/migrate-specs.mjs <target path> [--location <rel>] --map checkout-guest.spec.ts=checkout --apply
```

`--apply` refuses while anything is still `unmapped` and moves nothing —
there is no partial migration. Moves use `git mv`, so each file keeps its
history.

The ledgers are a separate, explicit act:

```bash
node scripts/migrate-specs.mjs <target path> [--location <rel>] --apply --delete-ledgers
```

`--apply` alone names them and leaves them. Ask the human before passing
`--delete-ledgers`; never pass it on your own initiative. The `### E2E
bindings` section in the bindings file is not a ledger and is never
touched by this migration — it belongs to the `e2e-setup` skill.

## Why local diff first, PR as fallback

`gather-context.mjs` tries a local `git diff` against the detected base
branch before it ever asks GitHub for a linked pull request. That order
matches how this skill is actually invoked: mid-implementation, before a
PR exists, when the only diff worth reading is whatever's sitting on the
current branch. `gh pr diff` is purely a fallback, for the "standalone"
case — running this from a checkout with no local divergence from the
base branch, where the issue already has a PR. Local diff wins whenever it
finds anything; the PR is only consulted once the local diff comes back
empty or errors out.

The PR supplies the file list, never the code under test: steps 4 to 8
boot and run this checkout, so the run stops at step 1 unless `HEAD`
contains the PR's code, rather than plan cases for the fix and run them
against code without it. For an open PR that is its head commit, and for
a merged PR its merge commit. A PR closed without merging never reached
the base branch, so it stops at step 1 too.

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

There is also no format to script against. The `## Testing guide`
section is prose a human typed on the ticket, in whatever shape they
typed it; no step generates it, so there is no schema a parser could
target. The agent re-reads whatever is actually there.

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

Triage belongs to `triage-e2e-run`, which a caller invokes after this
report. It needs one fact this skill cannot assume: that the diff under
test is the caller's own unpushed work. `implement-issue` step 8 states it,
and routes what the triage hands back.

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

## Why bug specs run against the pre-fix code

A spec that passes on the fix shows the fixed behavior works. It does not
show the spec would have caught the bug: a spec asserting something the fix
never changed passes on both sides, and step 8 alone reads that as done.
The pre-fix run is the one check that can tell. A bug case has to go red on
the code before the fix and green on the fix.

It reports and stops for the same reason step 8 does. A bug case that
passes on the pre-fix code either asserts the wrong thing or tests a bug
that does not reproduce in a browser. Editing the spec until it goes red
before the fix tends to find a spec that fails for an unrelated reason,
which hides the first case behind a false catch.

A failure in setup is inconclusive rather than a catch. When seeding breaks
because the fix changed the schema, or a fixture calls an endpoint the
pre-fix app lacks, the case goes red without ever reaching its assertion.
That red says the pre-fix app could not run the case, not that the case
detects the bug.
