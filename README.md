# dk-pi

Pi extensions for Daniel Kindl projects. The first extension is `dk-flow`.

## dk-flow

`dk-flow` keeps one explicit issue work session around Pi. It detects the Git repository, loads a GitHub issue with `gh`, creates a work branch, and injects issue context before Pi turns.

Use the project-local extension from a trusted Pi session:

```text
/work 1
/work status
/work check
/work finish
```

`/work check` runs `lint`, `test`, and `build` scripts found in `package.json`, in that order. GitHub access requires an authenticated `gh` CLI.

## PR lifecycle

`/work finish` requires a clean session on its work branch and successful local checks. It creates a Conventional Commit when changes exist, pushes the branch, and creates or reuses a PR against the session base branch. It does not merge. Repeating the command reuses a matching PR.

The session records PR, head SHA, and CI state. `/work status` refreshes mutable PR data from GitHub. CI success and merge permission are separate. CI success never grants merge permission.

A clear maintainer instruction such as `green-go` or `merge it` grants approval only for the current PR head SHA. A new PR head clears approval. Use `/work merge` after approval. dk-flow then rechecks the open PR, base and head branches, issue link, head SHA, CI, mergeability, and blocking review state before it sends the merge request. GitHub must confirm the merge before cleanup starts.

After a confirmed merge, cleanup switches to the base branch, updates it with fast-forward-only pull, confirms the work branch is merged, deletes the local branch safely, and removes the remote branch when it still exists. It then clears the session. If a cleanup step fails, the session remains with `cleanup = incomplete` so the failure is visible and can be retried. No force deletion is used.

`/work abort` clears only logical session state. It does not delete branches or files. Session entries persist state across normal Pi restore. Git and GitHub remain authoritative for external facts.

V0 limitations: check detection supports `package.json` only; merge uses GitHub CLI squash merge; there is no automatic CI polling, review assistant, release workflow, or Wayfinder automation. Merge approval is accepted from explicit input phrases and is never inferred from approval-like comments such as `looks good`, `nice`, or `ready`.
