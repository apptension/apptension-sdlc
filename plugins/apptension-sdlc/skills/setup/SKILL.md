---
name: setup
description: Use when the user explicitly asks to set up or adopt the Apptension SDLC in a repo — auditing the repo against the process checklist, recording its bindings in CLAUDE.md, and filing an issue per remaining gap. Trigger on intent like "set up the SDLC here", "adopt apptension-sdlc in this repo", "audit this repo against our process", or "run setup". Do not invoke on your own because a bindings section is missing — suggest it instead.
---

# Setting up a repo

The canonical process is in `../../docs/setup.md` (bundled in this
plugin). Read it and follow it, in order, from step 0 — the question
about who is adopting the flow comes before anything is read, and it
decides what step 5 is allowed to file.

The checklist it audits against is `../../docs/checklist.json`, bundled
alongside it. Read each entry's `intent`, `grants` and `source` off that
file and render them verbatim; do not rewrite them from memory.

Never write to the repo — no file, no label — and never file an issue
before the human has seen what setup proposes — the drafted bindings,
and the issues or the backlog that go with them — and approved it. See
the doc's human gate. After approval the bindings write lands
uncommitted: no staging, no commit, no branch, no push.
