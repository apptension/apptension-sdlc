---
name: create-verification-skill
description: Use when creating a project-owned skill to launch and drive the real application, or when setup identifies a missing project verification skill.
requires:
  - id: project-verification-skill
    label: Project verification skill and feature map
    area: dev-flow
    detect:
      path: '{.agents,.claude,.cursor,.codex,.opencode}/skills/*/SKILL.md'
    intent: >-
      Agents can start this project's application, exercise its user-facing
      behavior, and preserve evidence using project-owned instructions and
      a feature map grounded in source. The instructions prove at least one
      mapped feature through launch, driving, and cleanup before completion.
---

# Create a verification skill

Create instructions another agent can execute without prior knowledge of
the project. Keep project commands and helpers in the consuming repository.
This skill supplies the method; the project supplies the application.

## 1. Find the target and learn the application

Read the explicit target path, or the optional `Verification skill` row
in the project's Dev flow bindings. Otherwise inspect `.agents/skills/`,
`.claude/skills/`, `.cursor/skills/`, `.codex/skills/`, and `.opencode/skills/`
for skills with Launch and Drive
sections and a `features/README.md` index. Resolve symlinks and count each
canonical directory once. All selected files must stay inside the repository.
An invalid explicit path is a problem to report, not permission to select
another skill. If several candidates remain, ask which one to use.
Report an unreadable discovered candidate as a problem and resolve it
before selecting a target; an unreadable file is not an absent skill.

An existing usable skill needs no replacement. Report its path and invoke
`maintain-verification-skill` when an audit was requested. For a new skill,
use the project's established local skill directory; when none exists, use
`.agents/skills/verify-<app>/`. Record that choice before writing.

Find each of these in source, manifests, or the project's own documentation:

- User entry points, such as routes, commands, menus, and public APIs.
- Startup commands, readiness signals, runtime versions, ports, data, and auth.
- Existing driving tools, including browser tests, PTY scripts, HTTP clients,
  and debugging interfaces. Reuse them where they fit the user path.
- Observable results, including terminal output, screenshots, files, response
  bodies, and stored state.
- Isolation controls for ports, data directories, profiles, and test accounts.

For a library, execute its public API through consumer examples or existing
test tools and capture returned values and side effects. Startup may mean
building or loading the package. Mark ports, authentication, and persistent
processes inapplicable where the project needs none; invent no prerequisites
to fill the sections.

Ask only for facts the repository cannot supply. Complete this step when
each item has a source citation or an explicit unresolved prerequisite.
Unavailable credentials or broken product startup leave the generated
artifact a draft. Product fixes, new product CLIs, and new E2E suites are
separate work; this task writes instructions and their small owned helpers.

## 2. Write the project skill

Write `SKILL.md` with `name: verify-<app>` and a model-facing description
naming the application, its user entry points, and when to invoke it.
Use concrete commands and paths from step 1 in these sections:

| Section | Required content |
|---|---|
| Launch | Dependencies, startup command, isolated state, readiness signal, and ownership of the process. For short-lived CLIs, prepare once and start a fresh isolated session per drive. |
| Doctor | A read-only command that checks the intended instance, build, readiness, and authentication. Run before driving and after surprising behavior. |
| Drive | Existing tool invocations with real selectors, commands, or routes. Use stable handles and exercise the path a user takes. |
| Evidence | Capture the action and resulting state, plus side effects. Save proof under repository-root `.verification-evidence/`, outside scratch directories removed by cleanup. |
| Cleanup | Stop only processes this run started and remove its temporary state. Preserve evidence, then check that every recorded artifact still exists. |
| Helpers | Show how to invoke each owned helper and make executable scripts executable. Keep helpers inside this skill directory. |

Specify how to reset a wedged application when doctor reports a healthy
process but the user path still fails. A shared instance requires explicit
ownership rules; a run cleans its residue without stopping another user's
instance. Record limitations when independent instances are impossible.

Proof uses the real user path and verifies visible results and side effects.
Use mocks only at an existing production boundary. For a dry-run or test
mode, observe what it actually skips, including network and file effects.
Complete this step when every command is grounded in this project and every
unresolved prerequisite is named, with no invented working examples.

## 3. Seed the feature map

Write `features/README.md` as an index linking individual feature files.
Start with three to five user-facing features where the application has
that many; list remaining known areas as coverage still to add. Each feature
file names concrete source paths and contains:

- The user outcome and its sub-features.
- How a user reaches it, including authentication and other prerequisites.
- The exact driving recipe using the skill's tools.
- Observable success criteria and side effects to check.
- Gotchas and the evidence to save.

Check every link and compare the index with the directory's feature files.
This step ends when every indexed feature has source support and a usable
recipe. Creation seeds coverage; maintenance later checks every feature.

## 4. Prove one feature

Execute the generated instructions: launch, doctor, drive one mapped
feature, capture evidence, and clean up. Check the saved evidence after
cleanup. Clean failed attempts too, preserving their proof before removing
temporary state. Correct instruction or helper drift within the skill's
directory, then repeat the affected instructions against the live app.

A successful source check alone does not complete creation. Report the
artifact as a draft if launch, live proof, or evidence survival fails, with
the exact command, observed failure, and prerequisite needed to continue.
Only a completed end-to-end run makes the skill ready for use. State which
feature passed, where its evidence remains, and which features are untested.

## 5. Connect usage and maintenance

Record the repository-relative `SKILL.md` path in the optional `Verification
skill` binding. Preserve the existing `Verification` command binding;
application driving supplements those checks. Offer
`setup-verification-maintenance` to install the maintenance schedule and
invoke it when installation is authorized. The installer owns scheduling,
provider configuration, and its approval gate.

Adapted from [pstack create-verification-skill](https://github.com/cursor/plugins/blob/main/pstack/skills/create-verification-skill/SKILL.md).
Copyright 2026 Lauren Tan. See [LICENSE](LICENSE) for the MIT license.
