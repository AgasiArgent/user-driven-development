import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPatch } from "../../templates/scripts/udd/patch-check.mjs";

const GLOBS = ["**/*.spec.ts", "tests/**"];
const hunk = (lines) => `@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}\n`;
const file = (f, lines) => `diff --git a/${f} b/${f}\n--- a/${f}\n+++ b/${f}\n${hunk(lines)}`;
const T = 'test("books a room @udd-7", async () => {});';

test("ok: one tagged test and one app file", () => {
  const diff = file("e2e/a.spec.ts", [T]) + file("src/app.ts", ["export const x = 1;"]);
  const r = checkPatch({ files: ["e2e/a.spec.ts", "src/app.ts"], diff, tag: "@udd-7", testGlobs: GLOBS });
  assert.deepEqual(r, { ok: true, reason: "ok", testFiles: ["e2e/a.spec.ts"], appFiles: ["src/app.ts"] });
});
test("no tagged test", () => {
  const diff = file("src/app.ts", ["x"]);
  assert.equal(checkPatch({ files: ["src/app.ts"], diff, tag: "@udd-7", testGlobs: GLOBS }).reason, "no-tagged-test");
});
test("tag only on a removed or context line does not count", () => {
  const diff = `diff --git a/e2e/a.spec.ts b/e2e/a.spec.ts\n--- a/e2e/a.spec.ts\n+++ b/e2e/a.spec.ts\n@@ -1,2 +1,1 @@\n-${T}\n ${T}\n`;
  assert.equal(checkPatch({ files: ["e2e/a.spec.ts", "src/a.ts"], diff, tag: "@udd-7", testGlobs: GLOBS }).reason, "no-tagged-test");
});
test("tag boundary: @udd-7 does not match @udd-70", () => {
  const diff = file("e2e/a.spec.ts", ['test("x @udd-70", () => {});']) + file("src/a.ts", ["x"]);
  assert.equal(checkPatch({ files: ["e2e/a.spec.ts", "src/a.ts"], diff, tag: "udd-7", testGlobs: GLOBS }).reason, "no-tagged-test");
});
test("two tagged lines -> multiple-tagged-tests", () => {
  const diff = file("e2e/a.spec.ts", [T, T.replace("books", "cancels")]) + file("src/a.ts", ["x"]);
  assert.equal(checkPatch({ files: ["e2e/a.spec.ts", "src/a.ts"], diff, tag: "@udd-7", testGlobs: GLOBS }).reason, "multiple-tagged-tests");
});
test("only test files changed -> no-app-change", () => {
  const diff = file("e2e/a.spec.ts", [T]);
  const r = checkPatch({ files: ["e2e/a.spec.ts", "tests/helper.ts"], diff, tag: "@udd-7", testGlobs: GLOBS });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no-app-change");
  assert.deepEqual(r.appFiles, []);
  assert.deepEqual(r.testFiles, ["e2e/a.spec.ts", "tests/helper.ts"]);
});
test("+++ header line is not an added line", () => {
  const diff = `diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/@udd-7.ts\n@@ -0,0 +1 @@\n+x\n`;
  assert.equal(checkPatch({ files: ["src/a.ts"], diff, tag: "@udd-7", testGlobs: GLOBS }).reason, "no-tagged-test");
});
test("path containing ' b/' is accounted for by the file list", () => {
  const f = "src/a b/c.ts";
  const diff = file("e2e/a.spec.ts", [T]) + file(f, ["x"]);
  const r = checkPatch({ files: ["e2e/a.spec.ts", f], diff, tag: "@udd-7", testGlobs: GLOBS });
  assert.deepEqual([r.ok, r.reason, r.appFiles], [true, "ok", [f]]);
});
test("quoted diff --git header fails closed: ambiguous-header", () => {
  const diff = file("e2e/a.spec.ts", [T]) + `diff --git "a/src/\\303\\251.ts" "b/src/\\303\\251.ts"\n--- a/x\n+++ b/x\n${hunk(["x"])}`;
  const r = checkPatch({ files: ["e2e/a.spec.ts", "src/\u00e9.ts"], diff, tag: "@udd-7", testGlobs: GLOBS });
  assert.deepEqual([r.ok, r.reason], [false, "ambiguous-header"]);
});
test("header not in the file list fails closed: ambiguous-header", () => {
  const diff = file("e2e/a.spec.ts", [T]) + file("src/hidden.ts", ["x"]);
  const r = checkPatch({ files: ["e2e/a.spec.ts", "src/app.ts"], diff, tag: "@udd-7", testGlobs: GLOBS });
  assert.equal(r.reason, "ambiguous-header");
});
test("tag on a '+diff --git' content line is not a header", () => {
  const diff = file("e2e/a.spec.ts", [T, "diff --git a/zzz b/zzz"]) + file("src/a.ts", ["x"]);
  assert.equal(checkPatch({ files: ["e2e/a.spec.ts", "src/a.ts"], diff, tag: "@udd-7", testGlobs: GLOBS }).reason, "ok");
});

const dir = mkdtempSync(join(tmpdir(), "pc-"));
const cli = (patchText, files, tag = "udd-7", globs = "**/*.spec.ts,tests/**", extra) => {
  const patch = join(dir, "p.patch");
  const list = join(dir, "files.z");
  writeFileSync(patch, patchText);
  writeFileSync(list, files.join("\0") + (files.length ? "\0" : ""));
  const args = extra ?? ["--files-z", list];
  const r = spawnSync("node", ["templates/scripts/udd/patch-check.mjs", patch, tag, globs, ...args], { encoding: "utf8" });
  return { status: r.status, json: JSON.parse(r.stdout) };
};
test("CLI: --files-z, JSON output, path with spaces", () => {
  const f = "src/my b/app.ts";
  let r = cli(file("e2e/a.spec.ts", [T]) + file(f, ["x"]), ["e2e/a.spec.ts", f]);
  assert.deepEqual([r.status, r.json], [0, { ok: true, reason: "ok", testFiles: ["e2e/a.spec.ts"], appFiles: [f] }]);
  r = cli(file("e2e/a.spec.ts", [T]), ["e2e/a.spec.ts"]);
  assert.deepEqual([r.status, r.json.ok, r.json.reason], [1, false, "no-app-change"]);
});
test("CLI: globs are trimmed and may contain spaces", () => {
  const r = cli(file("my tests/a.ts", [T]) + file("src/a.ts", ["x"]), ["my tests/a.ts", "src/a.ts"], "udd-7", " my tests/** , **/*.spec.ts ");
  assert.deepEqual([r.status, r.json.testFiles], [0, ["my tests/a.ts"]]);
});
test("CLI: missing --files-z fails closed", () => {
  const r = cli(file("e2e/a.spec.ts", [T]) + file("src/a.ts", ["x"]), [], "udd-7", "tests/**", []);
  assert.deepEqual([r.status, r.json.ok, r.json.reason], [1, false, "files-list-required"]);
});
test("CLI: unreadable patch or file list fails closed", () => {
  let r = spawnSync("node", ["templates/scripts/udd/patch-check.mjs", join(dir, "nope"), "udd-7", "x", "--files-z", join(dir, "files.z")], { encoding: "utf8" });
  assert.deepEqual([r.status, JSON.parse(r.stdout).reason], [1, "unreadable-patch"]);
  r = spawnSync("node", ["templates/scripts/udd/patch-check.mjs", join(dir, "p.patch"), "udd-7", "x", "--files-z", join(dir, "nope")], { encoding: "utf8" });
  assert.deepEqual([r.status, JSON.parse(r.stdout).reason], [1, "files-list-unreadable"]);
});
