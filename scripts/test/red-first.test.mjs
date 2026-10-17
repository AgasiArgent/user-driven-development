import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { redFirstVerdict, tagRegex } from "../../templates/scripts/udd/red-first.mjs";

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
test("tag in tags, failed on base -> ok", () => {
  assert.deepEqual(redFirstVerdict(base, head, "@udd-15").tests, ["new test"]);
});
const rep = (specs) => ({ suites: [{ title: "f", specs }] });
const spec = (title, status, tags = []) => ({ title, tags, tests: [{ results: [{ status }] }] });
test("absent on base is NOT red -> base-missing", () => {
  const h = rep([spec("brand new @udd-20", "passed")]);
  const v = redFirstVerdict(rep([spec("other", "passed")]), h, "@udd-20");
  assert.deepEqual(v, { ok: false, reason: "base-missing", tests: [] });
});
test("empty / unparsable base -> base-missing", () => {
  const h = rep([spec("x @udd-20", "passed")]);
  assert.equal(redFirstVerdict({}, h, "@udd-20").reason, "base-missing");
  assert.equal(redFirstVerdict(null, h, "@udd-20").reason, "base-missing");
  assert.equal(redFirstVerdict(rep([]), h, "@udd-20").reason, "base-missing");
});
test("only failed/timedOut/interrupted count as red", () => {
  const h = rep([spec("x @udd-20", "passed")]);
  for (const st of ["failed", "timedOut", "interrupted"]) {
    assert.equal(redFirstVerdict(rep([spec("x @udd-20", st)]), h, "@udd-20").reason, "ok", st);
  }
  assert.equal(redFirstVerdict(rep([spec("x @udd-20", "skipped")]), h, "@udd-20").reason, "base-missing");
});
test("order: base-missing before fails-on-head", () => {
  const h = rep([spec("x @udd-20", "failed")]);
  assert.equal(redFirstVerdict(rep([]), h, "@udd-20").reason, "base-missing");
});
test("#1 does not match #12 / #100 (titles and tags)", () => {
  const h = rep([spec("a @udd-12", "passed"), spec("b @udd-100", "passed"), spec("c", "passed", ["udd-12"])]);
  assert.equal(redFirstVerdict(h, h, "@udd-1").reason, "no-tagged-test");
  assert.equal(redFirstVerdict(h, h, "udd-1").reason, "no-tagged-test");
  const h1 = rep([spec("a @udd-1", "passed"), spec("b @udd-12", "passed")]);
  const b1 = rep([spec("a @udd-1", "failed"), spec("b @udd-12", "passed")]);
  assert.deepEqual(redFirstVerdict(b1, h1, "@udd-1").tests, ["a @udd-1"]);
  assert.equal(redFirstVerdict(b1, h1, "udd-1").reason, "ok");
});
test("tagRegex has the same boundary", () => {
  const re = new RegExp(tagRegex("@udd-1"));
  assert.equal(tagRegex("udd-1"), "@udd-1(?![0-9])");
  assert.ok(re.test("x @udd-1"));
  assert.ok(re.test("x @udd-1 y"));
  assert.ok(!re.test("x @udd-12"));
  assert.ok(!re.test("x @udd-100"));
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
