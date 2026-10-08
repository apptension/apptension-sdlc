# Micro track

Read at step 6 when the plan's track is micro.

The **named surface** is the file or component the plan recorded, at
that granularity. Every step runs as on any track, except promotion and
step 7 below.

## Promotion

Touching anything outside the named surface is a promotion (`plan-issue`,
step 5). One line in one other file is outside. Keep the branch and the
diff; revert nothing.

| Run | Do |
|---|---|
| Under `dev-flow` | Return to `plan-issue`'s gate with the change as it stands. Once the gate approves it, resume here at step 6 on the same branch without repeating step 3 |
| Standalone | Stop, per [the promotion stop](standalone.md#the-promotion-stop) |

After promotion, every later step runs as for the track the gate chose.

## Step 7 on the micro track

Run only the commands the touched paths bind. Read that off the bindings'
`Verification` row only: skip a command only when the row makes it
conditional on paths the change does not touch. A row with no conditions
runs whole. Never infer the paths a command covers from its name.
