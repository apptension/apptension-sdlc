---
name: playwright-testing-patterns
description: Use when writing or reviewing Playwright end-to-end tests — especially UI with async-populated lists (autocomplete, search results, filtered dropdowns), ARIA roles that vary by breakpoint or library version, strict-mode "resolved to N elements" violations, getByRole matching the wrong element, hidden radio/checkbox inputs, toast or snackbar assertions, assertions that something is absent (toHaveCount(0), toBeHidden), flaky navigation after form submit, or route/clock mocking order.
---

# Playwright Testing Patterns

Reusable Playwright locator strategies and testing conventions that generalize
across projects — extracted from patterns that repeatedly caused flakiness or
strict-mode violations in real suites. Not tied to any specific widget,
component library, or app.

---

## Multi-Device Test Organization

If your suite runs the same flows against multiple viewports/devices, encode
the target device in the filename and map it to a dedicated Playwright
project, rather than branching on viewport inside a single test:

| Suffix | Playwright Project |
|---|---|
| `*.desktop.spec.ts` | Desktop Chrome |
| `*.mobile.spec.ts` | Mobile Chrome (or your mobile device profile) |
| `*.tablet.spec.ts` | Tablet profile (add as needed) |

Map each suffix to a project's `testMatch` in `playwright.config.ts`. Be
aware of the gap this leaves: a spec file that matches **no** project's
`testMatch` is silently **not run** — Playwright does not error on it — so a
mistyped suffix (`*.mobil.spec.ts`) disappears instead of failing. `testMatch`
alone does not make typos loud. Close it with a discovery check: a small CI
step or meta-test that lists every `*.spec.ts` and fails if any file matches
no project's `testMatch`.

**Why per-file instead of per-test viewport branching:** conditional logic
inside a test (`if (isMobile) {...} else {...}`) makes both paths slower to
read and easier to leave one branch untested. Splitting by file makes each
test single-purpose and lets you `grep` for "how do we test X on mobile"
directly by filename.

---

## Async-Populated Content: Wait for the Specific Item, Not the Container

Any UI that shows a container immediately and fills it in after a network
call resolves — search results, a filtered dropdown, a live-updating list —
has the same race condition. The container can appear with placeholder or
stale content **before** the real data has loaded. Waiting only for the
container to be visible proves nothing about whether the item you want to
interact with has actually rendered yet:

```typescript
// ❌ Race condition — the list is visible with a loading/placeholder state,
//    or with results from a previous filter, before the new data has loaded
const results = page.getByRole('list', { name: 'Search results' });
await results.waitFor({ state: 'visible' });
await results.getByRole('listitem', { name: /widget pro/i }).first().click();

// ✅ Wait for the specific item — guarantees the async data is loaded
const results = page.getByRole('list', { name: 'Search results' });
const item = results.getByRole('listitem', { name: /widget pro/i }).first();
await item.waitFor({ state: 'visible' });
await item.click();
```

**Rule:** always `waitFor({ state: 'visible' })` on the **specific item**,
not the container — this applies to autocomplete listboxes, filtered
tables, infinite-scroll feeds, or anything else that renders before its
data arrives. If the underlying fetch hits a real (or realistically mocked)
network call, give this wait a higher timeout than your default action
timeout — it's bounded by network latency, not UI rendering.

**Caveat — visibility is necessary, not sufficient.** If the previous list
can already contain an item with the same name (re-filtering a list that
still shows the old results), `waitFor({ state: 'visible' })` resolves
immediately against the **stale** item and the test can click it while the
new request is still in flight. When that's possible, gate on the
request/response transition — or a loading indicator clearing — before
matching the item:

```typescript
const results = page.getByRole('list', { name: 'Search results' });
// Match the FINAL query, not any /api/search: pressSequentially fires a
// request per keystroke, so a predicate matching every search response can
// resolve on an earlier keystroke's response and the stale-item race remains.
const response = page.waitForResponse(
  (r) => r.url().includes('/api/search') && r.url().includes(encodeURIComponent('widget pro'))
);
await input.pressSequentially('widget pro');
await response; // the response for THIS query, not a previous keystroke's
const item = results.getByRole('listitem', { name: /widget pro/i }).first();
await item.waitFor({ state: 'visible' });
await item.click();
```

If the app debounces so only the final value is requested, matching
`/api/search` alone is enough; if it doesn't send the query in the URL at
all, wait for the loading indicator to clear instead of the response.

Match on the stable, human-authored part of an item's text and avoid
matching on formatted/derived parts (ids, counts, timestamps, currency)
that vary in format across responses or environments — those cause
consistent, hard-to-diagnose timeouts rather than outright failures.

---

## Timing: Never Sleep, Never Poll by Hand

Every timing bug below has the same root cause — reaching for a fixed wait or a
manual visibility check instead of a **web-first assertion**. Playwright's
`expect(locator)` assertions auto-retry until the condition holds or the
timeout expires, so they wait exactly as long as needed and no longer. Three
calls are banned; each has a direct replacement. `eslint-plugin-playwright`
(shipped by `e2e-setup`) fails lint on the first two.

| Banned | Why | Use instead |
|---|---|---|
| `page.waitForTimeout(ms)` | A fixed sleep is flaky when slow and slow when it isn't; it asserts nothing | The web-first assertion for the state you're actually waiting for — `await expect(locator).toBeVisible()`, `.toHaveText()`, `.toBeEnabled()` |
| `page.waitForLoadState('networkidle')` | "No requests for 500ms" is a proxy, not the thing you need; analytics/polling keep it from ever settling | Wait on the specific signal — `await expect(item).toBeVisible()`, or `page.waitForResponse(...)` for the request that matters (see the async-content section) |
| `if (await x.isVisible()) { … }` | `isVisible()` is a one-shot boolean with no retry; it races the render and branches your test into an untested path | Assert the expected state, don't branch on it — `await expect(x).toBeVisible()` |

```typescript
// ❌ sleeps, then hopes the button is ready
await page.waitForTimeout(2000);
await page.getByRole('button', { name: 'Save' }).click();

// ✅ waits precisely until it's clickable, no arbitrary delay
await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
await page.getByRole('button', { name: 'Save' }).click();
```

```typescript
// ❌ branches on a non-retrying snapshot — the toast may not have rendered yet,
//    so the assertion inside is silently skipped and the test passes blind
if (await page.getByRole('alert').isVisible()) {
  await expect(page.getByRole('alert')).toHaveText('Saved');
}

// ✅ assert the lasting result — this retries until the saved row appears,
//    and fails if it never does
await expect(page.getByRole('row', { name: /Ada Lovelace/ })).toBeVisible();
```

`isVisible()` is legitimate only when both branches are real, expected outcomes
(e.g. an optional cookie banner that may or may not exist). It is never a
substitute for waiting.

### Assert on the result that stays, not the toast

A toast or snackbar closes itself on a timer, and a web-first assertion on it
races that timer. On a slow run the toast is gone before the assertion starts,
so the check fails although the action worked. It is also weak proof: the
toast says the app reported success, not that the data changed.

Assert on what the action left behind: the new table row, the updated field,
the URL it navigated to, checked with `waitForURL` as Navigation Assertions
After Submit shows. That state stays until something changes it, so the
assertion waits as long as it needs to. A field the test typed into proves
nothing on its own, because it holds the typed value whether or not the save
worked. Read it after `page.reload()`, once `page.waitForResponse` has seen the
save come back.

```typescript
await page.getByRole('button', { name: 'Save' }).click();

// ✅ the new row renders from what the server stored
await expect(page.getByRole('row', { name: /Ada Lovelace/ })).toBeVisible();
```

Assert on the toast only when the toast is the behaviour under test: its
text, its role, its auto-close. Say so in a comment, so a reviewer reads it as
a choice:

```typescript
// ✅ the toast is the behaviour under test: the copy shown when a save fails
await page.getByRole('button', { name: 'Save' }).click();
await expect(page.getByRole('alert')).toHaveText('Could not save. Try again.');
```

---

## Ambiguous ARIA Role Across Contexts — Use `.or()`

The same logical UI element (a modal, a date picker) can legitimately render
under a different ARIA role depending on breakpoint or library version.
Query for both instead of picking one and hoping:

```typescript
const modal = page.getByRole('dialog').or(page.getByRole('menu'));
const datePicker = page.getByRole('application').or(page.getByRole('dialog'));
await modal.waitFor({ state: 'visible' });
```

**Rule:** if you've observed a role vary across contexts in your app, encode
that as `.or()` at the locator definition site rather than special-casing it
per test — every test that opens that surface benefits automatically.

**Caveat — `.or()` is a union, not a fallback.** It matches elements of
*either* locator, so it only works when the variants are **mutually
exclusive** — exactly one role present at a time (the breakpoint/library-version
case above). If both role variants can be in the DOM at once, `.or()` resolves
to two elements and any strict-mode operation on it throws "resolved to 2
elements". When both can coexist, disambiguate instead: scope to the visible
one (`.locator('visible=true')`) or filter, don't rely on `.or()`.

---

## Strict-Mode Violations from Duplicated Content

Playwright's strict mode fails a locator that resolves to more than one
element. A common, non-obvious cause: the same text is rendered twice —
once visibly inside a modal/panel, and once in a hidden ARIA live region
elsewhere on the page (for screen-reader announcements). Querying from
`page` resolves both:

```typescript
// ❌ Fails with strict mode violation — resolves the live-region copy too
const alert = page.getByRole('alert').filter({ hasText: 'Search returned no results' });

// ✅ Scope to the container that owns the interaction
const modal = page.getByRole('dialog');
const alert = modal.getByRole('alert').filter({ hasText: 'Search returned no results' });
```

**Rule:** when a locator query works in isolation (Playwright inspector) but
fails with "resolved to 2 elements" in a real test, suspect a duplicate
render (visible + ARIA-live, or visible + off-screen clone) before assuming
your selector is wrong. Scope to the nearest container that has the
interaction, not `page`.

---

## Absence Assertions Need a Positive Control

An absence assertion such as `toHaveCount(0)`, `not.toBeVisible()` or
`toBeHidden()` also passes when the locator matches nothing at all. A typo in
the name does that, and so does a wrong role or a copy of the element the
locator never reaches. A spec made only of absence checks passes whether the
fix works or the selector is wrong.

Pair each one with a **control**: the same locator matching in the same
spec, usually on a second seeded record that should show the element. A
passing control proves the locator can see the element at all.

```typescript
// ❌ Passes against a locator nobody has shown can match
await expect(archivedCard.getByText('Overdue')).toHaveCount(0);

// ✅ The same locator, on a record that must show the badge
const overdueBadge = (card: Locator) => card.getByText('Overdue').filter({ visible: true });
await expect(overdueBadge(activeOverdueCard)).toHaveCount(1);
await expect(overdueBadge(archivedCard)).toHaveCount(0);
```

The control also catches duplicate renders. A card that renders each badge
twice, one copy hidden, needs `filter({ visible: true })`; an absence-only
spec never finds that out, and the first positive check does.

**Rule:** write the control first, watch it pass, then add the absence
check through the same locator. `generate`'s `validate-specs.mjs` warns on
a spec whose only matchers assert absence.

---

## Regex in Accessible Names — Watch for Accidental Metacharacters

`getByRole(..., { name })` accepts either a string (case-insensitive
substring match, literal characters) or a `RegExp`. Wrapping dynamic or
translated label text in `new RegExp(...)` can silently create an
unintended pattern:

```typescript
// label text happens to be "When?" — building a RegExp from it makes "n" optional
// via the "?" quantifier, so the pattern also matches "Whe" — and therefore
// substrings of unrelated labels like "Where"
const label = 'When?';
new RegExp(label); // /When?/ — NOT a literal match for "When?"
```

**Rule:** don't wrap a label in `new RegExp()` unless you actually need
partial/pattern matching. If you only need substring matching (e.g. because
the rendered name has extra content appended, like a filled-in value), pass
the string directly — `getByRole('button', { name: label })` already does
case-insensitive substring matching on strings, no regex needed. Reach for
`RegExp` only when you need real pattern features (alternation, case
variations you can't predict, etc.), and treat any label containing regex
metacharacters (`?`, `.`, `*`, `(`, `)`) as a red flag before wrapping it.

---

## Hidden Form Elements — Click the Label, Not the Input

Toggle groups (radio buttons, checkboxes) are sometimes implemented as
visually-hidden native inputs paired with a styled visible label, purely for
accessibility semantics. Playwright refuses to click a hidden element, same
as a real user:

```typescript
// ❌ Fails — the radio input is visually hidden
await container.getByRole('radio', { name: 'Economy' }).click();

// ✅ Click the visible label that activates the hidden input
await container.getByText('Economy', { exact: true }).click();
```

Use `{ exact: true }` when one option's label is a substring of another's
(e.g. "Economy" vs. "Premium economy").

---

## Navigation Assertions After Submit

```typescript
// ✅ waitForURL + waitUntil: 'commit' — survives redirect chains, resolves
//    as soon as the URL is committed, without waiting for page load events
await page.waitForURL(/\/results\?.*query=/, { waitUntil: 'commit' });

// ❌ toHaveURL uses the expect timeout (often 3-5s) which can fire while the
//    URL is still transitional mid-redirect, causing flaky failures
await expect(page).toHaveURL(...); // avoid for post-submit navigation checks
```

`waitForURL` throws with a clear message on timeout, so there's no need to
follow it with a `toHaveURL` assertion. `waitUntil: 'commit'` matters
specifically when something (a cookie-consent dialog, a slow third-party
script) can block the `load` event on the destination page.

---

## Mocking & Interception

**Freeze time before setup**, so app initialization sees the mocked date.
Use `setFixedTime` — it pins `Date.now()` and `new Date()`. Do **not** use
`setSystemTime`, which sets the time but does not freeze it: timers still
fire and `Date.now()` is not pinned, so the loaded page can drift off the
value you set.

```typescript
await page.clock.setFixedTime(new Date('2024-07-03T00:00:00'));
await page.goto('/');
```

If the page needs its timers to run normally during load and only then be
frozen, `install({ time })` **before** navigation and `pauseAt(...)` once
the page is ready instead.

**Register route mocks before navigation** so they intercept the initial
load, not just subsequent requests:

```typescript
await page.route('**/api/search/**', route => route.fulfill({ json: [] }));
await page.goto('/');
```

**Attach `.catch()` to request-wait promises synchronously**, before any
`await` — a rejection that fires before you `await` the promise causes an
unhandled-rejection test failure, not a normal assertion failure:

```typescript
// ✅ catch attached before any async gap
const requestPromise = page.waitForRequest(/search/, { timeout: 5_000 }).catch(() => null);
await input.pressSequentially('query');
const request = await requestPromise;
// Then assert it actually fired — the .catch(() => null) only prevents the
// unhandled rejection; without this, a search that never happened passes silently.
expect(request, 'expected a /search request to fire').not.toBeNull();
```

**`page.evaluate` with a string, not an arrow function**, if your test
tsconfig doesn't include the DOM lib (common when the Playwright package
has its own narrow tsconfig) — an arrow function referencing `window` or
DOM globals fails type-checking, but a string body is opaque to `tsc`:

```typescript
await page.evaluate("window.dispatchEvent(new CustomEvent('my-event', { detail: {} }))");
```

**Seed `localStorage` after an initial navigation**, since it's
origin-scoped — you need a page load at the target origin before you can
write to it, then navigate again (or reload) so the app picks it up on
mount:

```typescript
await page.goto('/');
// String form, consistent with the tsconfig-without-DOM-lib note above —
// an arrow callback referencing `localStorage` would fail tsc there. Use
// the arrow form only if your test tsconfig includes the DOM lib.
await page.evaluate("localStorage.setItem('key', JSON.stringify('value'))");
await page.reload();
```

---

## Backends That Rotate Refresh Tokens

**Symptom:** runs shorter than the access-token lifetime pass. Longer runs lose
the session part-way, and later tests land on the login page. `run-specs` marks
those failures with `sessionExpired`.

**Cause:** every test loads one saved login from `.auth/user.json`. A backend
that rotates refresh tokens and blacklists the used one accepts each refresh
token once, for example a Django SimpleJWT backend with
`ROTATE_REFRESH_TOKENS` and `BLACKLIST_AFTER_ROTATION` on. The first test that
refreshes spends the token, and every other test holds a blacklisted one.

**Fix, when you own the backend:** raise the access-token lifetime in the test
environment above the suite's run time. The suite stays as it is.

**Fix, in the suite:** set `E2E_AUTH_MODE=per-worker` in the suite's `.env` or
the CI environment. Each worker logs in once through `fixtures/login.ts`, saves
`.auth/worker-<n>.json`, and writes its session back after every test, so a
rotated token carries to the worker's next test. A test that ends on the login
page makes the fixture log in again for the next one. Per-worker mode costs one
login per worker, so keep the shared mode for a backend without rotation.

**An existing suite** gets the mode from the current scaffold's
`fixtures/base.ts` and `fixtures/login.ts`. `fixtures/base.ts` is written only
when absent: move your additions aside, delete it, rerun `e2e-setup`, and put
the additions back. `write-auth-setup` writes `fixtures/login.ts`.

A per-test API login is a project-level fixture that each app writes for its
own backend.

---

## Quick Reference

| Symptom | Likely cause | Fix |
|---|---|---|
| Clicking an item from an async list intermittently hits the wrong item | Waited on the container, not the item | `item.waitFor({ state: 'visible' })` before click |
| "resolved to 2 elements" on a locator that looks unique | Content duplicated for ARIA-live announcement | Scope query to the interacting container, not `page` |
| A role-based locator works in one place, breaks in another that "should be the same" | Role changes across breakpoint/library version | `roleA.or(roleB)` at the locator definition site |
| `getByRole` matches an unrelated element | Label wrapped in `new RegExp()` unintentionally created a pattern | Pass the string directly unless you need real regex features |
| Click on a `radio`/`checkbox` role times out or errors "not visible" | Input is visually hidden behind a styled label | Click the label text instead, with `exact: true` if needed |
| Post-submit URL assertion flakes under load | `toHaveURL` racing a redirect | `waitForURL(..., { waitUntil: 'commit' })` |
| `page.waitForRequest(...)` causes "Test ended" instead of a normal failure | `.catch()` attached after an `await` gap | Attach `.catch()` synchronously, before any `await` |
| Test flakes intermittently around a `waitForTimeout`/`networkidle` | Fixed sleep or network-idle proxy instead of waiting on the real state | Web-first assertion — `await expect(locator).toBeVisible()` (see Timing) |
| An assertion inside `if (await x.isVisible())` never runs and the test passes blind | `isVisible()` is a non-retrying snapshot that races the render | Assert the state directly, don't branch — `await expect(x)...` |
| A spec asserting only `toHaveCount(0)` / `toBeHidden()` stays green even with a wrong selector | Absence matches a locator that matches nothing | Add a positive control through the same locator (see Absence Assertions Need a Positive Control) |
| A success-toast assertion fails intermittently, often on one viewport | The toast closed itself before the assertion ran | Assert on the lasting result, such as the new row, the updated field or the URL (see Timing) |
| Runs past the access-token lifetime log tests out; failures carry `sessionExpired` | Backend rotates refresh tokens and blacklists the used one | `E2E_AUTH_MODE=per-worker`, or a longer access-token lifetime in the test env (see Backends That Rotate Refresh Tokens) |

---

## House Style (Optional — Not Playwright-Specific)

Everything above is a Playwright technique or a real gotcha in the API. The
items below are **team conventions** about how to structure a suite — an
Apptension house style, generically useful but not Playwright facts, and not
everyone will agree with them. Adopt the ones that fit your team; **do not
treat this section as equivalent in authority to the rest of the document.**

### Page Object Model, split by responsibility

Keep three files per page/surface, each with one job, so a change touches the
smallest possible file. They sit together in the page's own folder, laid out in
[Page Object folders](#page-object-folders). The examples are TypeScript. Name
the files with the suite's own extension, and in a JavaScript suite write the
same shapes as plain JavaScript, since `.js` files do not load with type syntax
such as `(page: Page)`:

- `<page>/<page>.selectors.ts` — locators only, declared once as a function of `page`:

  ```typescript
  export const loginSelectors = (page: Page) => ({
    email: page.getByRole('textbox', { name: 'email' }),
    password: page.getByRole('textbox', { name: 'password' }),
    signInBtn: page.getByRole('button', { name: 'Sign in' })
  });
  export type LoginSelectors = ReturnType<typeof loginSelectors>;
  ```

  This is where the core rules above land in a POM: `getByRole` first, and a
  role that varies across contexts is `.or()`-ed here **once**, so every test
  using the surface inherits it.

- `<page>/<page>.page.ts` — actions (the user-facing verbs), composing
  selectors and assertions onto a thin `BasePage` (page handle + slug + `goto`)
  as fields rather than inheriting them. `generate` or `discover` writes
  `pages/base.page.<ext>` the first time a Page Object run needs it, one level
  above the page folders:

  ```typescript
  import { BasePage } from '../base.page';

  export class LoginPage extends BasePage {
    readonly s = loginSelectors(this.page);
    readonly assert = new LoginAssertion(this.page, this.slug, this.s);
    constructor(page: Page) { super(page, '/login'); }
    async signIn(email: string, password: string) {
      await this.goto();
      await this.s.email.fill(email);
      await this.s.password.fill(password);
      await this.s.signInBtn.click();
    }
  }
  ```

- `<page>/<page>.assertion.ts` — assertions grouped in their own class, so a test reads
  `await login.assert.toBeLoaded()` instead of scattering `expect` calls.
  Name each method like a Playwright matcher, `to` plus a capital
  (`toBeLoaded`, `toShowGuest`): the suite's missing-assertion check counts a
  call as an assertion only by its last name, and the one `e2e-setup` writes
  matches `^to[A-Z]`. In an ESLint suite that check is
  `eslint-plugin-playwright`'s `expect-expect` rule, and in a Biome suite it is
  the `expect-assertion.grit` plugin:

  ```typescript
  export class LoginAssertion {
    constructor(
      private readonly page: Page,
      private readonly slug: string,
      private readonly s: LoginSelectors
    ) {}
    async toBeLoaded() {
      await expect(this.page).toHaveURL(new RegExp(`${this.slug}$`));
      await expect(this.s.signInBtn).toBeVisible();
    }
  }
  ```

  A method named `loaded()` asserts the same thing, but the assertion check,
  ESLint's or Biome's, flags every test that calls it as a test with no
  assertion.

### Page Object folders

Each page or component gets one folder under `pages/`, holding its three files.
`base.page.ts` stays at the root of `pages/`:

```text
pages/
  base.page.ts
  login/
    login.selectors.ts
    login.page.ts
    login.assertion.ts
  sidebar/
    sidebar.selectors.ts
    sidebar.page.ts
    sidebar.assertion.ts
```

Name the folder by what it models, the same way every run, so two flows that
touch the sidebar share `pages/sidebar/`:

1. **Reuse.** List the folders already in `pages/`, and take the one that
   models the same page or component.
2. **Derive.** Otherwise, a page takes its route's path segments joined by `-`
   (`/settings/profile` is `settings-profile`, `/` is `home`), and a component
   shared across pages takes its component name (`sidebar`).

The name is one kebab-case component, which `write-specs.mjs` checks before it
writes anything. A flow that needs a selector, action or assertion a reused
page object lacks adds it to that page object's file.

Relative imports between the layers:

| File | Imports |
|---|---|
| `pages/<page>/<page>.page.ts` | `../base.page`, `./<page>.selectors`, `./<page>.assertion` |
| `fixtures/base.ts` | `../pages/<page>/<page>.page` |
| `specs/<flow>/<slug>.spec.ts` | `../../fixtures/base` |

### Fixtures inject ready page objects

Extend `test` so each test receives constructed page objects (`{ login,
calendar }`) instead of building them inline. Add a shared `page` fixture
that **fails a test on any uncaught `pageerror`**, even when its assertions
passed, and **surfaces `console.error` output as a report warning** without
failing (benign `console.error` is common — failing on it makes the suite
flaky). The `e2e-setup` scaffold ships this fixture in `fixtures/base.ts` by
default:

```typescript
page: async ({ page }, use, testInfo) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await use(page);
  for (const text of consoleErrors) {
    testInfo.annotations.push({ type: 'warning', description: `console.error: ${text}` });
  }
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
}
```

**When a base fixture exists, import `test` (and `expect`) from it, never
from `@playwright/test` directly** — the base fixture re-exports everything
from `@playwright/test` (`export * from '@playwright/test'`), so it is a
drop-in replacement, and a spec that imports straight from `@playwright/test`
gets the vanilla `test` and silently bypasses the page-error and console
listeners. Which file, and the relative path to it, depend on the layout:

- **Scaffolded repo** (`e2e/web/` with `fixtures/base.ts`): import from that
  base fixture, with the path relative to where the spec is written — e.g.
  `import { test, expect } from '../fixtures/base';` from `e2e/web/specs/`.
- **Existing / custom layout with its own fixture**: import from that fixture
  instead.
- **No base fixture anywhere** (a bare `e2e/specs` layout): import from
  `@playwright/test` as usual. Do not invent a `../fixtures/base` import that
  does not exist — it fails module resolution before the test runs. The
  page-error listeners simply do not apply until a base fixture is added.

### Other conventions

- **Register data cleanups via a tracker** (`data.track(...)`) that tears
  down in reverse order at teardown, so a test never leaks state to the next.
- **Wrap each logical section in `test.step()`.** Makes the exact failure
  point visible in the HTML report without scanning line numbers.
- **Declare shared locators once, right after setup, before any
  interaction.** Locators are lazy — they don't query the DOM until used —
  so declaring them upfront costs nothing and keeps the test linear to read.
- **DRY vs. indirection is a real tradeoff.** Some teams prefer fully inline,
  repetitive tests specifically because a reader shouldn't have to jump to a
  helper to know what's being asserted. Pick deliberately; don't inherit a
  "no helpers ever" or "extract everything" rule by default.
- **Name spec files by device + aspect** (`Search.validation.desktop.spec.ts`)
  rather than by aspect alone, when device-suffix routing (see above) is in
  play — keeps the two naming concerns visually distinct instead of colliding
  in one filename segment.
