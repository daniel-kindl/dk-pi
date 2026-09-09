import type { GitRunner } from "./repository.ts";

export interface Issue { number: number; title: string; body: string; labels: string[]; url?: string }

export async function loadIssue(run: GitRunner, number: number): Promise<Issue> {
  const result = await run(["gh", "issue", "view", String(number), "--json", "number,title,body,labels,url"]);
  if (result.code !== 0) throw new Error(result.stderr.trim() || "Could not load GitHub issue");
  const raw = JSON.parse(result.stdout) as { number: number; title: string; body?: string; labels?: Array<{ name: string }>; url?: string };
  return { number: raw.number, title: raw.title, body: raw.body ?? "", labels: (raw.labels ?? []).map((x) => x.name), url: raw.url };
}
