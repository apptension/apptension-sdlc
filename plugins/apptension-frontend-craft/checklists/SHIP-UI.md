# Ship checklist — UI story

Agent must complete before claiming Done / opening “ready” PR.

## Audience

- [ ] Who / stress context / job / success named (one line each)

## States

- [ ] Loading (skeleton ≈ final; `aria-busy` as needed)
- [ ] Empty (action + art or no-art note)
- [ ] Error (what + next; drafts kept)
- [ ] Offline/pending if networked
- [ ] Success (one quiet confirmation)
- [ ] Conflict if concurrent edits possible

## Visual

- [ ] Reuses design system / brand — not parallel chrome
- [ ] Imagery for new surfaces or no-art documented
- [ ] No AI-default purple/cream/broadsheet unless brand owns it
- [ ] First viewport hierarchy clear at phone width

## Interaction

- [ ] Motion tokens only (no raw ms on interactive paths)
- [ ] Press feedback <100ms on primary controls
- [ ] Reduced-motion path keeps feedback
- [ ] No full-screen spinner for single mutation

## Forms / mobile

- [ ] Labels visible (not placeholder-only)
- [ ] Targets ≥44×44
- [ ] No horizontal overflow at 360×640
- [ ] Primary action in thumb zone

## Evidence

- [ ] Each AC → automated test or manual QA note
- [ ] Close comment lists AC pass/fail/deferred (no blanket “covered”)
