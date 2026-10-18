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

import { baseVerdict, headVerdict } from "../../templates/scripts/udd/red-first.mjs";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("baseVerdict: reasons and tests", () => {
  const b = (st, title = "x @udd-20") => rep([spec(title, st)]);
  assert.deepEqual(baseVerdict(b("failed"), "@udd-20"), { ok: true, reason: "ok", tests: ["x @udd-20"] });
  assert.equal(baseVerdict(b("timedOut"), "udd-20").reason, "ok");
  assert.equal(baseVerdict(b("passed"), "@udd-20").reason, "passes-on-base");
  assert.equal(baseVerdict(b("skipped"), "@udd-20").reason, "base-missing");
  assert.equal(baseVerdict(rep([spec("other", "failed")]), "@udd-20").reason, "no-tagged-test");
  assert.equal(baseVerdict(null, "@udd-20").reason, "no-tagged-test");
  assert.equal(baseVerdict(b("failed", "x @udd-200"), "@udd-20").reason, "no-tagged-test");
});
test("baseVerdict: two tagged tests -> multiple-tagged-tests", () => {
  const r = rep([spec("a @udd-20", "failed"), spec("b @udd-20", "passed")]);
  assert.equal(baseVerdict(r, "@udd-20").reason, "multiple-tagged-tests");
});
test("baseVerdict: tagged test absent but tag-like title missing -> base-missing is for combined check only", () => {
  assert.equal(baseVerdict(rep([]), "@udd-20").reason, "no-tagged-test");
});
test("headVerdict: reasons and tests", () => {
  const h = (st) => rep([spec("x @udd-20", st)]);
  assert.deepEqual(headVerdict(h("passed"), "@udd-20"), { ok: true, reason: "ok", tests: ["x @udd-20"] });
  assert.equal(headVerdict(h("failed"), "@udd-20").reason, "fails-on-head");
  assert.equal(headVerdict(h("skipped"), "@udd-20").reason, "fails-on-head");
  assert.equal(headVerdict(rep([]), "@udd-20").reason, "no-tagged-test");
  assert.equal(headVerdict(h("passed"), "@udd-2").reason, "no-tagged-test");
});
test("CLI modes: base, head, regex, old form", () => {
  const dir = mkdtempSync(join(tmpdir(), "rf-"));
  const bf = join(dir, "b.json");
  const hf = join(dir, "h.json");
  writeFileSync(bf, JSON.stringify(rep([spec("x @udd-20", "failed")])));
  writeFileSync(hf, JSON.stringify(rep([spec("x @udd-20", "passed")])));
  const run = (...a) => spawnSync("node", ["templates/scripts/udd/red-first.mjs", ...a], { encoding: "utf8" });
  let r = run("base", bf, "@udd-20");
  assert.deepEqual([r.status, r.stdout.trim()], [0, "ok"]);
  r = run("base", hf, "@udd-20");
  assert.deepEqual([r.status, r.stdout.trim()], [1, "passes-on-base"]);
  r = run("head", hf, "udd-20");
  assert.deepEqual([r.status, r.stdout.trim()], [0, "ok"]);
  r = run("head", bf, "@udd-20");
  assert.deepEqual([r.status, r.stdout.trim()], [1, "fails-on-head"]);
  r = run(bf, hf, "@udd-20");
  assert.deepEqual([r.status, r.stdout.trim()], [0, "ok"]);
  r = run("regex", "udd-1");
  assert.deepEqual([r.status, r.stdout.trim()], [0, "@udd-1(?![0-9])"]);
  r = run("base", join(dir, "missing.json"), "@udd-20");
  assert.equal(r.status, 1);
});

const inFile = (file, specs) => ({ suites: [{ title: file, file, specs: specs.map((s, i) => ({ file, line: 10 + i, ...s })) }] });
test("same title in two files is two tests -> multiple-tagged-tests", () => {
  const mk = (st) => ({ suites: [inFile("a.spec.ts", [spec("dup @udd-30", st)]).suites[0], inFile("b.spec.ts", [spec("dup @udd-30", st)]).suites[0]] });
  assert.equal(headVerdict(mk("passed"), "@udd-30").reason, "multiple-tagged-tests");
  assert.equal(baseVerdict(mk("failed"), "@udd-30").reason, "multiple-tagged-tests");
  assert.equal(redFirstVerdict(mk("failed"), mk("passed"), "@udd-30").reason, "multiple-tagged-tests");
});
test("same title twice in one file (different lines) is counted twice", () => {
  const r = inFile("a.spec.ts", [spec("dup @udd-30", "failed"), spec("dup @udd-30", "passed")]);
  assert.equal(baseVerdict(r, "@udd-30").reason, "multiple-tagged-tests");
});
test("two differently titled tagged tests -> multiple-tagged-tests", () => {
  const r = rep([spec("a @udd-31", "passed"), spec("b", "passed", ["udd-31"])]);
  assert.equal(headVerdict(r, "@udd-31").reason, "multiple-tagged-tests");
  assert.equal(redFirstVerdict(r, r, "@udd-31").reason, "multiple-tagged-tests");
});
test("multiple tagged tests on base only is also rejected", () => {
  const b = rep([spec("a @udd-32", "failed"), spec("b @udd-32", "failed")]);
  const h = rep([spec("a @udd-32", "passed")]);
  assert.equal(redFirstVerdict(b, h, "@udd-32").reason, "multiple-tagged-tests");
});
test("spec.id keys the test when present", () => {
  const r = rep([{ ...spec("same @udd-33", "passed"), id: "i1" }, { ...spec("same @udd-33", "passed"), id: "i2" }]);
  assert.equal(headVerdict(r, "@udd-33").reason, "multiple-tagged-tests");
});
