---
name: pr-checks
description: Use right after opening a draft PR in this repo (the tail of dev-flow's draft-PR step) to start watching CI and review feedback and auto-fix what it can. Trigger on intent like "draft PR is open, keep watching", "monitor this PR", or "watch CI and review comments".
requires:
  - id: verification-workflow
    label: Verification suite running on every pull request
    area: ci
    confirm: true
    detect:
      matches: 'pull_request(_target)?:'
      in: .github/workflows
    intent: >-
      Every pull request runs the repo's own build, lint, and test
      commands before a human reviews it, so mechanical failures are
      caught automatically instead of costing reviewer time or slipping
      into the default branch unnoticed.
    grants:
      - Read-only checkout access to build and run the repo's own
        commands — this workflow only reports pass/fail status, so it
        needs no write scope to the repository, its issues, or its pull
        requests.
---

# Automated PR checks: review and autofix

What happens between `dev-flow` opening a draft PR and a human merging
it: automated checks, automated review, and two flavours of autofix. This
process is repo-agnostic; every concrete value it needs comes from the
repo's `CLAUDE.md`, under "Dev flow bindings" (or a dedicated "PR checks
bindings" section if the repo keeps them separate).

If that section is absent, say so and suggest the `setup` skill
rather than guessing the values — a guessed default branch or
verification command is worse than a stopped flow.

## Automated checks

CI runs every affected command from the repository's verification binding. A
command whose inputs cannot have changed may report skipped, never passed.

## Automated review

One provider-selected workflow reviews every pull request, drafts
included, and posts at most one review per head SHA through a trusted
publisher. What the monitor needs to know about it:

- The cap is 3 completed `github-actions[bot]` reviews per PR unless
  the operator raised it via the `AUTOMATED_REVIEW_ROUNDS` repository
  variable. A capped-out PR gets no further automated rounds; do not
  wait for one.
- A review's outcome is `reviewed`, `skipped`, or `failed`. `skipped`
  and `failed` explain themselves in the review body; `failed` is a
  problem with the review run, not with the PR.
- Later rounds read earlier findings and their reply threads. Reasoned
  pushback on a finding's inline thread counts as addressed without a
  code change, so answering a review comment is a real action, not a
  formality. See the loop's review watch below.
- A later round resolves the threads it confirms addressed, through the
  same trusted publisher. So an open `github-actions[bot]` thread is
  live feedback and a resolved one is settled, which is what makes the
  unresolved count worth reading. A thread the round re-filed a finding
  on stays open, and the loop never resolves a thread itself — that
  verdict belongs to the reviewer or the human.
- A repeat review of an unchanged head is suppressed. After a push,
  expect a fresh round (cap permitting).
- Branch protection watches one stable aggregate check,
  `Automated Code Review`, whatever the provider.
- A PR that edits the review workflow itself only exercises the new
  wiring after merge; provider security guards prevent self-review of
  that workflow.

**The loop never branches on which provider is configured.** It reads the
reviews a trusted publisher posts as `github-actions[bot]` and the one
aggregate check named above, and both are the same under every provider.
So the binding below names where the repo records its reviewer rather
than which one it is: a loop that hard-coded a provider would be wrong in
every repo configured the other way, and would go stale the day a repo
switched.

Installing or changing this machinery is the `code-review-setup`
skill's job, including the provider selection, credentials, and the
security shape of the workflow. This skill only watches what it posts.

## Lightweight autofix (CI side)

Where the repo's configured reviewer provides them, review comments carry
"Fix this" links: under Claude that is `claude-code-action`'s
`include_fix_links` option, on by default, and clicking one opens a
session pre-loaded with the finding's context. Treat their absence as a
property of the configured reviewer rather than a fault. Either way this
is manual — a human has to click — not autonomous. The autonomous
mechanism is the monitor/fix loop below.

## Autonomous monitor/fix loop (session side)

**Trigger.** Immediately once `dev-flow`'s draft-PR step completes — in the
same session, right after it attempts the board-card or Jira-ticket move to
In review, whether or not that move actually happens. A missing board, an
`unknown` board row, and a Jira `Tracker statuses` row recording `In review`
as `none` are all no-op outcomes of that attempt, not reasons to wait for
one — the loop starts regardless. Not a separately-requested action.

**Prerequisites.** The repository bindings above are the precondition, and
their absence stops the loop. `superpowers` is a mode, not a precondition.
Its CI-failure and
review-feedback branches call `superpowers` skills where they are
available, and state the same discipline inline where they are not. On the
normal path nothing extra runs here: the loop starts in the same session
that ran `dev-flow`, and step 2's pre-flight already recorded the mode.
Started on its own instead, pointed at an existing PR in a fresh session
where no pre-flight ran, the loop makes that same check before its first
poll and says once, before it starts polling, that `superpowers` is absent,
that the CI-failure and review-feedback branches will use their inline
discipline, and how to install the plugin for the full track on this
harness. Once, not per branch. A harness that cannot list its own skills at
all is the one stop here: absent and unreadable are not the same thing, and
guessing would downgrade a session that has the full track.

**State**, kept in-session only, never persisted to disk: last-seen
mergeability; last-seen CI conclusion per check name; the inline review
threads this session has already answered.

**Mechanism.** Whatever the agent's harness offers for "do something
periodically without blocking the human" — a background loop that waits
and re-checks, a dynamic wake-up scheduler, or equivalent. Not
prescribed, since it varies by harness; the requirement is periodic,
non-blocking, and bounded by the stop conditions below.

**Cadence.** Every 2–5 minutes, not tighter — CI runs take longer than
that, and polling faster only burns API calls without new information.

**Mergeability watch.** Read it first on every poll, before the checks.
A conflicted pull request gets no CI at all, so a loop that reads only
check status sees nothing running and waits for a run that will never
start.

```bash
gh pr view <N> --json mergeable,mergeStateStatus
```

- `MERGEABLE` → go on to the CI watch.
- `UNKNOWN` → GitHub is still computing. Read it again next poll; it is
  not a conflict.
- `CONFLICTING`, which `mergeStateStatus` reports as `DIRTY` → a failure
  to fix now, on the same footing as a red check. Merge the integration branch
  in with a plain merge commit:

  ```bash
  git fetch origin
  git merge origin/<integration-branch>
  # resolve every conflict, run the verification binding, commit the merge, push
  ```

  `<integration-branch>` is the branch the repo's bindings record, the
  one `dev-flow` step 3 branched from and `--base` named. Merge, never
  rebase, so the push stays a fast-forward and history stays intact. The
  push restarts CI and, cap permitting, a fresh review round; resume
  watching. This merge is an autofix, so the
  [safety rules](#safety-rules-the-loop-never-breaks) gate it like any
  other push: on a pull request this session did not open, or one
  another writer is working, report the conflict instead of merging.
- A conflict the loop cannot resolve, or a resolution that leaves
  verification red → `git merge --abort`, report the conflicting paths,
  stop and ask. A half-merged tree left behind is the one state a resumed
  loop cannot re-derive from the pull request.

**CI watch.** Poll check status on this cadence.
- All green → stays quiet, keeps watching (a later push restarts CI).
  Once no further review round can arrive, green stops meaning "wait"
  and the loop hands off instead — see
  [Running out of work is a handoff](#running-out-of-work-is-a-handoff).
- Any failure → `superpowers:systematic-debugging`, or under reduced mode
  the discipline `dev-flow` step 7 states inline: find the cause before
  writing the fix. Then produce the fix, verify locally, commit
  (Conventional Commits), push, resume watching.

**Review watch.** Poll on the same cadence through the `Review-comment
query` binding. It returns the whole round: the review bodies, their
inline comments, and each thread's `isResolved`.
- **Only submitted reviews count.** Read each comment's own
  `pullRequestReview.state` and process it only when that state is a
  submitted one — `COMMENTED`, `APPROVED`, `CHANGES_REQUESTED`. Name the
  states that qualify rather than the ones that do not: `pullRequestReview`
  is nullable, so a deny-list on `PENDING` lets a null state through as
  live feedback, and a state GitHub adds later would arrive pre-approved.
  A comment whose state is `PENDING` belongs to a draft nobody has sent;
  one with no state at all is a case to surface rather than guess at.
  Read the state off the comment rather than looking its id up in the
  `reviews` list, which is a bounded window and will not hold every
  review on a long-lived PR. GitHub shows an
  unsubmitted draft to its author alone, so it stays invisible to the
  loop until the loop's own token is that author — then half-written
  findings read as live feedback, and the loop answers a comment its
  reviewer has not decided to send. That is the one reason the query
  selects `state`; a loop that reads the field for nothing may as well
  not request it.
- **The body is a summary; the inline comments are the findings.** A body
  that summarises CI, or that names no findings, proves nothing about the
  round. A review opening "CI completed successfully" can still carry an
  inline comment on a correctness bug in a file the body never names. A
  round is clean only when no inline thread is waiting on an answer.
  Not "no inline comments at all": a thread the loop has answered stays
  unresolved until a later round confirms it, so it comes back in every
  poll in between, and a loop testing the raw comment set would never
  see a clean round again after its first finding. The two filters cover
  different windows and both are needed — resolution retires a thread
  for good once the reviewer agrees, and the answered set carries it
  through the gap before that.
- **Every reviewer counts, not only the automated one.** A human's
  inline finding on this PR gets the same triage as the bot's; the
  trusted publisher's identity decides the round cap and the aggregate
  check, never whose feedback deserves an answer. Ignoring a person who
  took the trouble to review is the worse failure, and
  `receiving-code-review` already separates a partner's feedback from an
  external reviewer's.
- Every unresolved thread this session has not answered is the round's
  feedback → `superpowers:receiving-code-review` to triage. Its
  existing rigor applies unchanged, so it may push back rather than
  blindly implement a suggestion. Under reduced mode, keep that rigor by
  hand: judge each finding on its merits, answer a wrong one with the
  reasoned disagreement rather than a fix, and separate blocking findings
  from the rest before working any of them. Then handle the round as a
  unit: apply every agreed change via
  `superpowers:test-driven-development`, or test-first by hand under
  reduced mode, verify once, split the result
  into commits at the granularity below, push once, reply on every
  finding's inline thread, then advance the last-handled marker.
- **Reply on every finding's inline thread before the marker advances.**
  This is a step of addressing, not a courtesy after it. For each finding
  the round triaged, post a reply on that thread:
  - a fix names the addressing commit;
  - pushback is the reasoned disagreement;
  - a follow-up issue names the filed issue;
  - left undone names the `Left undone` line the finding was recorded as,
    for a non-blocking finding the human did not approve filing.
  The last-handled marker advances only when every finding has that
  reply. A commit without an inline reply does not count as addressed.
  A PR conversation comment is not a substitute.

  ```bash
  gh api --method POST \
    repos/<owner>/<repo>/pulls/<N>/comments/<comment_id>/replies \
    -f body='Fixed in <sha>.'
  ```

  `<comment_id>` is the inline comment's `id` from the Review-comment
  query (the thread root's `databaseId`), not the review id.

  A thread is answered once a reply from the pull request's own side sits
  after the reviewer's last comment in it, and that ordering is also how
  the loop tells its handled threads from its open ones. **Own side, not
  own session.** GitHub stores who wrote a comment, never which session
  did, so a resumed loop can separate the reviewer from the authoring
  account and nothing finer. Scoping the test any tighter would ask the
  pull request for a fact it does not hold. **A commit alone answers
  nothing**, because git carries no link from a commit to a thread: any
  push after the round sits after every reviewer comment, so a rule that
  accepted a commit would mark all open threads answered at once, even
  the ones the round never touched. That is the silent drop this section
  exists to prevent. Resolving a thread is never the loop's own move, so
  `isResolved` is still false the moment it answers; a later round
  resolves what it confirms addressed, which is the reviewer's verdict
  and not something to wait on before moving to the next round. A thread
  left silent is a finding the loop dropped, whatever the body said.
- **Verify once per round, not once per commit.** The round's changes
  are implemented together and verified together, against the tree all
  of them produce. Verification sits before the commit split, never
  inside it: a six-comment round runs the suite once, not six times,
  which is the difference between a loop that keeps pace with the
  reviewer and one that costs more than the fixes did. The trade-off is
  explicit rather than hidden: what the single run covers is the round's
  final tree, and the per-comment commits leading up to it are not
  verified individually.
- **One commit per review comment addressed.** This carries
  `dev-flow`'s "one logical change per commit" into the post-PR loop: a
  round of feedback never lands as a single squashed "address review
  comments" commit covering unrelated points. The reviewer has to be
  able to check comment-by-comment that their feedback was applied, and
  a fix that turns out wrong has to be revertable without unpicking the
  others.
- **Exception: one fix, one commit.** When a single change genuinely
  resolves several comments, or several comments share a concrete
  common denominator — three comments all about inline imports, say —
  they land as one commit whose message names the group it covers.
  Splitting one fix across commits to match the comment count is as
  wrong as squashing unrelated fixes together.
- **Split by selective staging.** One verified working tree becomes
  several commits by staging a subset at a time, then committing it:
  `git add <path>` when the comment groups touch disjoint files,
  `git add -p` (`--patch`) to pick individual hunks when two groups
  share one. Patch mode diffs the worktree against the index, so a file
  the round newly created offers no hunks at all: `git add -p` reports
  `No changes.` and stages nothing. Run `git add -N <path>` first to put
  an empty version in the index and give patch mode something to diff
  against. The unstaged remainder stays in the tree between commits,
  so the split needs no branch juggling and no stash. Read
  `git diff --cached` before each commit to confirm the group is what is
  staged, and `git status` after the last one to confirm nothing was
  left behind.

### The pull request is the state

The in-session state above is a cache, not the record. **Everything the loop
needs is derivable from the pull request itself**, and a loop that starts
without that cache re-derives rather than gives up:

| What the cache held | Where it is re-derived from |
|---|---|
| Last-seen conclusion per check | The current check-run conclusions on the head commit |
| Which threads are answered | The unresolved inline threads carrying a reply from the authoring side after the reviewer's last comment. Every other unresolved thread is still open, and a thread whose last comment is the reviewer's is the case to re-triage |
| What has already been fixed | The commits on the branch since the PR opened, and their messages |

So a loop **re-diagnoses before it acts**: read the PR's current state, decide
what it is, and only then choose a branch. Never assume the state that was true
when the loop last ran.

This matters in three situations that all reduce to the same one:

- the loop is pointed at an existing PR in a fresh session;
- the session that started it ended and a human resumed it later;
- a session was closed on idle while the loop was waiting on an answer nobody
  had given yet.

The third is the one that turns this from a nicety into a requirement. A session
closes after roughly fifteen minutes of inactivity, and an active poll is not
inactivity, so a loop that keeps polling reaches CI's verdict wherever it runs.
What ends a session early is silence while waiting on a person. That answer can
arrive after the session is gone, so re-derive state from the pull request rather
than depending on in-session memory.

**Where the PR does not answer the question, say so rather than guess.** A
resumed loop that cannot tell what a round of feedback was asking, or which of
several failures it was mid-fix on, states what it reconstructed and what it
could not, and asks. An inferred goal acted on silently is worse than a question.

**A human's reply answers a thread too**, and that follows from reading the
authoring side rather than a session. It is the right outcome, not a rounding
error: a thread a human has engaged is no longer the loop's to re-litigate, and
re-triaging it would argue with its own author. The one case that needs care is a
thread answered from that side where the finding plainly still wants code. That
is the paragraph above, not an exception to it — the loop says what it found and
asks, rather than silently re-opening the thread or silently skipping it.

### Safety rules the loop never breaks

These bind on every path, and none of them is a judgment call:

- **Never make CI green by weakening what it checks.** Deleting an assertion,
  loosening a threshold, skipping a test, or excluding a path turns a red signal
  into a green one without fixing anything, and it is the single most damaging
  thing an autofix loop can do. If the honest fix is not available, the failure
  is surfaced to the human. A test that is *itself* wrong may be changed, but
  that is a reasoned change stated as one, not a way to get to green.
- **Never autofix a pull request the session did not open.** Pointed at someone
  else's PR, the loop reviews and reports; it does not push to a branch whose
  author did not ask for it. Rewriting a colleague's branch under them is not a
  favour.
- **One writer per pull request.** Before acting on a PR the session did not
  just open, check whether something else is already working it — a recent
  agent-authored commit, an in-progress marker, an open loop elsewhere. Two
  loops fixing one PR produce conflicting pushes and duplicated commits. When in
  doubt, report instead of writing.
- **A stale branch is diagnosed, not debugged.** A failure caused by the base
  moving on rather than by the diff is not a bug in the change, and
  `systematic-debugging` will burn a cycle discovering that. Read
  `mergeStateStatus` first. `DIRTY` is the conflict the mergeability watch
  merges in. `BEHIND` on a branch that still reads `MERGEABLE` is the case
  to say so and let the human decide: nothing blocks CI there, and bringing
  the base in unasked is a change the human did not request.

### Not every finding is worth blocking on

A review round mixes findings that must be fixed with nits, low-severity
observations, and things that are genuinely out of scope for this PR. Treating
them alike makes the loop churn: it keeps working a PR that was ready, and the
reviewer waits on changes nobody needed.

So the loop **triages the round before working it**, which
`superpowers:receiving-code-review` already equips it to do. Under reduced
mode nothing equips it, so the triage is the loop's own job and the split
below is the whole of the instruction. Blocking findings are fixed in this
PR. A non-blocking one is never filed on its own: it goes to the human as
a drafted candidate — title, body, label under GitHub; summary and
description under Jira, which has no label — per `issue-authoring`'s
gate, and only an explicit yes runs `gh issue create` or `jira_create_issue`.
One the human doesn't approve is named in the PR body's `Left undone`
field instead: fetch the current body, add the finding's line under that
section, and push the result with `gh pr edit <N> --body-file <path>` —
the field already exists for precisely this, and the edit is a PR-body
API call, not a commit.

Every finding still gets an inline reply on its thread. What changes is
that some replies are "filed as #N" under GitHub or "filed as
<ticket URL>" under Jira, others "left undone", and neither happens
without that approval. Deferring is a decision the loop states on the
thread, never a silence and never a PR conversation comment.

**Stop conditions**, deliberately simple, no auto-idle heuristics: the
human explicitly says stop; the PR is closed or merged; the loop runs out of
work, below; the session ends — with
the caveat above that a session ending is not the work ending, and a resumed loop
re-derives its state rather than starting over.

When the stop is merge, move to the main checkout, then prune worktrees
whose pull requests have merged. Run the command in
[Prune merged worktrees](../../references/prune-worktrees.md). The
command has exited 0 before the loop ends. A PR closed without merging
does not run this.

### Running out of work is a handoff

The loop has nothing left to do when three things hold on the current head:
CI is green, every inline thread is answered, and the automated round cap is
exhausted so no further round can arrive. The cap is what makes this terminal
rather than merely quiet. While another round can still fire, green means keep
watching and saying nothing is right.

**An exhausted cap looks exactly like a healthy green.** The per-round job
reports skipped and the aggregate check passes, so a PR nobody will review
again is indistinguishable on its checks from one waiting on its next round.
Nothing turns red, and nothing announces that the automated pass is over.

So the loop says it, once, and stops: the pull request is ready for human
review, this is what was verified, this is what was deferred and where it is
tracked. Compare the round count against `AUTOMATED_REVIEW_ROUNDS` rather than
against the documented default, which a repo may have raised. Undrafting and
merging stay human actions under the non-goals below — the handoff is a
message, not a state change. A loop that instead kept polling would spend API
calls watching a finished pull request while the one person who could move it
has no idea it is their turn.

The worktree survives this stop. Pruning is keyed to the merge above, and a
pull request handed to a human has not merged — the branch still needs its
checkout.

**Non-goals**, mirroring `dev-flow`'s existing ones: never merges the
pull request; never takes the PR out of draft; no force-push or history rewrite — plain
commit and push only; never applies feedback blindly. A merge commit
that brings the integration branch in is a plain commit and push, so
the mergeability watch stays inside these.

**Error handling.** The repo's CLI being unauthenticated or rate-limited
→ surface to the human, pause rather than crash. A CI failure the agent
cannot fix (flaky infra, external outage) → bounded retries, then
surface to the human instead of looping forever. A push rejected as
non-fast-forward → the remote branch holds commits this checkout lacks.
`git fetch origin`, read who wrote them: another loop working the PR is
the one-writer rule's case, so report it. Only on a pull request this
session opened, with no other writer on it, merge `origin/<branch>` in
with a plain merge commit, resolve, re-verify, push.
Force-push is never the way through; a conflict the loop cannot resolve
→ `git merge --abort`, stop and ask.

## Bindings this process needs per repo

| Binding | This repo's value |
|---|---|
| Mergeability query | `gh pr view <N> --json mergeable,mergeStateStatus` |
| CI-status query | `gh pr checks <N>` |
| Review-comment query | The `gh api graphql` call below this table: review bodies, their inline threads, `isResolved`, and each comment's review id |
| Automated reviewer | Whatever the repo's `Automated reviewer` binding records, which `setup` writes and `code-review-setup` configures. The loop reads it to report what reviewed a round, never to choose a code path |
| Interactive review skill | `apptension-review:code-review` |

### The `Review-comment query` call

One GraphQL call for a round, so the loop copies this instead of
pairing two REST endpoints that carry no resolution flag between them:

```bash
gh api graphql -F owner=<owner> -F repo=<repo> -F number=<N> -f query='
query($owner:String!,$repo:String!,$number:Int!){
  repository(owner:$owner,name:$repo){ pullRequest(number:$number){
    reviews(last:10){ nodes{ databaseId state body } }
    reviewThreads(first:100){ pageInfo{ hasNextPage endCursor }
      nodes{ isResolved isOutdated path line
        comments(first:20){ pageInfo{ hasNextPage endCursor }
          nodes{ databaseId author{login} body
            pullRequestReview{ databaseId state } } } } } } } }'
```

**Read `pageInfo` before calling a round clean.** Those page sizes are
caps, not guarantees, so a truncated response looks exactly like a short
one: an empty inline-comment set means a clean round only when nothing
was cut off. Where `hasNextPage` is true, request the next page with
`after: "<endCursor>"` on that connection and judge the round on the
union. A loop that skips this reads 100 threads on a 120-thread PR and
declares the 20 it never fetched clean, which is the body-only bug
wearing a different hat.

`reviews(last:10)` is a window on the most recent bodies and nothing
else, so **never look a comment's review up in it.** It truncates sooner
than the round count suggests: `AUTOMATED_REVIEW_ROUNDS` raises the
automated cap past its default of 3, human reviews land in the same
connection, and every reply the loop posts is itself recorded as a
review — so the loop inflates this count by working. The PR that
introduced this section had 13 reviews and 7 of them were its own
replies, which is why the state the filter needs travels on each comment
instead.

The reviews and the threads join on the review id. A comment's
`pullRequestReview.databaseId` is REST's `pull_request_review_id`, and a
thread's first comment `databaseId` is REST's comment id, so a finding
read here is the same object either API returns. Read `isResolved`, not
`isOutdated`. Outdated only means the diff moved under the thread, not
that anyone handled the finding.

Reply on a thread with the command in Review watch, using the thread
root's `databaseId` as `<comment_id>`.
