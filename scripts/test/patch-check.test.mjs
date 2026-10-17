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
test("CLI: reads a patch file, file list from diff headers, exit codes", () => {
  const dir = mkdtempSync(join(tmpdir(), "pc-"));
  const good = join(dir, "good.patch");
  const bad = join(dir, "bad.patch");
  writeFileSync(good, file("e2e/a.spec.ts", [T]) + file("src/my app.ts", ["x"]));
  writeFileSync(bad, file("e2e/a.spec.ts", [T]));
  const run = (p) => spawnSync("node", ["templates/scripts/udd/patch-check.mjs", p, "udd-7", "**/*.spec.ts,tests/**"], { encoding: "utf8" });
  let r = run(good);
  assert.deepEqual([r.status, r.stdout.trim()], [0, "ok"]);
  r = run(bad);
  assert.deepEqual([r.status, r.stdout.trim()], [1, "no-app-change"]);
  r = run(join(dir, "missing.patch"));
  assert.equal(r.status, 1);
});
