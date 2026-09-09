import test from "node:test";
import assert from "node:assert/strict";
import { preMergeBlocker, reconcilePullRequest } from "../src/lifecycle.ts";
import type { WorkSession } from "../src/state.ts";

const session: WorkSession = { repository: { root: "/repo", name: "repo" }, issue: { number: 1, title: "Lifecycle", body: "", labels: [] }, baseBranch: "dev", workBranch: "feature/1-lifecycle", stage: "waiting-for-approval", mergePermission: true, approvedHeadSha: "abc", checks: "passed", ci: "passed", pr: { state: "open", number: 2, headSha: "abc" }, cleanup: "pending" };
const pr = (extra: Partial<any> = {}) => ({ number: 2, state: "open", head: "feature/1-lifecycle", headSha: "abc", base: "dev", ci: "passed", mergeable: "MERGEABLE", linkedIssue: true, ...extra });

test("pre-merge verification blocks without approval", () => assert.match(preMergeBlocker({ ...session, mergePermission: false }, pr()), /approval/));
test("pre-merge verification blocks failed CI", () => assert.match(preMergeBlocker(session, pr({ ci: "failed" })), /CI/));
test("pre-merge verification blocks wrong base and head", () => { assert.match(preMergeBlocker(session, pr({ base: "main" })), /targets/); assert.match(preMergeBlocker(session, pr({ headSha: "def" })), /current PR head/); });
test("pre-merge verification blocks conflicts and missing issue link", () => { assert.match(preMergeBlocker(session, pr({ mergeable: "CONFLICTING" })), /mergeable/); assert.match(preMergeBlocker(session, pr({ linkedIssue: false })), /linked/); });
test("reconciliation invalidates approval when GitHub head changes", () => { const copy = structuredClone(session); reconcilePullRequest(copy, pr({ headSha: "def" })); assert.equal(copy.mergePermission, false); assert.equal(copy.approvedHeadSha, undefined); });
test("merged PR makes cleanup eligible but does not perform it", () => { const copy = structuredClone(session); reconcilePullRequest(copy, pr({ state: "merged" })); assert.equal(copy.stage, "cleanup"); assert.equal(copy.pr.state, "merged"); });
