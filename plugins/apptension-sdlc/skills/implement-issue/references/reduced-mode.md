# Reduced mode

Read at step 6 when `run-preflight` chose reduced mode (`superpowers` is
absent). Where a step names a `superpowers` skill, do its inline
equivalent below. `run-preflight` has already announced the mode; say
nothing more about it.

| Where | Inline equivalent |
|---|---|
| The plan, at step 6 | Run the plan inline, task by task: failing test, the task's verification, commit |
| `superpowers:test-driven-development`, step 6 | Write the failing test, run it and watch it fail, then write the smallest code that passes |
| `superpowers:systematic-debugging`, steps 7 and 8 | Find the cause before the fix: read the failure, form one hypothesis, test it, and change code only once the cause is known |
