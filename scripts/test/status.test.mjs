import assert from "node:assert/strict";
import { test } from "node:test";
import { LABELS, LABEL_COLORS, statusFromIssue } from "../../templates/scripts/udd/status.mjs";

const s = (labels, state = "open", stateReason = null) => statusFromIssue({ labels, state, stateReason });

test("priority map", () => {
  assert.deepEqual(s([], "closed", "not_planned"), { key: "declined", text: "Declined" });
  assert.equal(s(["verified"]).text, "Verified in production");
  assert.equal(s(["needs-human"]).text, "Waiting for the developer");
  assert.equal(s(["shipped"]).text, "Shipped");
  assert.equal(s(["fix-ready"]).text, "Fix ready");
  assert.equal(s(["in-progress"]).text, "In progress");
  assert.equal(s(["approved"]).text, "Approved");
  assert.equal(s(["researched"]).text, "Looked into");
  assert.deepEqual(s(["feedback"]), { key: "received", text: "Received" });
});

test("combinations", () => {
  assert.equal(s(["shipped", "verified"]).key, "verified");
  assert.equal(s(["in-progress", "needs-human"]).key, "needs-human");
  assert.equal(s([], "closed", "completed").text, "Shipped");
});

test("labels", () => {
  assert.equal(LABELS.length, 8);
  assert.equal(Object.keys(LABEL_COLORS).length, 13);
  for (const c of Object.values(LABEL_COLORS)) assert.match(c, /^[0-9a-f]{6}$/);
});
