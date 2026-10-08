# Assign to me

Read when a caller starts work on the ticket (step 4).

    jira_update_issue(issueKey: "<key>", assignee: "me")

The server resolves `me` to the token's own account. When the ticket also
moves to `In progress`, assign first; the transition waits on this check.

Compare the host of the issue URL in the response with the recorded site.
Match: continue to the transition. Mismatch, no URL, or a failed call: per
[checking the site before the transition](site-and-transitions.md#checking-the-site-before-the-transition).
Done when the assignment passed that check.
