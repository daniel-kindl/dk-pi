export interface GitRunner { (args: string[]): Promise<{ stdout: string; stderr: string; code: number }> }

export interface RepositoryContext { root: string; name: string; remote?: string; owner?: string; repo?: string; branch: string; dirty: boolean; upstream?: string; baseBranch?: string }

export function parseRemote(remote: string): { owner: string; repo: string } | undefined {
  const value = remote.trim().replace(/\.git$/, "");
  const match = value.match(/(?:github\.com[/:])([^/]+)\/([^/]+)$/i);
  return match ? { owner: match[1], repo: match[2] } : undefined;
}

export function parsePorcelainStatus(output: string): boolean { return output.trim().length > 0; }

export function chooseBaseBranch(branches: string[], current?: string): string | undefined {
  const preferred = ["dev", "main", "master", "trunk"];
  return preferred.find((b) => branches.includes(b)) ?? (current && branches.includes(current) ? current : branches[0]);
}

export async function detectRepository(git: GitRunner): Promise<RepositoryContext> {
  const run = async (...args: string[]) => git(args);
  const root = (await run("rev-parse", "--show-toplevel")).stdout.trim();
  if (!root) throw new Error("Not a Git repository");
  const [remoteResult, branchResult, statusResult, upstreamResult, branchesResult] = await Promise.all([
    run("remote", "get-url", "origin"), run("branch", "--show-current"), run("status", "--porcelain"),
    run("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"), run("for-each-ref", "--format=%(refname:short)", "refs/heads"),
  ]);
  const remote = remoteResult.code === 0 ? remoteResult.stdout.trim() : undefined;
  const identity = remote ? parseRemote(remote) : undefined;
  const branch = branchResult.stdout.trim();
  const localBranches = branchesResult.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
  return { root, name: root.split("/").pop() ?? root, remote, ...identity, branch, dirty: parsePorcelainStatus(statusResult.stdout), upstream: upstreamResult.code === 0 ? upstreamResult.stdout.trim() : undefined, baseBranch: chooseBaseBranch(localBranches, branch) };
}
