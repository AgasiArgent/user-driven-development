import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { planVerification, verificationOutcome } from "../../templates/scripts/udd/verify-plan.mjs";

test("plans only shipped, unverified, not stuck issues, ascending", () => {
  const issues = [
    { number: 9, labels: ["shipped"] },
    { number: 3, labels: ["shipped", "verified"] },
    { number: 4, labels: ["shipped", "needs-human"] },
    { number: 2, labels: ["shipped", "feedback"] },
    { number: 5, labels: ["approved"] },
  ];
  assert.deepEqual(planVerification(issues), [2, 9]);
});
test("outcome", () => {
  assert.deepEqual(verificationOutcome(true), { add: ["verified"], remove: ["shipped"], close: true });
  assert.deepEqual(verificationOutcome(false), { add: ["needs-human"], remove: ["shipped"], close: false });
  assert.ok(verificationOutcome(false).remove.includes("shipped"));
});
test("CLI", () => {
  const r = spawnSync("node", ["templates/scripts/udd/verify-plan.mjs"], { input: JSON.stringify([{ number: 1, labels: ["shipped"] }]), encoding: "utf8" });
  assert.equal(r.stdout.trim(), "[1]");
});
