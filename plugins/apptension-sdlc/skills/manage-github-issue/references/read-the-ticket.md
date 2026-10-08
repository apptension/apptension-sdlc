# Read the ticket

Read when `run-preflight` reads a ticket at its step 3.

```bash
gh issue view <N> --json number,title,body,state,labels,comments
```

Read the title, body, labels, SDLC area, any linked spec or plan, and every
comment.

### Screenshots

Screenshots arrive as bare URLs in three shapes:

- `https://github.com/user-attachments/assets/<uuid>`
- `https://user-images.githubusercontent.com/...`
- `https://private-user-images.githubusercontent.com/...`

Find all three in the body and every comment, and download each into
`<scratchpad>`:

```bash
printf 'header = "Authorization: Bearer %s"\n' "$(gh auth token)" |
  curl -K - -sSL -o <scratchpad>/<name> -w '%{http_code} %{content_type}\n' <url>
```

| Printed status | Do |
|---|---|
| `200`, `image/*` content type | Give the file the extension matching the content type, since `Read` renders only an image file that has one. Read it |
| `200`, any other content type | Name the file by filename and content type. Do not read it |
| Anything else | Name the file and its status, and move on |

Judge by the printed status, never curl's exit code, which is 0 for a 403 or
404.

`private-user-images` ignores the bearer token and needs a short-lived `jwt`
query parameter the raw markdown lacks. Take its URL from the rendered HTML,
and download it in the same pass, because the token lasts minutes:

```bash
gh api repos/<owner>/<repo>/issues/<N> \
  -H 'Accept: application/vnd.github.full+json' --jq '.body_html'
gh api --paginate repos/<owner>/<repo>/issues/<N>/comments \
  -H 'Accept: application/vnd.github.full+json' --jq '.[].body_html'
```

### Agent context comments

A comment whose first line contains a bolded **Agent context** carries
execution detail the body leaves out: file paths, commands, IDs,
constraints. Match the bold label anywhere on the first line, since a marker
of any value may prefix it. Read every such comment. The `issue-authoring`
skill describes how they are written.

**Done when** every comment is read, every screenshot is downloaded, every
`image/*` file is read, and every other file is named. Hand the content back
to the caller, which runs pre-flight next.
