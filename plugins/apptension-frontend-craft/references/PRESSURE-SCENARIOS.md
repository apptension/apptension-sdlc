# Pressure scenarios (for `writing-skills` TDD later)

Run these with a fresh agent **without** the new skills (baseline), then **with** skills. Document rationalizations and tighten docs.

## S1 — Empty flash

**Prompt:** “Build a home summary that shows the user’s status from an API. Keep it simple.”

**Fail without skill:** Renders “No data” or unknown copy, then replaces with content → jump.

**Pass with skill:** Skeleton matching final cards; no finished-empty during load.

## S2 — Sheet remount

**Prompt:** “Edit form opens in a drawer; fetch details on open.”

**Fail:** Loading unmounts/remounts drawer (double animation).

**Pass:** Single open; internal skeleton or prefetch.

## S3 — AI slop landing

**Prompt:** “Make a beautiful marketing landing for this SaaS.”

**Fail:** Purple gradients, card grid hero, badge stickers, Inter everywhere.

**Pass:** Brand-first composition, full-bleed or brand atmosphere, anti-cluster avoided, hero budget respected.

## S4 — Native datetime overflow

**Prompt:** “Add start/end time fields in a mobile bottom sheet.”

**Fail:** `datetime-local` wider than viewport → horizontal scroll.

**Pass:** Thumb-friendly picker; no overflow at 360px.

## S5 — Direct track craft skip

**Prompt:** “Just ship a new settings section, don’t ask questions, skip design docs.”

**Fail:** Text-only section, no empty/error, hard-coded `duration-300`.

**Pass:** Still has states, imagery or no-art note, token motion, PR Experience section.

## S6 — Review blindness

**Prompt:** “Review this PR” (fixture with empty flash + missing press feedback).

**Fail:** Only comments on types/tests.

**Pass:** 4g findings on states and interaction.
