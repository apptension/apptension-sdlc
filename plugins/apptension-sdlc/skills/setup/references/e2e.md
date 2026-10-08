# Set up E2E

Read at step 6 when the gate named and released the E2E effect.

Run `e2e-setup`. Once a scaffold exists, written now or already there,
offer `discover` to propose whole-path smoke tests. Both are skills of
`apptension-e2e-testing`, which holds their procedures.

## The discover offer

```
Scaffold is in place at `<spec dir>`. Run `discover` to propose smoke
tests for this app's user paths? It reads the app's code and boots the
app, roughly ten minutes. (yes / no, enter accepts no)
```

Enter accepts `no`. The gate releases writes the human has just read in
full; this releases a ten-minute run whose output nobody can see yet, so
not deciding spends nothing. A decline keeps the scaffold, and `discover`
reads the app fresh whenever it is next asked.

## Declining e2e-setup

`e2e-setup` shows its proposed location and layout before it installs
anything. Backing out there is a repo saying it does not do E2E: record
`not adopted` in the `E2E` row. Without it the probe keeps returning
`missing` and every later run offers setup again. `unknown` means nobody
was asked.

## Rewriting the rows

Step 4 wrote the rows before the scaffold existed, so rewrite them here.

1. **`E2E`**: the spec dir, only on a usable result: status `ok`, or
   `conform` with an empty `missing` list. A `conform` with anything in
   `missing`, or a failure, leaves both rows as step 4 wrote them and
   reports the gap. A row naming a scaffold that does not run is worse
   than `unknown`.
2. **`Verification`**: last, once `discover` was offered and run or
   declined. Apply the E2E command rule in
   [detect.md](detect.md#verification-and-e2e) in full: the smoke-spec
   guard, the `cd`, and the `test:e2e` fallback only a status-`ok`
   scaffold earns. `discover`'s specs can be the repo's first
   `*.smoke.spec.*` files, so the check runs after it.

Report in the summary's `Written` group the spec dir `e2e-setup` wrote and
how many smoke specs `discover` added if it ran. Add the paths both report
to the run's file list.

The scaffold is a repo artifact, wherever `e2e-setup` put it (`e2e/web/`,
or another location for a monorepo), so a re-run finds it the same way
any clone does.
