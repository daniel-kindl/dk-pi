export const STAGES = ["initialized", "understanding", "planning", "implementation", "validation", "waiting-for-approval", "completed"] as const;
export type Stage = typeof STAGES[number];
export type CheckState = "not-run" | "passed" | "failed";
export type PrState = "none" | "open" | "merged";

export interface WorkSession {
  repository: { root: string; name: string; remote?: string; owner?: string; repo?: string };
  issue: { number: number; title: string; body: string; labels: string[]; url?: string };
  baseBranch: string;
  workBranch: string;
  stage: Stage;
  mergePermission: boolean;
  checks: CheckState;
  pr: { state: PrState; number?: number; head?: string; base?: string };
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
    `Merge        ${s.mergePermission ? "approved" : "not approved"}`,
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

export function assertSafeCleanup(s: WorkSession, currentBranch: string): void {
  if (s.workBranch === s.baseBranch || ["main", "dev"].includes(s.workBranch)) throw new Error("Refusing to delete a protected branch");
  if (currentBranch !== s.workBranch && currentBranch !== s.baseBranch) throw new Error("Current branch is unrelated to this session");
  if (s.pr.state !== "merged") throw new Error("Cleanup requires a confirmed merged PR");
}
