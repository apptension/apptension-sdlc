# Superpowers bridge (craft gates without forking)

`superpowers` in this marketplace is the upstream `obra/superpowers` plugin.
Do not expect brainstorming / writing-plans / verification to contain Apptension
frontend craft text. Agents with **this** plugin installed must apply the gates
below whenever UI is in scope.

## With `brainstorming`

For any user-facing UI, the design is incomplete until it includes:

1. Audience + stress context (who, when, one-handed / low-light / first-run?)
2. State matrix — loading / empty / error / offline / success / conflict
3. Visual direction — emotion, type, palette, imagery style, anti-references
   (see skill `award-level-visual-design`)
4. Imagery plan — which surfaces get art, or deliberate no-art
5. Motion character — token roles; what animates and why

Do not approve a UI design that omits the state matrix.

## With `writing-plans`

Every UI implementation task must include:

```markdown
- [ ] State matrix implemented (loading/empty/error/offline/success as applicable)
- [ ] Skeleton geometry matches final layout; no flash of empty-then-content
- [ ] Supporting imagery or documented no-art on the issue
- [ ] Motion uses project tokens; press feedback; reduced-motion path
- [ ] Forms: labels visible; ≥44px targets; no horizontal overflow at 360px
- [ ] Component test or QA note per AC (including experience ACs)
```

When dispatching implementer subagents, require the relevant skills from this
plugin (`product-experience-standard`, `complete-ui-states`, plus specialists).

## With `verification-before-completion`

If the changeset touches UI paths (`components`, `ui`, `app`, `pages`, styles,
brand assets), verification fails until the agent can affirm:

1. Applicable states present (or N/A justified)
2. No known layout jump on first load / sheet open for touched flows
3. Imagery present or no-art noted
4. No new hard-coded interactive motion timings
5. ~360px width check for touched forms/sheets

Record this in the PR **Experience** section (see Apptension SDLC PR template).

## With `requesting-code-review`

Append to the reviewer brief when UI files changed:

```text
PRODUCT EXPERIENCE:
- Complete states; no empty-flash-then-content; no sheet double-open
- Motion tokens + press feedback + reduced motion
- Imagery or documented no-art
- Forms: labels, 44px, no overflow at 360px
- Audience voice; anti-slop visuals vs brand docs
```

Point the reviewer at `apptension-review` code-review area **4g**.

## Direct track (Apptension SDLC)

Skipping brainstorming/plan ceremony does **not** skip this craft bar.
See `apptension-sdlc` / `docs/sdlc/dev-flow.md` — “Craft checklist is never skipped.”
