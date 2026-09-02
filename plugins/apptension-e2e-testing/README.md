# apptension-e2e-testing

Apptension E2E testing — generates Playwright end-to-end test specs
from a ticket's description, unit tests, and a testing-guide doc,
then verifies they run.

## When to use it

I turn this on when I'm about to generate E2E test coverage for a
ticket.

## What's inside

- `e2e-setup [target path]` skill — detects the repo's
  conventions and installs Playwright. Omit the path to set up the
  current repo.

  The plugin bundles a Playwright MCP server (`npx @playwright/mcp@latest
  --headless --isolated`) so selector verification works wherever the plugin
  is installed. If you already run your own Playwright MCP server, `setup`
  detects it (in your Claude Code, Cursor, or Codex config) and, on Claude
  Code, offers to disable the bundled one so exactly one runs — your own. The
  bundled server tracks `@latest` deliberately: the plugin is not re-released
  per `@playwright/mcp` publish, and at `0.0.x` npm version ranges collapse to
  an exact pin.

  The scaffolded config splits every browser/resolution/device project in
  two: `<name>` (granular, one behaviour per spec) and `<name>-smoke`
  (whole-path, merge-blocking). The split is filename-only —
  `*.smoke.spec.ts` runs in the smoke half, everything else runs in
  granular — never a `{ tag: '@smoke' }` annotation, which a forgotten or
  refactored-away tag would drop silently. Three scripts in the scaffolded
  `e2e/web/package.json`: `test:e2e:smoke`, `test:e2e:granular`, and the
  existing `test:e2e` (no `--project` filter) for the full suite. Both
  halves are native Playwright `--project`s, so they show up in `--ui` mode
  and the IDE extension the same as any other project.

  `generate` below never writes a `.smoke.spec.` file; `discover` does, and
  only for a path a human picked. The split is by what the spec *is*, not by
  what the writer can express: a generated spec is one behaviour drawn from a
  single ticket, while a smoke spec is a reviewed whole-path journey. Neither
  skill gets there by putting a dot in a slug — `isValidSlug` in
  `write-specs.mjs` still refuses that, since a dot is the first character a
  path-traversal component needs. The infix comes from a separate per-case
  `smoke: true` flag that the writer turns into the filename itself. A human
  can still promote an existing granular spec by renaming the file.
- `/apptension-e2e-testing:generate <issue> [target path]` — gathers a
  ticket's context, judges which behaviors need a browser to
  exercise end to end, drafts a
  human-approved test plan, then boots (or
  attaches to) the target app and writes Playwright spec files with
  selectors verified live over a bundled Playwright MCP server. It never
  overwrites an existing file at the target path — a case whose spec
  already exists there is refused outright, with no flag to force it.
  Finally it runs just that ticket's specs through the repo's own
  Playwright and reports each case as passed, flaky or failed — stopping
  for you on anything that isn't a clean pass, rather than finishing as if
  it were.
  Specs land in `<specDir>/<flowId>/<slug>.spec.<ext>`, where `flowId`
  names a user path (`auth`, `cart`, `checkout`) rather than a ticket, so a
  ticket appends a case to an existing path instead of opening its own
  island. Before the plan is drafted, `list-flows.mjs` lists every flow
  directory that already exists (and the spec filenames inside each one,
  as a vocabulary hint) so a case is matched to one of those before a new
  path is ever proposed — and a new path still goes through the same
  approval as the rest of the plan, never a second question. Each spec's
  first line is `// issue:<N>` — the committed record of which run
  produced it. Nothing else this skill writes belongs in the target
  repo's history: add `.e2e-testing/test-plan-*.md`, `.e2e-testing/app.log`
  and `.e2e-testing/app.pid` to its `.gitignore`. A repo with specs
  generated before this layout can migrate them with `migrate-specs.mjs` —
  see `skills/generate/SKILL.md`'s migration section for details.
- `/apptension-e2e-testing:discover [issue] [target path]` — answers what
  user paths the app has, then writes a merge-blocking whole-path test for
  each one you pick. Omit the issue to scan the app's code; pass an epic or
  story number to seed candidates from its sub-issues instead, which is the
  path that works when the feature is planned but not yet built.

  Four steps on roughly a ten-minute budget. A sub-agent reads the code in
  its own context, scoped to route definitions, auth configuration, route
  guards and payment modules — deliberately not every component, which is
  where this kind of task eats the whole context window. Before the
  checklist, `audit-coverage.mjs` compares this run's candidates against
  the spec dir in both directions and reports it as a self-contained,
  idempotent audit: flow directories with no `.smoke.spec` file yet
  (never got a whole-path test), and flow directories this run's
  candidates never named — reported as *this scan didn't reach them*,
  never as *removed*, next to which sources actually ran. You then review
  at most 30 remaining candidates — the ones with no path directory at
  all — ordered `auth`, `payments`, `guarded`, `public`; if more than 30
  survive, the overage is stated rather than truncated quietly. Each
  candidate is write-now or skip, and you can add a path no candidate
  named.

  **The machine proposes, you decide.** Importance is never inferred: the
  DOM does not say that "checkout with an expired card" matters more than
  "footer link opens", since both are an `<a>`. Code only hints where to
  look.

  Picked paths go through the same tail as `generate` — live selector
  verification over the bundled Playwright MCP, write, validate, run, stop
  the app — and land as `<specDir>/<flowId>/<slug>.smoke.spec.<ext>`, one
  `test()` walking the whole journey with several assertions along the way,
  not a bag of one-behaviour tests. A spec written by a seeded run carries
  `// issue:<N>` as its first line; one from a bare scan carries
  `// discover`. Data a case needs is seeded through the `global-setup.ts`
  hook `e2e-setup` scaffolds, never assumed to be sitting in the database.

  Nothing persists between runs: the approved list is written to
  `.e2e-testing/discover-plan*.md` (add it to the target repo's
  `.gitignore`) and read back only within the same run. No rejection is
  recorded anywhere — a later run re-compares against the spec directories,
  so a path that got tested drops out on its own and an untested one comes
  back as a reminder.

  The live click-through step runs a second sub-agent through the bundled
  Playwright MCP, in parallel with the code read, and refuses to start
  unless four preconditions hold: `E2E_BASE_URL` resolves, the target has a
  saved session at `e2e/web/.auth/user.json`, a blocklist of irreversible
  actions resolves (bundled defaults plus whatever `e2e/web/crawl-blocklist.json`
  adds — a repo can extend it, never disarm it), and a human has confirmed
  in the session that this environment is safe to click through. That last
  one is never inferred from the URL, `localhost` and `staging` included.
  It follows routes to a depth of 4 clicks, same-origin, clicking links and
  navigation only: no form is submitted and no dialog is accepted. A missing
  precondition drops the step and is named in the candidate list's
  disclosure — a degraded basis, reported, not a failure. A Jira key is
  recognised and stops with a pointer to
  [#353](https://github.com/apptension/toolkit-dev/issues/353) rather than
  reviewing 30 candidates and then writing nothing.

## After updating the plugin mid-session

Reload before you run a skill. Claude Code resolves a plugin's version
once, at session start, and every skill from the plugin is meant to load
from that one versioned cache directory for the rest of the session. A
`/plugin update` run mid-session writes a new versioned directory but does
not always refresh the in-session skill registry, so some skills keep the
old base directory while others pick up the new one. The result is two
skills of this plugin running different versions in the same session — for
example `e2e-setup` on a newer version than `generate` — which can
reintroduce bugs that were already fixed upstream.

After any `/plugin update` that touches this plugin, run
`/reload-plugins --force` (or start a fresh session) before invoking
`e2e-setup`, `generate`, or `discover`, so all three load from the same
version.

## Notes

Deliberately out of scope: Jira/Confluence reporting, bug triage, and
non-Playwright drivers (mobile, API, perf). A future contributor
should add those as separate plugins rather than stretching this
one's scope back to cover them.
