# The design track in reduced mode

Read when the design gate at step 5 picks the design track and
`run-preflight` decided reduced mode.

The vehicle is the harness's plan mode. The four-point contract in
[design-track.md](design-track.md) still binds. Prefer plan mode, which
enforces point 4. Where a harness cannot enforce it, honour it anyway.

| Harness | How to enter plan mode |
|---|---|
| Claude Code | Call `EnterPlanMode`, then `ExitPlanMode` to request approval |
| Cursor | Ask the human to switch the session to Plan mode |
| Codex | Ask the human to switch the session to its plan mode |
| OpenCode | Ask the human to switch the session to plan mode |
| Pi | Ask the human whether this session has a plan mode |
| A harness with no plan mode | Follow the four-point contract by discipline |

A plan or to-do tool that does not gate approval leaves point 3 open. Use
it to show progress, and still get the approval.

- Ask clarifying questions in one round.
- The plan lives wherever the harness keeps it. Never write it into the
  repo or name a path for it.
- An interrupted session restarts the design gate.
