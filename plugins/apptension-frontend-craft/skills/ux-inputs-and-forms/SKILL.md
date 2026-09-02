---
name: ux-inputs-and-forms
description: Use when building forms, pickers, choice groups, settings, log sheets, or any mobile data entry. Trigger on horizontal overflow, native datetime pain, placeholder-only fields, unclear options, or "beautify forms without changing functionality".
---

# UX inputs and forms

Prefer **recognition over recall**. Design for one-handed mobile use first.

## Defaults

- Prefer predefined options (chips, option cards, segmented controls) over free text.
- Always offer an honest escape hatch where data is optional or uncertain (“I don’t know yet” / “Prefer not to say” / equivalent). Missing optional data is not an error.
- Visible labels; never placeholder-only. Hints explain *why*, not decorate.
- Touch targets **≥ 44×44 CSS px** (hit area may exceed visual size).
- Primary actions in the thumb zone.
- Works from **360×640** through desktop with the same components.
- Theme variants (e.g. night): lower luminance, keep AA contrast, no bright full-screen flashes.

## Choice patterns

| Need | Pattern |
| --- | --- |
| Single-select | Radiogroup / choice group |
| Multi-select | Choice group with multiple |
| Dense ranges | Large option cards: short label + optional secondary line |
| Free text | Names, notes, or “Other” after a choice |

## Form layout craft

- Labels left / controls right when scanning lists of toggles (or project convention — be consistent).
- Section separators and typography that teach the path — not mystery meat fields.
- Custom date/time pickers when native controls overflow or fight thumbs — **never** allow horizontal page scroll from a single input.
- Scrubbers / sliders that encode meaning with colour (e.g. safe→warn ranges) should update continuously while dragging and respect unit settings.
- Reuse the same log/form layouts for create and edit; don’t fork parallel UIs.

## Voice

Read the repo’s voice doc if present. Defaults for calm products:

- No streaks, grades, punishment, or “perfect X” promises unless the product truly is a game.
- Errors: what happened + what to try next.
- Avoid internal engineering words in UI (hypothesis, governance, calibration, versioning as jargon).

## Polish-only mode

When the human says “do not change functionality”:

- Allowed: layout, typography, spacing, separators, copy clarity, control chrome, consistency with siblings
- Forbidden: new fields, removed validations, API contract changes, permission changes

Full ship bar: `../../checklists/SHIP-UI.md`. Reusable macros:
`../../prompts/DISTILLED-PROMPTS.md` (P04, P05, P10, P11).

## Anti-patterns

Native `datetime-local` blowing past viewport · placeholder-as-label · tiny hit targets · duplicate create/edit forms · technical jargon in helper text · forcing free text for enumerable choices
