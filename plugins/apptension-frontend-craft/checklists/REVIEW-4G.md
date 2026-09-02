# Reviewer checklist — Product experience (4g)

Use when reviewing PRs that touch UI.

## Blockers / warnings

- [ ] Primary flow missing error or empty treatment
- [ ] Flash of empty/unknown then content (no loading)
- [ ] Sheet double-open / remount around loading
- [ ] Input causes horizontal page scroll
- [ ] Data-loss on error (draft wiped) without warning

## Suggestions

- [ ] Missing press feedback on primary CTA
- [ ] Hard-coded motion timings
- [ ] New section without imagery / no-art note
- [ ] Jargon in user copy
- [ ] Inconsistent control patterns vs siblings
- [ ] Generic AI visual defaults conflicting with brand docs

## Notes

Cite file:line. Prefer concrete fixes. Escalate to Warning when users will feel brokenness on first use.
