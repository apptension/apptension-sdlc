---
name: award-level-visual-design
description: Use when designing landing pages, marketing surfaces, app shell visuals, brand-led screens, or when the user asks for top-notch / premium / sleek / award-quality UI. Also use to prevent generic AI UI. Trigger on visual direction, hero composition, or "looks like every other SaaS".
---

# Award-level visual design

Produce interfaces that could sit next to Awwwards / FWA / Behance Site of the Day work **and** remain usable under stress. Study patterns from leading studios and awards — never copy assets or trademarks.

## Default path: existing system first

In agency and product work, you are usually **inside an existing website or design system**. That is the default:

- **Preserve** established patterns, structure, tokens, and visual language.
- **Extend** shared components before inventing parallel chrome.
- Apply the composition rules below only where they do not fight the system — use them to raise craft *within* the brand, not to replace it.

Greenfield (no design system / brand docs yet) is the exception: then lock a visual direction deliberately and use the hard rules as the starting contract.

## Hard composition rules

Use these as the craft bar for greenfield work, and as a checklist of *improvements that still fit* when extending an existing system.

1. **One composition** — The first viewport reads as one scene, not a dashboard (unless the product *is* a dashboard, and even then: one primary job).
2. **Brand first** — Brand/product name is a hero-level signal, not only nav text. **Brand test:** if you remove the nav, could this viewport belong to another brand? If yes, branding is too weak.
3. **Typography with intent** — Expressive, purposeful fonts. Avoid default stacks as the *voice* of the product (Inter / Roboto / Arial / system-only) unless the brand system already chose them.
4. **Atmosphere** — Don’t rely on flat single-color backgrounds; use gradients, imagery, or subtle patterns that match brand.
5. **Full-bleed heroes on promotional surfaces** — Dominant edge-to-edge visual plane. Avoid inset hero cards, side-panel heroes, tiled collages, floating media blocks unless the existing design system requires them.
6. **Hero budget** — First viewport usually: brand, one headline, one short supporting sentence, one CTA group, one dominant image. No stats strips, schedules, address blocks, or secondary promos in the first viewport.
7. **No hero overlays** — No detached labels, floating badges, promo stickers, or callout chips on top of hero media.
8. **Cards are not the default** — Never in the hero. Elsewhere, only when the container is needed for interaction. If removing border/shadow/background/radius doesn’t hurt understanding, remove it.
9. **One job per section** — One purpose, one headline, usually one short supporting sentence.
10. **Real visual anchor** — Show the product, place, atmosphere, or crafted illustration. Decorative gradients alone do not count as the main idea.
11. **Reduce clutter** — Avoid pill clusters, stat strips, icon rows, boxed promo spam, multiple competing text blocks.
12. **Motion for presence** — At least 2–3 intentional motions on visually led work (see `interaction-craft`). Not noise.

## Colour & look — avoid AI default clusters

Unless the brand already owns them, **do not** default to:

1. Purple-on-white or purple→indigo gradients  
2. Warm cream (~`#F4F1EA`) + high-contrast serif + terracotta accent  
3. Broadsheet layout: hairline rules, zero radius, dense newspaper columns  

Also avoid as lazy defaults: glow-everything dark mode, emoji decoration, rounded-full pill soup, multi-layer dramatic shadows.

Choose a **clear visual direction**, define CSS variables, and stick to them.

## Product UI (not only marketing)

Award craft on product screens means:

- Clear hierarchy: primary action wins size/weight/position
- Consistent rhythm of spacing (token scale)
- Quiet secondary chrome
- Imagery that supports, never steals the care/task
- Night/dark as a first-class composition, not inverted day

## Research habit (when greenfield)

Before locking visual direction, skim:

- 3–5 Awwwards/FWA case studies in a related emotion (calm, luxury, utility, play)
- Brand guidelines / `docs/vis` if present
- One strong product reference (Linear, Stripe, Family, etc.) for *craft*, not clone

Document the direction in the design spec (brainstorming) as: emotion, type pairing, palette, imagery style, motion character, anti-references.

Full ship bar: `../../checklists/SHIP-UI.md`. Prompt macros: `../../prompts/DISTILLED-PROMPTS.md` (P01, P12).
