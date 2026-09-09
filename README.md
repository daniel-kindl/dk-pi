# dk-pi

Pi extensions for Daniel Kindl projects. The first extension is `dk-flow`.

## dk-flow V0

`dk-flow` keeps one explicit work session around Pi. It detects the Git repository, loads a GitHub issue with `gh`, creates a feature branch when the current branch is `main` or `dev`, and injects short session context before Pi turns.

Install or use this repository as a trusted Pi project. The project-local extension is at `.pi/extensions/dk-flow/index.ts`. Start Pi in the repository, then run:

```text
/work 47
/work status
/work check
/work abort
```

`/work check` runs `lint`, `test`, and `build` scripts found in `package.json`, in that order. It records pass or failure. GitHub access requires an authenticated `gh` CLI.

State is stored as Pi session entries. On restore, dk-flow re-reads the current Git repository. Git and GitHub remain authoritative for external state.

V0 blocks file and Git commit/push/merge tool calls when the active work branch is protected. A dirty protected branch is not changed. Merge permission is always separate from validation: passing checks never grants permission to merge. `/work abort` clears only logical session state and does not delete branches or files.

V0 does not yet create PRs, merge, or perform post-merge cleanup. The state model reserves these lifecycle fields for safe future implementation. Validation detection is currently limited to `package.json` scripts.
