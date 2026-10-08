# Post a comment

Read when a standalone `plan-issue` posts its Plan handoff.

    jira_comment(issueKey: "<key>", body: "<markdown>")

A body over about 32,000 characters, when the caller says it is a design
handoff: post numbered parts in order, each headed
`**Plan handoff** · part <i>/<n>`.

Check each comment's site before anything else runs, a next part included.
Compare the host of the response's `url` with the recorded site:

| Response | Do |
|---|---|
| Host matches | Continue, and hand the URL back |
| Host differs | **Hard stop.** The comment landed on another company's ticket. The human points the entry at the recorded site, then deletes the comment by hand |
| No URL | **Stop** |

Done when every part is posted and each passed the site check.
