---
name: playwright-testing-patterns
description: Use when writing or reviewing Playwright end-to-end tests — especially UI with async-populated lists (autocomplete, search results, filtered dropdowns), ARIA roles that vary by breakpoint or library version, strict-mode "resolved to N elements" violations, getByRole matching the wrong element, hidden radio/checkbox inputs, flaky navigation after form submit, or route/clock mocking order.
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

// ✅ assert it — this retries until the toast appears, and fails if it never does
await expect(page.getByRole('alert')).toHaveText('Saved');
```

`isVisible()` is legitimate only when both branches are real, expected outcomes
(e.g. an optional cookie banner that may or may not exist). It is never a
substitute for waiting.

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

---

## House Style (Optional — Not Playwright-Specific)

Everything above is a Playwright technique or a real gotcha in the API. The
items below are **team conventions** about how to structure a suite — an
Apptension house style, generically useful but not Playwright facts, and not
everyone will agree with them. Adopt the ones that fit your team; **do not
treat this section as equivalent in authority to the rest of the document.**

### Page Object Model, split by responsibility

Keep three files per page/surface, each with one job, so a change touches the
smallest possible file:

- `X.selectors.ts` — locators only, declared once as a function of `page`:

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

- `X.page.ts` — actions (the user-facing verbs), composing selectors and
  assertions onto a thin `BasePage` (page handle + slug + `goto`) as fields
  rather than inheriting them:

  ```typescript
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

- `X.assertion.ts` — assertions grouped in their own class, so a test reads
  `await login.assert.loaded()` instead of scattering `expect` calls.

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
