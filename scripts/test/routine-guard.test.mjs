import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { filterKnown, shouldRun } from "../../templates/scripts/udd/routine-guard.mjs";

test("shouldRun", () => {
  assert.equal(shouldRun("security", [{ labels: ["routine", "routine:security"] }]), false);
  assert.equal(shouldRun("security", [{ labels: ["routine:dead-code"] }]), true);
  assert.equal(shouldRun("security", []), true);
});
test("filterKnown keeps order", () => {
  const f = [{ key: "a" }, { key: "b" }, { key: "c" }];
  assert.deepEqual(filterKnown(f, [{ key: "b", reason: "x", date: "2026-10-17" }]), [{ key: "a" }, { key: "c" }]);
});
test("CLI", () => {
  const r = spawnSync("node", ["templates/scripts/udd/routine-guard.mjs", "filter"], { input: JSON.stringify({ findings: [{ key: "a" }], known: [{ key: "a" }] }), encoding: "utf8" });
  assert.equal(r.stdout.trim(), "[]");
  const s = spawnSync("node", ["templates/scripts/udd/routine-guard.mjs"], { input: JSON.stringify({ routine: "x", openItems: [] }), encoding: "utf8" });
  assert.equal(s.stdout.trim(), "true");
});
