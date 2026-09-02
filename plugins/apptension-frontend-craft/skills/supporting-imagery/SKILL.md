---
name: supporting-imagery
description: Use when adding or redesigning a user-facing section, empty/loading/error state, onboarding step, marketing pause, or card header. Trigger on sparse UI, missing illustrations, icon generation, or "make it feel premium/cared for".
---

# Supporting imagery

The product should feel premium, playful where appropriate, and well cared for — never sparse or template-blank.

## Defaults

- Prefer the project’s shared illustration / page-header API over one-off `<img>` tags.
- **Compact spots** (`xs` / card accents): object-only soft icons in brand palette — not mini people scenes — unless brand system says otherwise.
- **Editorial crops** (`sm`/`md` heroes, welcome pauses): richer scenes allowed per brand.
- Day and night variants when the surface is time-of-day specific.
- Keep forms, data, safety/critical copy, and controls dominant; imagery is decorative/supporting.
- Export responsive optimized assets (e.g. WebP 640/1280) under the project brand path with deterministic names; keep source PNGs out of the runtime bundle when possible.

## Decorative image semantics

- Empty `alt`, `aria-hidden`
- Intrinsic width/height
- `srcSet` / `sizes`
- `decoding="async"`
- `loading="lazy"` (eager only above the fold)

## Checklist before Done

- [ ] New surface has intentional illustration **or** a deliberate “no art” note on the issue
- [ ] Placement covered by a component test (decorative semantics + asset key)
- [ ] Assets optimized; no layout shift; works at 360×640 and in day/night themes

Full ship bar: `../../checklists/SHIP-UI.md`.

## Generation brief (when creating new art)

Give the image agent:

1. Brand palette + style keywords from `docs/vis` / brand guidelines
2. Scene vs object-only decision
3. Safe / inclusive constraints for the domain (e.g. no unsafe situations, no stereotype roles)
4. Day/night pair if needed
5. Exact export sizes and filenames

## Anti-patterns

- Shipping empty/loading/welcome as plain text with no visual anchor
- Stock photos, cliché genre imagery, or replacing functional SVG icons with muddy rasters
- Oversized heroes that push primary actions below the fold on mobile
- People-in-scene art stuffed into 24px tracker chips
