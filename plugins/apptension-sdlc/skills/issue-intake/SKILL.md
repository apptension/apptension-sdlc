---
name: issue-intake
description: Use when a new issue is opened in this repo, to check it for duplicates and apply best-fit labels from the repo's label set. Trigger on intent like "triage issue #N", "check this issue for duplicates", or "auto-label this issue".
---

# Issue auto-triage: duplicate detection and auto-labeling

The canonical process is in `../../docs/issue-intake.md` (bundled in
this plugin). Read it and follow it: search for duplicates first,
close per its high-confidence bar; only if not closed, apply best-fit
labels from the repo's label set.

This repo's concrete label set and `claude-code-action` bindings are
in that doc's "Bindings this process needs per repo" table.

When calling `gh issue close` or `gh issue edit`, always target the
issue by its bare number (e.g. `gh issue close 42 --reason duplicate
--duplicate-of 7 --comment "..."`), never a URL or `owner/repo#42`
form — the workflow's `--allowedTools` scoping matches only the
bare-number form, and any other form is silently denied. Always scope
`gh search issues` to this repo explicitly; unlike `gh issue list`, it
does not default to the current repository.
