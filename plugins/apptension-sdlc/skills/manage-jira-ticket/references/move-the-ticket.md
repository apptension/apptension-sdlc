# Move the ticket

Read when a caller moves the ticket to `In progress`, `Ready` or `In review`.

The stage is `In progress`, `In review` or `Ready`. `Tracker statuses` decides
the move.

1. Read the stage's status from `Tracker statuses`. `none`: skip the move
   with no comment. Absent or `unknown`: stop for `In progress` and
   `In review`; for `Ready`, see
   [moving to Ready](site-and-transitions.md#moving-to-ready).
2. `In progress` only: [Assign to me](assign-to-me.md) runs first, and its
   site check has passed, before this transition.
3. Run the
   [collision check](site-and-transitions.md#checking-for-a-transition-name-collision)
   against this stage. Its `jira_describe_project` call runs once per
   session, before the first transition. Transition-name collision: stop
   before transitioning.
4. Transition, passing the recorded status verbatim:

       jira_transition(issueKey: "<key>", transition: "<the recorded status>")

5. Before the first transition in this session, echo what was passed:

   > `In progress` → status `In Progress`.

6. Check the returned `status` against the recorded one, per
   [resolving a Jira transition](site-and-transitions.md#resolving-a-jira-transition).
   Matching, a no-op included: continue. Anything else stops.
7. `In progress` only: resolve the recorded `In review` against the
   transitions the response lists, per
   [validating In review early](site-and-transitions.md#validating-in-review-early).
   Clean: say nothing.

Done when the returned status matched, or the move was skipped as step 1 gives.
