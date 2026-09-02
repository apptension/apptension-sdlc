# apptension-frontend-craft

Award-informed product experience skills for AI coding agents — complete UI
states, interaction craft, supporting imagery, forms, polish passes, and
anti-slop visual design.

## When to use it

I turn this on when I'm about to **build or polish user-facing UI** and want
agents to ship calm, original, complete-state interfaces — not happy-path
template chrome.

## What's inside

Skills:

- `product-experience-standard` — umbrella Done bar; points at the specialists
- `complete-ui-states` — loading / empty / error / offline / success / conflict
- `interaction-craft` — motion tokens, press feedback, reduced motion
- `supporting-imagery` — required art for new surfaces (or documented no-art)
- `ux-inputs-and-forms` — mobile forms, choices, labels, overflow
- `award-level-visual-design` — composition, brand strength, anti-AI-slop
- `frontend-polish-pass` — polish without changing functionality

Bundled (not skills — agents read on demand):

- `checklists/SHIP-UI.md` — pre-Done craft checklist
- `checklists/REVIEW-4G.md` — product-experience review checklist
- `prompts/DISTILLED-PROMPTS.md` — reusable human/agent prompt macros
- `references/SUPERPOWERS-BRIDGE.md` — how this plugs into Superpowers process
- `references/PRESSURE-SCENARIOS.md` — TDD-for-docs scenarios

## Notes

**Why a new plugin (not folded into `apptension-review` or `apptension-sdlc`):**
Review is read-only findings; SDLC is issue→PR process. Frontend craft is a
separate toggle — *"I turn this on when building UI"* — and can grow without
diluting those intents. See [`plugins/README.md`](../README.md).

**Superpowers is external** (`obra/superpowers`). We do not fork it here.
`references/SUPERPOWERS-BRIDGE.md` tells agents how to apply craft gates
during brainstorming, planning, verification, and review dispatch.

**Path convention:** skills resolve relatives from their own directory.
Bundled checklists / prompts / references are at the plugin root, so skills
link them as `../../checklists/…`, `../../prompts/…`, `../../references/…`
(same pattern as `apptension-sdlc` → `../../docs/…`).

Pairs with:

- `apptension-review` `code-review` area **4g. Product experience**
- `apptension-sdlc` craft-never-skipped note + UI AC template + PR Experience
