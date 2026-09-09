import test from "node:test";
import assert from "node:assert/strict";
import { assertSafeCleanup, approveMerge, formatStatus, invalidateApprovalIfHeadChanged, restoreSession, type WorkSession } from "../src/state.ts";

const session: WorkSession = { repository: { root: "/repo", name: "repo" }, issue: { number: 7, title: "Fix bug", body: "", labels: [] }, baseBranch: "dev", workBranch: "feature/7-fix-bug", stage: "waiting-for-approval", mergePermission: false, checks: "passed", ci: "passed", pr: { state: "open", number: 12, headSha: "abc123" }, cleanup: "pending" };

test("restores the latest state entry", () => assert.equal(restoreSession([{ type: "custom", customType: "dk-flow-state", data: { session } }]), session));
test("status exposes merge approval separately from checks", () => { const text = formatStatus(session); assert.match(text, /Checks       passed/); assert.match(text, /Merge        not approved/); });
test("CI does not grant merge permission", () => assert.equal(session.mergePermission, false));
test("approval is bound to the approved head", () => { approveMerge(session, "abc123"); assert.equal(session.approvedHeadSha, "abc123"); assert.equal(invalidateApprovalIfHeadChanged(session, "def456"), true); assert.equal(session.mergePermission, false); assert.equal(session.approvedHeadSha, undefined); });
test("approval cannot precede successful CI", () => assert.throws(() => approveMerge({ ...session, ci: "pending" }, "abc123"), /CI passes/));
test("cleanup requires a confirmed merge", () => assert.throws(() => assertSafeCleanup(session, session.workBranch), /confirmed merged/));
test("cleanup rejects protected branches", () => assert.throws(() => assertSafeCleanup({ ...session, pr: { state: "merged" }, workBranch: "main" }, "main"), /protected/));
test("merged session can pass cleanup safety", () => assert.doesNotThrow(() => assertSafeCleanup({ ...session, pr: { state: "merged" } }, session.workBranch)));
