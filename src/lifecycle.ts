import type { PullRequest } from "./github.ts";
import type { WorkSession } from "./state.ts";

export function reconcilePullRequest(session: WorkSession, pr: PullRequest): void {
  session.pr = { ...session.pr, number: pr.number, url: pr.url, state: pr.state, head: pr.head, headSha: pr.headSha, base: pr.base };
  session.ci = pr.ci;
  if (session.mergePermission && session.approvedHeadSha !== pr.headSha) {
    session.mergePermission = false;
    session.approvedHeadSha = undefined;
  }
  if (pr.state === "merged") session.stage = "cleanup";
  else if (pr.ci === "passed") session.stage = "waiting-for-approval";
  else session.stage = "waiting-for-ci";
}

export function preMergeBlocker(session: WorkSession, pr: PullRequest): string | undefined {
  if (!session.mergePermission) return "explicit maintainer merge approval is missing";
  if (!session.approvedHeadSha || session.approvedHeadSha !== pr.headSha) return "merge approval is not for the current PR head";
  if (pr.state !== "open") return `PR is not open (${pr.state})`;
  if (pr.base !== session.baseBranch) return `PR targets ${pr.base}, expected ${session.baseBranch}`;
  if (pr.head !== session.workBranch) return "PR head branch does not match the session";
  if (pr.ci !== "passed") return `CI is ${pr.ci}, not passed`;
  if (pr.mergeable !== "MERGEABLE") return `PR is not mergeable (${pr.mergeable})`;
  if (!pr.linkedIssue) return "PR is not linked to the active issue";
  if (pr.reviewDecision === "CHANGES_REQUESTED") return "PR has blocking requested changes";
  return undefined;
}
