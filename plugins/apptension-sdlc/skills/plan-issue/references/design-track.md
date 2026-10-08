# The design track

Read when the design gate at step 5 picks the design track.

## The vehicle per mode

Run the vehicle for the mode `run-preflight` decided.

| Mode | Vehicle | Produces |
|---|---|---|
| Full | `superpowers:brainstorming`, then `superpowers:writing-plans` | On the architectural path, a spec in `docs/superpowers/specs/` and a plan in `docs/superpowers/plans/`, where those skills write them. A bounded task is approved in chat and writes neither |
| Reduced | The harness's own plan mode, per [reduced-mode.md](reduced-mode.md) | Whatever that harness does with a plan |

In full mode, `brainstorming`'s own questioning contract applies unchanged.

## The contract

Under either vehicle, before the first edit:

1. Read the code the change touches before choosing an approach.
2. Produce a plan naming what changes, which files it touches, and how it
   gets verified.
3. Get the human's explicit approval of that plan.
4. Write nothing before 3.

Done when the human has explicitly approved the plan.

## The design's working files

- Leave the spec and plan untracked, and skip brainstorming's and
  writing-plans' commit step. `implement-issue` checks the design working
  paths against `.gitignore` after it cuts the branch.
- End on the approved plan. When writing-plans offers its execution
  choice, leave it unasked: `implement-issue` asks it before its step 3.
