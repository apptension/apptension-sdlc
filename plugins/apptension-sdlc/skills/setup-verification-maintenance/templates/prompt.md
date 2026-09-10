Maintain the project-owned verification skill at `%%TARGET%%`.

Read and follow the complete maintenance contract at
`.verification-output/trusted/.github/verification-maintenance/instructions/maintain-verification-skill/SKILL.md`.
The trusted preflight has already selected the target, checked for an existing
maintenance pull request, and recorded the base revision. Work only in the
repository at the workspace root. Do not change its current revision, commit, push, or use
GitHub write operations.

Write the required report to repository-root `.verification-report.json` and
save every cited proof under repository-root `.verification-evidence/`. Use new,
untracked files from this run; files committed in the base revision are rejected.
The separate trusted publisher will validate the report and any correction after
this run. The app credentials named in the trusted config are available by
their environment variable names. Use them only while driving the application.
Keep credential values out of files, evidence, reports, commands, and logs.
