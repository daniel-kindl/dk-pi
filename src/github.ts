import type { GitRunner } from "./repository.ts";
import type { CiState, PrState } from "./state.ts";

export interface Issue { number: number; title: string; body: string; labels: string[]; url?: string }
export interface PullRequest { number: number; url?: string; state: PrState; head: string; headSha: string; base: string; ci: CiState; mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN"; reviewDecision?: string; linkedIssue: boolean }

export async function loadIssue(run: GitRunner, number: number): Promise<Issue> {
  const result = await run(["gh", "issue", "view", String(number), "--json", "number,title,body,labels,url"]);
  if (result.code !== 0) throw new Error(result.stderr.trim() || "Could not load GitHub issue");
  const raw = JSON.parse(result.stdout) as { number: number; title: string; body?: string; labels?: Array<{ name: string }>; url?: string };
  return { number: raw.number, title: raw.title, body: raw.body ?? "", labels: (raw.labels ?? []).map((x) => x.name), url: raw.url };
}

function ciFromRollup(rollup: Array<{ status?: string; conclusion?: string }> | undefined): CiState {
  if (!rollup?.length) return "unknown";
  if (rollup.some((x) => x.conclusion === "FAILURE" || x.conclusion === "CANCELLED" || x.conclusion === "TIMED_OUT")) return "failed";
  if (rollup.some((x) => x.status !== "COMPLETED")) return "pending";
  return rollup.every((x) => x.conclusion === "SUCCESS" || x.conclusion === "NEUTRAL" || x.conclusion === "SKIPPED") ? "passed" : "failed";
}

export function parsePullRequest(raw: any, issueNumber: number): PullRequest {
  const refs = raw.closingIssuesReferences ?? [];
  return { number: raw.number, url: raw.url, state: String(raw.state).toLowerCase() as PrState, head: raw.headRefName, headSha: raw.headRefOid, base: raw.baseRefName, ci: ciFromRollup(raw.statusCheckRollup), mergeable: raw.mergeable ?? "UNKNOWN", reviewDecision: raw.reviewDecision, linkedIssue: refs.some((x: any) => x.number === issueNumber) };
}

export async function loadPullRequest(run: GitRunner, number: number, issueNumber: number): Promise<PullRequest> {
  const result = await run(["gh", "pr", "view", String(number), "--json", "number,url,state,headRefName,headRefOid,baseRefName,statusCheckRollup,mergeable,reviewDecision,closingIssuesReferences"]);
  if (result.code !== 0) throw new Error(result.stderr.trim() || "Could not load GitHub pull request");
  return parsePullRequest(JSON.parse(result.stdout), issueNumber);
}

export async function findPullRequest(run: GitRunner, head: string, base: string, issueNumber: number): Promise<PullRequest | undefined> {
  const result = await run(["gh", "pr", "list", "--head", head, "--base", base, "--state", "all", "--json", "number,url,state,headRefName,headRefOid,baseRefName,statusCheckRollup,mergeable,reviewDecision,closingIssuesReferences"]);
  if (result.code !== 0) return undefined;
  const rows = JSON.parse(result.stdout) as any[];
  const open = rows.find((row) => String(row.state).toLowerCase() === "open");
  return open ? parsePullRequest(open, issueNumber) : undefined;
}

export async function createPullRequest(run: GitRunner, head: string, base: string, issue: Issue, title: string): Promise<PullRequest> {
  const body = `Closes #${issue.number}\n\n${issue.body}`;
  const result = await run(["gh", "pr", "create", "--head", head, "--base", base, "--title", title, "--body", body]);
  if (result.code !== 0) throw new Error(result.stderr.trim() || "Could not create pull request");
  const match = result.stdout.match(/(\d+)$/m);
  if (!match) throw new Error("Pull request was created but its number was not returned");
  return loadPullRequest(run, Number(match[1]), issue.number);
}
