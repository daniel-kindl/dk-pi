import test from "node:test";
import assert from "node:assert/strict";
import { chooseBaseBranch, parsePorcelainStatus, parseRemote } from "../src/repository.ts";

test("parses SSH and HTTPS GitHub remotes", () => { assert.deepEqual(parseRemote("git@github.com:daniel-kindl/dk-pi.git"), { owner: "daniel-kindl", repo: "dk-pi" }); assert.deepEqual(parseRemote("https://github.com/a/b"), { owner: "a", repo: "b" }); });
test("detects dirty porcelain output", () => { assert.equal(parsePorcelainStatus(" M file.ts\n"), true); assert.equal(parsePorcelainStatus(""), false); });
test("prefers an existing dev base without assuming it exists", () => { assert.equal(chooseBaseBranch(["feature/x", "main", "dev"]), "dev"); assert.equal(chooseBaseBranch(["trunk", "feature/x"]), "trunk"); });
