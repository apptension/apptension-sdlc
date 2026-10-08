# The micro track

Read when the design gate at step 5 picks the micro track.

## The call

State the call in one line and keep going. Do not wait for confirmation:
the human naming the surface is the sanction for skipping brainstorming,
and it lapses when the change leaves that surface.

> `index.module.css` only, no exported behaviour, no new dependency —
> micro track, implementing now.

Done when the call is stated.

## What the micro track waives and keeps

| Step | On the micro track |
|---|---|
| Spec and plan (step 5) | Waived, as on the direct track |
| Human confirmation (step 5) | Waived: state the call, do not wait |
| Verification (step 7) | Only the commands the touched paths bind; `implement-issue`'s micro-track reference states the waiver |
| E2E tests (step 8) | Skipped, whatever the `E2E` row says |
| Pre-flight (step 2) | Kept, every check |
| Craft checklist (step 6) | Kept |
| TDD (step 6) | Kept, under step 6's definition of testable |
| `pr-checks` monitor loop (step 10) | Kept, unchanged |
| PR body, board sync, commit convention | Kept |

Steps 6 to 10 belong to `implement-issue`.

## Promotion

The micro track ends the moment implementation touches anything outside the
named surface. One line in one other file is outside. The named surface
never widens to take one more line elsewhere.

- Keep the branch and the diff. Revert nothing.
- Treat none of the diff as sanctioned; judge it with the whole change.
- Return to step 5 of this skill and run the gate against what the change
  turned out to be: the direct track if its four criteria hold, the design
  track otherwise. `implement-issue` notices the promotion and says what
  happens next. Under `dev-flow` it returns here, and once the gate
  approves the change, the run resumes at `implement-issue` step 6 on the
  same branch. A standalone run stops.
- Re-run everything the micro track waived: the human confirmation, and the
  full binding verification suite against the whole diff.

Promotion is one-way: never demote to the micro track mid-flight, however
small the remaining work looks. Gate on whether the change can break
something you did not read, never on diff size.
