# Ticket reference for a pull request

Read when `implement-issue` writes the PR body at step 10.

| Reference | Content |
|---|---|
| Ticket link | The first line of the body: the full URL from the recorded site and the ticket's key, `https://<site>/browse/<key>`, for example `https://your-company.atlassian.net/browse/GA-240`. Never copy the site from this example |
| Title | Pure Conventional Commits, with no Jira key |
| Closing keyword | None. Nothing moves a Jira ticket to Done, and this flow invents no closing keyword for it. After merge, the client's integration or a human moves the ticket |
| A ticket filed during the run | `Filed: <the full ticket URL>` |

A GitHub issue under a Jira tracker is a GitHub ticket: invoke
`manage-github-issue` for its reference.
