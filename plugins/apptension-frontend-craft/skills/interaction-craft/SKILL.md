---
name: interaction-craft
description: Use when implementing or reviewing UI motion, press feedback, sheets, route transitions, toasts, drag/swipe, or reduced-motion behavior. Trigger on animation work, "feels laggy", inert buttons, layout jumps during transitions, or night-theme flashes.
---

# Interaction craft

Craft means **calm confidence**, not spectacle. The interface should feel alive and cared for while never demanding attention it hasn’t earned.

## 1. Motion tokens are mandatory

Durations and easings live in the project’s global CSS tokens. Never hard-code millisecond values or bezier curves in CSS/Tailwind for interactive UI.

Suggested token ladder (adapt names to project; keep the *roles*):

| Role | Typical | Use for |
| --- | --- | --- |
| duration-1 | ~120ms | Checkmarks, icon swaps, press |
| duration-2 | ~180ms | Hover, focus rings, field/chip |
| duration-3 | ~240ms | Toggles, toasts, backdrops, theme |
| duration-4 | ~360ms | Sheets, route/section entrances |
| duration-5 | ~520ms | Editorial reveals, welcome pauses |
| ambient | ~1.8s | Shimmer / breathing loops only |

| Ease role | Use for |
| --- | --- |
| standard | Default; things that stay on screen |
| entrance | Arriving — decelerate into place |
| exit | Leaving — accelerate away; **faster than entrance** |
| spring | Earned confirmation only (saved, done) |

```tsx
// ❌ BAD
<button className="transition-all duration-300 ease-out" />

// ✅ GOOD
<button className="transition-[transform,opacity] duration-[var(--app-duration-2)] ease-[var(--app-ease-standard)]" />
```

Never animate `all`; list properties. Exits faster than entrances.

## 2. Compositor properties only

`transform` and `opacity` on the 60fps path. Do not animate `width`, `height`, `top`, `margin`, `box-shadow`, or `filter` for interaction — use scale/translate, wrappers, or `clip-path`. `will-change` only while actively animating.

Target: 60fps on mid-range Android, not just a MacBook.

## 3. Sub-100ms acknowledgement

A tap must visibly change something before the network is consulted.

- Press: `active:scale-[0.97]` (or `0.99` for large cards) + duration-1.
- Optimistic first for frequent commits; reconcile; reverse with explanation if server disagrees.
- Loading is a *state of the thing*: `aria-busy` on control; skeleton in the region — matching final layout.
- Success: one spring confirmation + quiet `role="status"`. No confetti / success modal for banal actions.
- Haptics only on real commits, feature-detected, never under reduced motion, never on scroll/hover.

## 4. Motion must mean something

Legitimate reasons:

- **Origin** — sheet rises from the control that opened it
- **Hierarchy** — stagger 40–60ms, max ~5 items, only on first reveal
- **Direction** — forward from trailing edge; reverse on back; respect RTL
- **Consequence** — removed item collapses its space

If none apply → ship static. Decorative motion on high-frequency screens becomes friction.

## 5. Reduced motion and themes

- Honour `prefers-reduced-motion: reduce`. JS checks via `matchMedia` in `useEffect` — never first render (hydration).
- Under reduced motion: keep opacity/colour cross-fades so state stays legible.
- Night / dark: no bright flashes, no white overlays, lower motion amplitude.
- Motion is never the only signal — pair with text/icon/colour that passes AA.

## 6. Gestures never stand alone

Swipe / long-press / drag are accelerators on a visible control. Every gesture has a tappable equivalent. Drag follows finger 1:1; commit past threshold with preview. Destructive gestures → undo, not modal spam. Respect `touch-action` and `env(safe-area-inset-*)`.

## Craft checklist before Done

- [ ] Tokens only — no raw ms / bare `duration-300`
- [ ] Only transform/opacity on interactive paths
- [ ] Press, loading, empty, error, offline, success designed
- [ ] Reduced-motion path verified; focus-visible unchanged
- [ ] 360×640, 200% zoom, day + night
- [ ] No layout shift on entrance; skeleton = final layout
- [ ] Component test asserts state behaviour (not animation frames) + axe where practical

Full ship bar: `../../checklists/SHIP-UI.md`.

## Anti-patterns

Bouncy springs on routine actions · full-screen spinners for one log · gamified celebration chrome · parallax / scroll-jacking · hover-only affordances · motion that delays experts who already know the path
