Execution environment: this is a read-only sandbox. `/tmp`, `/var/tmp`, and
`/usr/tmp` are unwritable. `pytest` and `uv` are absent and exit 127;
`npm run <script>` finds npm but fails when `node_modules` is absent
(`tsx: not found`); and `python -m unittest` starts but its setup fails with
`No usable temporary directory`. Do not repeatedly probe the Python suite or
guess alternate module paths. The available tools include Python 3.12.3, Node
v24.19.0, npm 11.17.0, git, rg, sed, nl, jq, find, `node --test`, yamllint,
and `python -c` with `compile(...)` for non-writing syntax checks.

Read `.review-context/%%CI_RESULTS_FILE%%` for the `%%CI_WORKFLOW_FILE%%`
workflow's conclusion, including failing job names and output. If that file
says the run has not finished, treat the tests as pending and do not run
the suite.

Review this pull request for actionable bugs.

Inspect the merge-base diff between the pull request head and its base, then
report only defects introduced or exposed by changed lines. Do not report style,
formatting, speculative concerns, or issues whose fix is not clear and useful to
the author. Each finding must point to a changed new-side line.

Treat documentation changes as correctness claims. Verify named paths and
commands against the pull request tree, and read the implementation or
configuration that supports each claimed mechanism. Flag changed lines that
present a missing path, command, or mechanism as existing behavior. Explain
what you checked and what evidence contradicts the claim. Do not assume new
docs are true or ask the author to elaborate an unverified claim. Leave claims
explicitly marked as not built yet unflagged for the missing implementation.

On later rounds, read earlier automated review bodies from
`.review-context/prior-review-bodies.jsonl` and inline review comments from
`.review-context/prior-inline-comments.jsonl`. Group those inline comments
by thread using `id` and `in_reply_to_id`. For each earlier actionable
finding, read the whole thread, not only the original body, and report in
`summary` whether it was addressed or remains unresolved, including its
location and reason. Treat implementer replies as evidence: valid pushback
(a sound disagreement, or a won't-fix whose reason holds) counts as
addressed even with no code change, and do not re-file the same inline
finding. Invalid pushback stays unresolved and names why the reply fails,
not only that the code did not change; re-file the finding when the defect
is still real. List in `addressed_comment_ids` the `id` of the comment
rooting each thread whose finding this round confirms addressed; the trusted
publisher resolves exactly those threads. Re-filing a finding is the opposite
verdict: report it in `findings` and leave its thread open for the author.

Read `$GITHUB_EVENT_PATH` and set `head_sha` to the exact
`pull_request.head.sha` value from that event, quoted as a JSON string. Do not
use the checked-out merge commit SHA for `head_sha`.

Emit only one JSON object that conforms to the supplied output schema. Set
`outcome` to `reviewed` only after you inspected the complete merge-base diff.
Set `outcome` to `skipped` only when the pull request intentionally does not
need review, and explain why in `summary`. Set `outcome` to `failed` if required
data or tools are unavailable or the review cannot otherwise be completed, and
explain the failure in `summary`; use `null` for `head_sha` only when its exact
value is unavailable. A skipped or failed outcome carries no findings and no
addressed comment ids.

For a reviewed outcome, set `findings` to an empty array when there are no
actionable bugs, and `addressed_comment_ids` to an empty array when this round
confirms no earlier thread addressed. Every finding must include `severity`;
set it to `null` when no severity is useful. Always include `summary`; set it
to `null` unless it adds useful overall context, and never repeat a finding in
it.
