import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { redFirstVerdict } from "../../templates/scripts/udd/red-first.mjs";

const load = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));
const base = load("pw-base.json");
const head = load("pw-head.json");

test("no tagged test in head", () => {
  assert.equal(redFirstVerdict(base, head, "@udd-99").reason, "no-tagged-test");
});
test("tagged test passes on base", () => {
  assert.equal(redFirstVerdict(base, head, "@udd-14").reason, "passes-on-base");
});
test("tagged test fails on head", () => {
  assert.equal(redFirstVerdict(base, head, "@udd-16").reason, "fails-on-head");
});
test("tag in title, failed on base -> ok", () => {
  const v = redFirstVerdict(base, head, "@udd-12");
  assert.deepEqual(v, { ok: true, reason: "ok", tests: ["login works @udd-12"] });
});
test("tag in tags, absent on base -> ok", () => {
  assert.deepEqual(redFirstVerdict(base, head, "@udd-15").tests, ["new test"]);
});
test("retry that passes on base counts as passing there", () => {
  assert.equal(redFirstVerdict(base, head, "@udd-13").reason, "passes-on-base");
});
test("CLI exit code", () => {
  const f = (n) => new URL(`./fixtures/${n}`, import.meta.url).pathname;
  const ok = spawnSync("node", ["templates/scripts/udd/red-first.mjs", f("pw-base.json"), f("pw-head.json"), "@udd-12"], { encoding: "utf8" });
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout.trim(), "ok");
  const bad = spawnSync("node", ["templates/scripts/udd/red-first.mjs", f("pw-base.json"), f("pw-head.json"), "@udd-14"], { encoding: "utf8" });
  assert.equal(bad.status, 1);
});
