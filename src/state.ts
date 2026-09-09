export const STAGES = ["initialized", "understanding", "planning", "implementation", "validation", "review", "waiting-for-ci", "waiting-for-approval", "merging", "cleanup", "completed"] as const;
export type Stage = typeof STAGES[number];
export type CheckState = "not-run" | "passed" | "failed";
export type CiState = "unknown" | "pending" | "passed" | "failed";
export type PrState = "none" | "open" | "merged" | "closed";

export interface WorkSession {
  repository: { root: string; name: string; remote?: string; owner?: string; repo?: string };
  issue: { number: number; title: string; body: string; labels: string[]; url?: string };
  baseBranch: string;
  workBranch: string;
  stage: Stage;
  mergePermission: boolean;
  approvedHeadSha?: string;
  checks: CheckState;
  ci: CiState;
  pr: { state: PrState; number?: number; url?: string; head?: string; headSha?: string; base?: string };
  cleanup: "pending" | "complete" | "incomplete";
}

export function formatStatus(s: WorkSession | undefined): string {
  if (!s) return "No active dk-flow session.";
  return [
    `Repository   ${s.repository.owner && s.repository.repo ? `${s.repository.owner}/${s.repository.repo}` : s.repository.name}`,
    `Issue        #${s.issue.number} ${s.issue.title}`,
    `Base         ${s.baseBranch}`,
    `Branch       ${s.workBranch}`,
    `Stage        ${s.stage}`,
    `Checks       ${s.checks === "not-run" ? "not run" : s.checks}`,
    `PR           ${s.pr.number ? `#${s.pr.number} (${s.pr.state})` : "none"}`,
    `CI           ${s.ci}`,
    `Head         ${s.pr.headSha ?? "unknown"}`,
    `Merge        ${s.mergePermission ? `approved (${s.approvedHeadSha ?? "unknown"})` : "not approved"}`,
    `Cleanup      ${s.cleanup}`,
  ].join("\n");
}

export function restoreSession(entries: readonly any[]): WorkSession | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.type === "custom" && e.customType === "dk-flow-state" && e.data?.session) return e.data.session as WorkSession;
  }
  return undefined;
}

export function approveMerge(s: WorkSession, headSha: string): void {
  if (s.ci !== "passed") throw new Error("Cannot approve merge before CI passes");
  s.mergePermission = true;
  s.approvedHeadSha = headSha;
}

export function invalidateApprovalIfHeadChanged(s: WorkSession, headSha: string): boolean {
  if (s.pr.headSha === headSha) return false;
  s.pr.headSha = headSha;
  if (s.mergePermission || s.approvedHeadSha) { s.mergePermission = false; s.approvedHeadSha = undefined; return true; }
  return false;
}

export function assertSafeCleanup(s: WorkSession, currentBranch: string): void {
  if (s.workBranch === s.baseBranch || ["main", "dev"].includes(s.workBranch)) throw new Error("Refusing to delete a protected branch");
  if (currentBranch !== s.workBranch && currentBranch !== s.baseBranch) throw new Error("Current branch is unrelated to this session");
  if (s.pr.state !== "merged") throw new Error("Cleanup requires a confirmed merged PR");
}
