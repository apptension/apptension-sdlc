# Configure the orchestrator

Read at step 6 when the `Task orchestrator` row names an orchestrator.

The gate named this effect, so it is approved: setup configures the
orchestrator without offering. Run the `cezar-setup` skill, which holds
the procedure.

| Row | Do |
|---|---|
| A supported orchestrator (`cezar`) | Configure it, by the machine-state table below |
| An unsupported name | Write nothing. Report it in the summary. The row stands as the repo's record, and `cezar-setup` says the same when asked |
| `none` | Nothing is configured or offered |

Configuring Cezar for a row naming something else would write `.ai/cezar/`
files that look like a decision the team made.

## Machine state

The row is the repo's decision. Whether this machine can act on it is a
separate fact, because the configuration is git-ignored and never arrives
with a clone. The developer who cloned a repo where someone else named the
orchestrator ends the run configured too.

| This machine | Do |
|---|---|
| No orchestrator configuration | Configure it |
| Configured, and equal to what the bindings derive | Nothing. Report it as already configured |
| Configured, and different | Reconfigure, and report which values moved |

Compare against the derived target: what `cezar-setup`'s procedure would
write now, never a list of fields. A field the procedure starts deriving is
then covered the day it is added. A stale copy of a binding, such as an old
base branch, opens pull requests against the wrong branch without failing.

Report the outcome in the summary's `Written` group, naming each file, and
add each file `cezar-setup` reports to the run's file list.

## When it cannot run

None of these fails setup. The bindings are written and the issues filed
regardless.

| Situation | Do |
|---|---|
| The orchestrator or an agent CLI is not installed or not logged in | Write nothing. Report what is missing, and that `cezar-setup` finishes the job once it is available |
| `Branching model` is `unknown`, so no base branch derives | Write nothing. Report that the row needs an answer first: a guessed base branch fails silently |

Setup runs no verification suite here. One config file does not justify a
full lint-and-test run, and it would measure the working tree instead of
the branch a run forks from. `implement-issue` step 7 and CI run the
suite.

`cezar-setup` stays a skill of its own, for re-running when `Branching
model` changes.
