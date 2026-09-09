import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { detectRepository } from "./repository.ts";
import { loadIssue } from "./github.ts";
import { formatStatus, restoreSession, type WorkSession } from "./state.ts";
import { readFile } from "node:fs/promises";

const protectedBranches = new Set(["main", "dev"]);

export default function dkFlow(pi: ExtensionAPI) {
  let session: WorkSession | undefined;

  const git = (args: string[]) => pi.exec("git", args);
  const command = (args: string[]) => pi.exec(args[0], args.slice(1));
  const save = () => { if (session) pi.appendEntry("dk-flow-state", { session }); };
  const notify = (ctx: ExtensionContext, text: string, level: "info" | "warning" | "error" = "info") => ctx.ui.notify(text, level);

  async function refresh(ctx: ExtensionContext) {
    if (!session) return;
    try {
      const repo = await detectRepository(git);
      // Git is authoritative for the current branch and repository facts.
      session.repository = { ...session.repository, root: repo.root, name: repo.name, remote: repo.remote, owner: repo.owner, repo: repo.repo };
      session.cleanup = session.cleanup === "complete" ? "complete" : "pending";
    } catch { /* status can still show persisted metadata when Git is unavailable */ }
  }

  pi.on("session_start", async (_event, ctx) => {
    session = restoreSession(ctx.sessionManager.getBranch());
    await refresh(ctx);
    if (session) ctx.ui.setStatus("dk-flow", `flow: ${session.stage} · #${session.issue.number}`);
  });
  pi.on("session_tree", async (_event, ctx) => { session = restoreSession(ctx.sessionManager.getBranch()); });

  pi.on("before_agent_start", async (event) => {
    if (!session) return;
    const issueContext = session.issue.body.trim().slice(0, 6000);
    return { message: { customType: "dk-flow-context", content: `Active dk-flow session:\n${formatStatus(session)}\nLabels: ${session.issue.labels.join(", ") || "none"}\nIssue description:\n${issueContext || "(no description)"}\nGuardrails: do not work on protected branches; CI passing is not merge approval; merge requires explicit maintainer approval.`, display: false } };
  });

  pi.on("tool_call", async (event) => {
    if (!session) return;
    const input = event.input as Record<string, unknown>;
    const commandText = typeof input.command === "string" ? input.command : "";
    let currentBranch = session.workBranch;
    try { currentBranch = (await git(["branch", "--show-current"])).stdout.trim() || currentBranch; } catch { /* keep persisted branch */ }
    if ((event.toolName === "write" || event.toolName === "edit") && (protectedBranches.has(session.workBranch) || protectedBranches.has(currentBranch))) {
      return { block: true, reason: `dk-flow: refusing file changes on protected branch ${session.workBranch}`, terminate: true };
    }
    if (event.toolName === "bash" && protectedBranches.has(session.workBranch) && /\bgit\s+(commit|push|merge)\b/.test(commandText)) {
      return { block: true, reason: `dk-flow: refusing Git changes on protected branch ${session.workBranch}`, terminate: true };
    }
  });

  pi.registerCommand("work", {
    description: "Start or inspect a dk-flow work session",
    handler: async (args, ctx) => {
      const value = args.trim();
      if (value === "status" || !value) { await refresh(ctx); notify(ctx, formatStatus(session)); return; }
      if (value === "abort") { if (session) { session = undefined; notify(ctx, "Session cleared. Work branches and files were not deleted.", "warning"); } else notify(ctx, "No active dk-flow session."); return; }
      if (value === "check") { await runChecks(ctx); return; }
      if (!/^\d+$/.test(value)) { notify(ctx, "Usage: /work <issue-number>, /work status, /work check, or /work abort", "error"); return; }
      const number = Number(value);
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
        } else if (repo.dirty) {
          notify(ctx, "Working tree is dirty. Existing branch retained; review unrelated changes before work.", "warning");
        }
        session = { repository: { root: repo.root, name: repo.name, remote: repo.remote, owner: repo.owner, repo: repo.repo }, issue, baseBranch: base, workBranch: branch, stage: "implementation", mergePermission: false, checks: "not-run", pr: { state: "none" }, cleanup: "pending" };
        save();
        ctx.ui.setStatus("dk-flow", `flow: implementation · #${number}`);
        notify(ctx, formatStatus(session));
      } catch (error) { notify(ctx, error instanceof Error ? error.message : String(error), "error"); }
    },
  });

  async function runChecks(ctx: ExtensionContext) {
    if (!session) { notify(ctx, "No active dk-flow session.", "warning"); return; }
    try {
      const text = await readFile(`${session.repository.root}/package.json`, "utf8");
      const scripts = (JSON.parse(text) as { scripts?: Record<string, string> }).scripts ?? {};
      const names = ["lint", "test", "build"].filter((name) => scripts[name]);
      if (!names.length) { notify(ctx, "No supported checks found in package.json.", "warning"); return; }
      session.stage = "validation"; session.checks = "not-run"; save();
      for (const name of names) { const result = await pi.exec("npm", ["run", name]); if (result.code !== 0) { session.checks = "failed"; save(); notify(ctx, `Check failed: ${name}\n${result.stderr || result.stdout}`, "error"); return; } }
      session.checks = "passed"; save(); notify(ctx, `Checks passed: ${names.join(", ")}`);
    } catch { notify(ctx, "V0 check detection supports package.json only.", "warning"); }
  }
}

function slug(title: string): string { return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40); }
