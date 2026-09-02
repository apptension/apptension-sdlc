# Distilled prompt library

Source: Nini agent transcripts (design/polish/UX themes). Rewritten **product-agnostic**. Use as slash-prompt seeds, skill examples, or human macros.

---

## P01 — Visual language extraction + app-wide polish

```text
You are a senior product designer + UI implementer. Read the project's brand /
docs/vis / design-system materials. Extract the visual language (type, colour,
spacing, imagery, motion character). Do not change functionality. Extend the
design system and polish UI so the product feels modern, sleek, and award-
caliber: micro-interactions, rich form controls, consistent chrome. Generate
supporting imagery/icons in brand style where surfaces are sparse. Prefer a
worktree. Verify touched flows still work. Open a draft PR.
```

**Maps to:** `frontend-polish-pass`, `award-level-visual-design`, `supporting-imagery`

---

## P02 — Polish without questions (direct track)

```text
Polish and implement. Do not ask clarifying questions — make tasteful decisions
inside: layout, typography, imagery, micro-interactions, copy clarity. Do not
change functionality or API contracts. Raise a PR when green on lint/tests for
touched areas.
```

**Maps to:** SDLC direct track + craft checklist (never skip states/imagery)

---

## P03 — Complete loading / kill layout jump

```text
This screen flashes empty/unknown content, then jumps when data arrives. Add a
proper loading state: region skeletons that match final geometry, preserve
context, no full-screen spinner. Fix any sheet that skeleton-remounts (double
open). Do not change business logic.
```

**Maps to:** `complete-ui-states`

---

## P04 — Form UX beautify (no functional change)

```text
Beautify these forms with typography, spacing, separators, and mobile UX best
practices so users always know what to do. Visible labels. Prefer choices over
free text. Touch targets ≥44px. No horizontal overflow at 360px width. Do not
change functionality — only layout, UX chrome, and copy clarity. Align with
sibling panels; fix inconsistencies.
```

**Maps to:** `ux-inputs-and-forms`, `frontend-polish-pass`

---

## P05 — World-class mobile date/time

```text
Replace the overflow-prone native date/time control with a fast, thumb-friendly,
brand-styled picker for create/edit flows. Must never widen the sheet beyond
the viewport. Optimize for one-handed mobile use. Implement; don't interview me.
```

**Maps to:** `ux-inputs-and-forms`

---

## P06 — Audience voice rewrite

```text
Rewrite this panel's copy for the real user (tired, non-technical, deciding
in seconds). Remove internal jargon. Be explicit, calm, and actionable. Keep
functionality identical. Improve hierarchy so the primary tip/action is obvious.
```

**Maps to:** `ux-inputs-and-forms` voice section + `product-experience-standard`

---

## P07 — Supporting imagery flood (premium care)

```text
Add coordinated supporting illustrations across sections, empty states,
onboarding, and card headers so the app feels premium and cared for — not
sparse. Prefer the shared illustration API. Object-only icons for compact
spots; richer editorial crops for heroes. Day/night where relevant. Export
optimized responsive assets with deterministic names. Embed them; add a cursor
rule / skill reminder that new surfaces require imagery or a documented no-art
decision.
```

**Maps to:** `supporting-imagery`

---

## P08 — Motion entrance / constructed feel

```text
Once the shell is ready, animate in primary regions and navigation with
token-based motion so the layout feels intentionally constructed — subtle,
elegant, 60fps. Honour reduced motion. No layout shift. Press feedback on
primary controls.
```

**Maps to:** `interaction-craft`

---

## P09 — Optimistic / non-blocking save

```text
Saving currently blocks and delays sheet close. Make commit optimistic /
non-blocking: acknowledge in <100ms, animate the drawer closed gracefully,
reconcile in background, reverse with calm explanation on failure.
```

**Maps to:** `interaction-craft`, `complete-ui-states`

---

## P10 — Inconsistency hunt on one panel

```text
Polish this panel. Find inconsistencies vs sibling log/settings panels (label
placement, note field styling, headers truncating, control patterns). Reuse
shared layouts. Keep all functionality.
```

**Maps to:** `frontend-polish-pass`

---

## P11 — Meaningful continuous feedback control

```text
Build/refine this scrubber/slider so values update continuously while dragging,
encode meaning with colour ranges from settings/units, and stay horizontally
contained. Pair with accessible text value. No instructional filler copy if the
control is self-explanatory.
```

**Maps to:** `ux-inputs-and-forms`, `interaction-craft`

---

## P12 — Final award pass

```text
Final visual pass based on best-in-class product UI (Awwwards/FWA/Behance craft
patterns + our brand). Keep functionality intact. Kill clutter, strengthen
hierarchy, fix weak cards, ensure states and imagery are complete. Verify at
360×640 and in both themes.
```

**Maps to:** `award-level-visual-design` + full craft set

---

## P13 — Performance after polish

```text
After recent UI changes the app feels slow. Profile interactions and route
changes. Fix regressions without removing craft. Keep 60fps transitions;
prefer compositor-only animation; avoid layout thrash. Add/adjust tests that
catch the hotspot.
```

**Maps to:** performance + `interaction-craft` (compositor rules)

---

## Anti-prompts (do not teach agents these)

- “Make it pop” with no constraints → purple glow slop  
- “Add cards everywhere” → card soup  
- “Use a full-screen loader while we fetch one field”  
- “Placeholder is enough for labels”  
- “Animation on everything”  
- “Done — AC covered” without per-AC evidence  
