import test from "node:test";
import assert from "node:assert/strict";
import { assertSafeCleanup, formatStatus, restoreSession, type WorkSession } from "../src/state.ts";

const session: WorkSession = { repository: { root: "/repo", name: "repo" }, issue: { number: 7, title: "Fix bug", body: "", labels: [] }, baseBranch: "dev", workBranch: "feature/7-fix-bug", stage: "waiting-for-approval", mergePermission: false, checks: "passed", pr: { state: "open", number: 12 }, cleanup: "pending" };

test("restores the latest state entry", () => assert.equal(restoreSession([{ type: "custom", customType: "dk-flow-state", data: { session } }]), session));
test("status exposes merge approval separately from checks", () => { const text = formatStatus(session); assert.match(text, /Checks       passed/); assert.match(text, /Merge        not approved/); });
test("cleanup requires a confirmed merge", () => assert.throws(() => assertSafeCleanup(session, session.workBranch), /confirmed merged/));
test("cleanup rejects protected branches", () => assert.throws(() => assertSafeCleanup({ ...session, pr: { state: "merged" }, workBranch: "main" }, "main"), /protected/));
test("merged session can pass cleanup safety", () => assert.doesNotThrow(() => assertSafeCleanup({ ...session, pr: { state: "merged" } }, session.workBranch)));
