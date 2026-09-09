import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { detectRepository } from "./repository.ts";
import { createPullRequest, findPullRequest, loadIssue, loadPullRequest, type PullRequest } from "./github.ts";
import { formatStatus, restoreSession, approveMerge, type WorkSession } from "./state.ts";
import { preMergeBlocker, reconcilePullRequest } from "./lifecycle.ts";
import { readFile } from "node:fs/promises";

const protectedBranches = new Set(["main", "dev"]);
const approvalWords = /\b(green[- ]?go|merge it|go ahead and merge|approved[, ]+merge)\b/i;

export default function dkFlow(pi: ExtensionAPI) {
  let session: WorkSession | undefined;
  const git = (args: string[]) => pi.exec("git", args);
  const command = (args: string[]) => pi.exec(args[0], args.slice(1));
  const save = () => { if (session) pi.appendEntry("dk-flow-state", { session }); };
  const notify = (ctx: ExtensionContext, text: string, level: "info" | "warning" | "error" = "info") => ctx.ui.notify(text, level);

  async function refreshRepository() {
    if (!session) return;
    const repo = await detectRepository(git);
    session.repository = { ...session.repository, root: repo.root, name: repo.name, remote: repo.remote, owner: repo.owner, repo: repo.repo };
    if (repo.branch !== session.workBranch && repo.branch !== session.baseBranch) throw new Error(`Current branch ${repo.branch} is unrelated to this session`);
  }

  async function refreshPullRequest() {
    if (!session?.pr.number) return;
    const pr = await loadPullRequest(command, session.pr.number, session.issue.number);
    reconcilePullRequest(session, pr);
    save();
  }

  pi.on("session_start", async (_event, ctx) => {
    session = restoreSession(ctx.sessionManager.getBranch());
    if (session) {
      try { await refreshRepository(); await refreshPullRequest(); } catch (error) { notify(ctx, `dk-flow restore warning: ${error instanceof Error ? error.message : String(error)}`, "warning"); }
      ctx.ui.setStatus("dk-flow", `flow: ${session.stage} · #${session.issue.number}`);
    }
  });
  pi.on("session_tree", async (_event, ctx) => { session = restoreSession(ctx.sessionManager.getBranch()); });

  pi.on("input", async (event, ctx) => {
    if (!session || event.source === "extension" || !approvalWords.test(event.text)) return;
    try {
      await refreshRepository();
      await refreshPullRequest();
      if (!session.pr.headSha) throw new Error("The PR head SHA is not available");
      approveMerge(session, session.pr.headSha);
      session.stage = "merging";
      save();
      notify(ctx, `Merge approved for PR #${session.pr.number} head ${session.pr.headSha}. Pre-merge verification is required.`);
    } catch (error) { notify(ctx, error instanceof Error ? error.message : String(error), "error"); }
  });

  pi.on("before_agent_start", async () => {
    if (!session) return;
    const issueContext = session.issue.body.trim().slice(0, 6000);
    return { message: { customType: "dk-flow-context", content: `Active dk-flow session:\n${formatStatus(session)}\nLabels: ${session.issue.labels.join(", ") || "none"}\nIssue description:\n${issueContext || "(no description)"}\nGuardrails: do not work on protected branches; CI passing is not merge approval; approval is bound to the current PR head; merge requires explicit maintainer green-go.`, display: false } };
  });

  pi.on("tool_call", async (event) => {
    if (!session) return;
    const input = event.input as Record<string, unknown>;
    const text = typeof input.command === "string" ? input.command : "";
    let current = session.workBranch;
    try { current = (await git(["branch", "--show-current"])).stdout.trim() || current; } catch { /* fail closed below when the branch is known */ }
    if ((event.toolName === "write" || event.toolName === "edit") && (protectedBranches.has(session.workBranch) || protectedBranches.has(current))) return { block: true, reason: "dk-flow: refusing file changes on a protected branch", terminate: true };
    if (event.toolName === "bash" && (protectedBranches.has(session.workBranch) || protectedBranches.has(current)) && /\bgit\s+(commit|push|merge)\b/.test(text)) return { block: true, reason: "dk-flow: refusing Git changes on a protected branch", terminate: true };
  });

  pi.registerCommand("work", {
    description: "Start, inspect, or finish a dk-flow work session",
    handler: async (args, ctx) => {
      const value = args.trim();
      if (value === "status" || !value) { await status(ctx); return; }
      if (value === "check") { await runChecks(ctx); return; }
      if (value === "finish") { await finish(ctx); return; }
      if (value === "merge") { await merge(ctx); return; }
      if (value === "abort") { if (session) { session = undefined; notify(ctx, "Session cleared. Work branches and files were not deleted.", "warning"); } else notify(ctx, "No active dk-flow session."); return; }
      if (!/^\d+$/.test(value)) { notify(ctx, "Usage: /work <issue-number>, status, check, finish, merge, or abort", "error"); return; }
      await start(Number(value), ctx);
    },
  });

  async function status(ctx: ExtensionContext) {
    if (!session) { notify(ctx, formatStatus(undefined)); return; }
    try { await refreshRepository(); await refreshPullRequest(); } catch (error) { notify(ctx, `Status refresh warning: ${error instanceof Error ? error.message : String(error)}`, "warning"); }
    notify(ctx, formatStatus(session));
  }

  async function start(number: number, ctx: ExtensionContext) {
    try {
      const repo = await detectRepository(git);
      if (!repo.owner || !repo.repo) throw new Error("The origin remote is not a GitHub repository");
      if (repo.dirty && protectedBranches.has(repo.branch)) throw new Error(`Working tree is dirty on protected branch ${repo.branch}; commit or stash it first`);
      const issue = await loadIssue(command, number);
      const base = repo.baseBranch ?? repo.branch;
      const proposed = `feature/${number}-${slug(issue.title)}`;
      let branch = repo.branch;
      const looksLikeWorkBranch = /^(feature|fix|docs|refactor|chore)\//.test(repo.branch);
      if (protectedBranches.has(repo.branch) || (!looksLikeWorkBranch && !repo.dirty)) {
        const created = await git(["switch", "-c", proposed]);
        if (created.code !== 0) throw new Error(created.stderr.trim() || "Could not create work branch");
        branch = proposed;
      } else if (repo.dirty) notify(ctx, "Working tree is dirty. Existing branch retained; review unrelated changes before work.", "warning");
      session = { repository: { root: repo.root, name: repo.name, remote: repo.remote, owner: repo.owner, repo: repo.repo }, issue, baseBranch: base, workBranch: branch, stage: "implementation", mergePermission: false, checks: "not-run", ci: "unknown", pr: { state: "none" }, cleanup: "pending" };
      save();
      ctx.ui.setStatus("dk-flow", `flow: implementation · #${number}`);
      notify(ctx, formatStatus(session));
    } catch (error) { notify(ctx, error instanceof Error ? error.message : String(error), "error"); }
  }

  async function runChecks(ctx: ExtensionContext) {
    if (!session) { notify(ctx, "No active dk-flow session.", "warning"); return; }
    try {
      await refreshRepository();
      const text = await readFile(`${session.repository.root}/package.json`, "utf8");
      const scripts = (JSON.parse(text) as { scripts?: Record<string, string> }).scripts ?? {};
      const names = ["lint", "test", "build"].filter((name) => scripts[name]);
      if (!names.length) { notify(ctx, "No supported checks found in package.json.", "warning"); return; }
      session.stage = "validation"; session.checks = "not-run"; save();
      for (const name of names) { const result = await pi.exec("npm", ["run", name]); if (result.code !== 0) { session.checks = "failed"; save(); notify(ctx, `Check failed: ${name}\n${result.stderr || result.stdout}`, "error"); return; } }
      session.checks = "passed"; save(); notify(ctx, `Checks passed: ${names.join(", ")}`);
    } catch (error) { notify(ctx, error instanceof Error ? error.message : "V0 check detection supports package.json only.", "warning"); }
  }

  async function finish(ctx: ExtensionContext) {
    if (!session) { notify(ctx, "No active dk-flow session.", "error"); return; }
    try {
      await refreshRepository();
      const repo = await detectRepository(git);
      if (repo.branch !== session.workBranch) throw new Error(`Finish must run on ${session.workBranch}; current branch is ${repo.branch}`);
      if (protectedBranches.has(repo.branch)) throw new Error("Finish cannot run on a protected branch");
      if (session.checks !== "passed") throw new Error("Run /work check successfully before /work finish");
      if (repo.dirty) {
        const unstaged = await git(["diff", "--name-only"]);
        const status = await git(["status", "--porcelain"]);
        if (!ctx.hasUI && (unstaged.stdout.trim() || status.stdout.split("\n").some((line) => line.startsWith("??")))) throw new Error("Unstaged changes remain; stage only issue-related files before non-interactive finish");
        if (ctx.hasUI && !(await ctx.ui.confirm("Commit work?", "This stages all current changes. Confirm that they belong to the active issue."))) throw new Error("Uncommitted changes remain; finish stopped");
        const add = await git(["add", "-A"]); if (add.code !== 0) throw new Error(add.stderr || "Could not stage changes");
        const commit = await git(["commit", "-m", commitTitle(session.issue.title)]); if (commit.code !== 0) throw new Error(commit.stderr || "Could not create commit");
      } else if (!/^[a-z]+(?:\([^)]+\))?!?: .+/.test((await git(["log", "-1", "--format=%s"])).stdout.trim())) throw new Error("HEAD is not a Conventional Commit");
      const pushed = await git(["push", "-u", "origin", session.workBranch]); if (pushed.code !== 0) throw new Error(pushed.stderr || "Could not push work branch");
      let pr = await findPullRequest(command, session.workBranch, session.baseBranch, session.issue.number);
      if (!pr) pr = await createPullRequest(command, session.workBranch, session.baseBranch, session.issue, commitTitle(session.issue.title));
      reconcilePullRequest(session, pr); save(); notify(ctx, `PR #${pr.number} created or reused.\n${formatStatus(session)}`);
    } catch (error) { notify(ctx, error instanceof Error ? error.message : String(error), "error"); }
  }

  async function merge(ctx: ExtensionContext) {
    if (!session?.pr.number) { notify(ctx, "No active PR.", "error"); return; }
    try {
      await refreshRepository(); await refreshPullRequest();
      const pr = await loadPullRequest(command, session.pr.number, session.issue.number);
      const blocker = preMergeBlocker(session, pr);
      if (blocker) { session.stage = "waiting-for-approval"; save(); throw new Error(`Merge blocked: ${blocker}`); }
      session.stage = "merging"; save();
      const result = await command(["gh", "pr", "merge", String(pr.number), "--squash", "--match-head-commit", pr.headSha, "--delete-branch=false"]);
      if (result.code !== 0) { session.stage = "waiting-for-approval"; save(); throw new Error(result.stderr || "Merge failed; cleanup was not started"); }
      const confirmed = await loadPullRequest(command, pr.number, session.issue.number);
      if (confirmed.state !== "merged") { session.stage = "waiting-for-approval"; save(); throw new Error("GitHub did not confirm the merge; cleanup was not started"); }
      reconcilePullRequest(session, confirmed); await cleanup(ctx);
    } catch (error) { notify(ctx, error instanceof Error ? error.message : String(error), "error"); }
  }

  async function cleanup(ctx: ExtensionContext) {
    if (!session) return;
    try {
      const repo = await detectRepository(git);
      if (repo.branch !== session.baseBranch) {
        const switched = await git(["switch", session.baseBranch]); if (switched.code !== 0) throw new Error(switched.stderr || "Could not switch to base branch");
      }
      const updated = await git(["pull", "--ff-only"]); if (updated.code !== 0) throw new Error(updated.stderr || "Could not update base branch");
      const merged = await git(["branch", "--merged", session.baseBranch]);
      if (!merged.stdout.split("\n").some((line) => line.replace(/^\*\s*/, "").trim() === session.workBranch)) throw new Error("Work branch is not merged into the updated base branch");
      const deleted = await git(["branch", "-d", session.workBranch]); if (deleted.code !== 0) throw new Error(deleted.stderr || "Could not delete local work branch safely");
      const remote = await git(["push", "origin", "--delete", session.workBranch]);
      if (remote.code !== 0 && !/remote ref does not exist|unable to delete/i.test(remote.stderr)) throw new Error(remote.stderr || "Could not delete remote work branch");
      session.cleanup = "complete"; session.stage = "completed"; save(); pi.appendEntry("dk-flow-state", { session: null }); session = undefined; ctx.ui.setStatus("dk-flow", undefined); notify(ctx, "PR merged. Base branch updated; local and remote work branches deleted. dk-flow session cleared. Work complete.");
    } catch (error) { if (session) { session.cleanup = "incomplete"; save(); } throw error; }
  }
}

function slug(title: string): string { return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40); }
function commitTitle(title: string): string { return `feat: ${title.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim().slice(0, 60)}`; }
