---
name: complete-ui-states
description: Use when designing or implementing any screen, sheet, list, or form that loads data or mutates. Trigger on layout jumps, double-open sheets, flash of empty-then-content, missing offline UX, or "skeleton then jumps".
---

# Complete UI states

Happy-path-only UI is unfinished. Every data-backed surface ships the applicable states below.

## State matrix (fill before coding UI)

| State | What the user sees | Must preserve |
| --- | --- | --- |
| **Loading** | Region skeleton matching final geometry; `aria-busy` on awaiting control/region | Scroll position / open sheet / selected entity |
| **Empty** | Actionable next step + supporting art (see `supporting-imagery`) | Way out + primary CTA |
| **Error** | What happened + what to try next; calm voice | Drafts; no silent wipe |
| **Offline / pending sync** | Visible pending; optimistic where safe | Local intent until reconcile |
| **Success** | One quiet confirmation | Context; no duplicate modal+toast |
| **Conflict** | Explain mismatch; refresh or safe retry | No data loss where drafts apply |

## Hard rules learned the hard way

1. **Never flash “we don’t know” empty content, then replace with real data** without a loading state. First paint of unknown data → skeleton or previous-good frame.
2. **Never open a sheet → skeleton → re-open.** Prefetch or keep shell stable; skeleton inside an already-open surface if needed — not a second mount.
3. **No full-screen spinner for a single mutation.** Busy the control / row / card.
4. **Skeletons must match final layout** (same approximate heights/widths) — otherwise the “fix” is a jump.
5. **Optimistic UI for frequent commits** (logs, toggles, checklist ticks). Reconcile; on failure reverse with explanation.
6. **Pair every non-text signal** (colour, motion, icon) with text that works in day and night themes.

## Implementation patterns

```text
Screen mount
  → show shell + skeletons for unknown regions
  → hydrate data
  → cross-fade content (opacity) without changing outer geometry

Sheet open
  → if payload ready: render final form immediately
  → if not: open shell with internal skeleton (one open animation)
  → never unmount/remount the sheet for loading→ready
```

## Tests

Prefer component tests that assert:

- loading region has `aria-busy` or skeleton test ids
- empty state exposes the primary action
- error state exposes retry / guidance
- success announces via `role="status"` (or project pattern)

Manual QA notes only for device-only / a11y-hardware items.

Full ship bar: `../../checklists/SHIP-UI.md`. Reviewer aid when available:
`../../checklists/REVIEW-4G.md`.

## Anti-patterns

Blank white while fetching · spinner covering the whole app for one field · empty copy that looks like a finished empty state during load · success confetti · error toasts that don’t say what to do
