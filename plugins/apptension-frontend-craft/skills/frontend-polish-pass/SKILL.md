---
name: frontend-polish-pass
description: Use when the user asks to polish UI without changing functionality, level-up visual quality across screens, fix inconsistencies between panels, or run a design expert pass. Trigger on "top notch", "beautify", "sleek", "final touches", or inconsistency hunts.
---

# Frontend polish pass

A structured pass that raises visual and interaction quality **without changing product behaviour**.

## Scope contract (state aloud)

**In scope:** layout, spacing, typography, colour tokens, separators, control chrome, micro-interactions, copy clarity, imagery, consistency with sibling components, accessibility of the presentation.

**Out of scope unless asked:** new fields, API changes, permission model, analytics events, data model, navigation IA redesign.

## Process

1. **Extract the visual language** — Read `docs/vis`, brand guidelines, design system, existing `src/ui` primitives. List 5–10 concrete tokens/patterns to reuse.
2. **Inventory target surfaces** — Screens/sheets named by the human, or “whole app” broken into priority lanes (shell → primary jobs → secondary).
3. **Inconsistency hunt** — Same action styled three ways? Create vs edit forked? Different empty states? Fix toward the best existing pattern.
4. **Apply specialized skills** — `award-level-visual-design`, `interaction-craft`, `complete-ui-states`, `supporting-imagery`, `ux-inputs-and-forms`.
5. **Verify** — Focused visual QA at 360×640 + desktop; day/night; reduced motion. Lint/tests for touched files. Avoid full build unless needed.
6. **Report** — What changed visually; what was deliberately left; any follow-ups that *would* need functional changes.

## Quality bar prompts (self-check)

- Does every revised panel look like it belongs to the same product family?
- Are primary actions obvious within 3 seconds?
- Any layout jump on load or sheet open?
- Any control wider than the viewport?
- Any jargon left in user-facing copy?
- Any new section without imagery or a documented no-art decision?

## Parallelism

Generate missing illustrations/icons in parallel. Prefer worktrees when main is busy. Do not ask clarifying questions when the human explicitly said “just progress” — make tasteful decisions inside the scope contract and note them in the PR/report.

## Bundled aids (paths relative to this skill)

- Ship checklist: `../../checklists/SHIP-UI.md`
- Prompt macros: `../../prompts/DISTILLED-PROMPTS.md`
- Superpowers gates: `../../references/SUPERPOWERS-BRIDGE.md`
