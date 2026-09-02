---
name: product-experience-standard
description: Use when building, redesigning, or reviewing any user-facing UI — screens, sheets, empty/loading/error states, onboarding, marketing pauses, or card headers. Umbrella craft bar for calm, original, complete-state interfaces. Trigger on frontend work, polish passes, "make it look premium", or before marking a UI story Done.
---

# Product experience standard

Umbrella **decision and Done bar** for frontend. Specialized skills carry tables — do not re-derive them:

| Topic | Skill |
| --- | --- |
| Motion, press, gestures, reduced motion | `interaction-craft` |
| Illustrations / empty-state art | `supporting-imagery` |
| Choices, forms, voice, touch | `ux-inputs-and-forms` |
| Loading/empty/error/offline/success/conflict | `complete-ui-states` |
| Composition, brand strength, anti-slop | `award-level-visual-design` |
| Polish-only passes | `frontend-polish-pass` |

## Core principle

Ship interfaces that feel **calm, original, and cared for**, while keeping primary data and actions dominant. Prefer recognition over recall. Preserve **where the user was** when loading, saving, failing, or going offline.

## Audience first (required)

Before implementing UI, name in one line each:

1. **Who** (role + competence — not “users”)
2. **Context stress** (rushed? one-handed? low light? first-time?)
3. **Job on this screen** (one sentence)
4. **Success** (what they can do after that they couldn’t before)

If the repo has a voice / brand / `docs/vis` / design-system doc — read it. Do not invent a parallel visual language.

## Mobile-first hierarchy

- Layout from **360×640** upward; same components, responsive — not a separate mobile site.
- Primary actions in the **thumb zone**; secondary actions in sheets/menus/trailing affordances.
- Sticky orientation when long scroll would hide context (date, filter summary, entity name).
- Care facts and controls above decorative chrome; heroes must not push primary actions below the fold on mobile.

## Complete states (non-negotiable)

Every user-facing flow ships applicable states — see `complete-ui-states`. Happy-path-only UI is incomplete work.

## Token-driven motion

Durations/easings come from project CSS tokens (`--*-duration-*`, `--*-ease-*`). Never hard-code ms / bare `duration-300` on interactive paths. Details: `interaction-craft`.

## Supporting art

New or redesigned sections, empty/loading/error, onboarding, and card headers include intentional illustration via the project’s shared imagery API — unless the issue documents deliberate “no art”. Details: `supporting-imagery`.

## Component boundaries

UI components render state and dispatch named actions. Network parsing, mutation orchestration, and normalized error copy live in feature clients/hooks. Keep domain geometry in pure lib functions when possible.

## Decision checklist (before Done)

1. Would a stressed user understand this in one glance on a phone?
2. Are loading, empty, error, offline, success, conflict designed where applicable?
3. Do motion, art, and copy follow specialized skills?
4. Targets ≥44px, themes, 200% zoom, reduced motion verified?
5. Every AC tied to a test or documented QA note?

## With Superpowers and Apptension SDLC

Superpowers is an external plugin — it does not embed these craft rules.
When UI is in scope, also follow
`../../references/SUPERPOWERS-BRIDGE.md` (brainstorming state matrix,
plan checkboxes, verification gate, reviewer brief). Before Done, run
`../../checklists/SHIP-UI.md`.

Apptension SDLC: craft is never skipped on the direct track; UI issues should
carry experience ACs; PRs should include an **Experience** section.

## Anti-patterns

- Happy-path-only UI · generic empty screens · full-screen spinner for one action
- Hard-coded motion timings · fetch logic in JSX · closing issues without per-AC evidence
- Template-blank sections · stock clichés · gamification chrome that fights the product voice
- Breaking tenancy / auth / write rules for UI convenience
