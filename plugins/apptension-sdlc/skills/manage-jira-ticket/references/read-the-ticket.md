# Read the ticket

Read when `run-preflight` reads a ticket at its step 3.

`run-preflight` already checked the argument's site and key prefix against
the bindings. One call returns the body and every comment:

    jira_get_issue(
      issueKey: "GA-240",
      detail: "full",
      comments: "all"
    )

- The server reads and writes markdown.
- Pass `comments: "all"` explicitly. `detail: "full"` alone previews only
  three comments. A response that says it returned less than the whole
  thread: read the rest with
  `jira_get_comments(issueKey: "<key>", cursor: "<the nextCursor it returned>")`,
  passing the cursor back untouched.
- Read the title, body, labels, SDLC area, any linked spec or plan, and
  every comment.
- Keep the `status` field and the issue type in the session. Moving the
  ticket uses both.

This read proves the credential. A rejected token stops
the run here, with `401` in the message and no error code: see
[proving it works](server.md#proving-it-works). Any other
failure: [what each failure means](server.md#what-each-failure-means).
The read does not prove the site; see
[the site is trusted, not verified](site-and-transitions.md#the-site-is-trusted-not-verified).

### Attachments

The response lists attachments as
`{id, filename, mimeType, size, created, author}`. Read every one whose
`mimeType` starts with `image/`, one call each, with no count limit:

    jira_read_attachment(attachmentId: "<id>")

- The server downscales images and refuses anything over 25 MB.
- Work from that list, not the prose. It covers images pasted into comments
  (rendered as `[image: name.png]`) and images nobody mentioned.
- Name a non-image attachment and do not read it.
- A response that carries a URL: compare its host with the recorded site at
  once, per
  [the site is trusted, not verified](site-and-transitions.md#the-site-is-trusted-not-verified).
  A mismatch is a hard stop before pre-flight and before any write.

### Agent context comments

A comment whose first line contains a bolded **Agent context** carries
execution detail the body leaves out: file paths, commands, IDs,
constraints. Match the bold label anywhere on the first line, since the
server prefixes a marker of any value (`:claude: **Agent context** ...`).
Read every such comment. The `issue-authoring` skill describes how they are
written.

**Done when** every comment is read, every image attachment is read, every
other attachment is named, and every attachment URL matched the recorded
site. Hand the content back to the caller, which runs pre-flight next.
