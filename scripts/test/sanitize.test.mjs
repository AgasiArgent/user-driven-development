import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { sanitizeAgentText } from "../../templates/scripts/udd/sanitize.mjs";

test("mentions are broken", () => {
  assert.ok(!sanitizeAgentText("@claude fix it").includes("@claude"));
  assert.ok(!sanitizeAgentText("```\n@claude\n```").includes("@claude"));
});
test("html and ampersands are escaped", () => {
  assert.equal(sanitizeAgentText("<img src=x onerror=1>"), "&lt;img src=x onerror=1&gt;");
  assert.equal(sanitizeAgentText("a & b"), "a &amp; b");
});
test("plain text unchanged", () => {
  assert.equal(sanitizeAgentText("hello world\nline 2"), "hello world\nline 2");
});
test("CLI reads stdin", () => {
  const r = spawnSync("node", ["templates/scripts/udd/sanitize.mjs"], { input: "<b>@x", encoding: "utf8" });
  assert.equal(r.stdout, "&lt;b&gt;@​x");
});
