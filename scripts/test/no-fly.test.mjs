import assert from "node:assert/strict";
import { test } from "node:test";
import { findViolations, parsePatterns } from "../no-fly-check.mjs";

const patterns = parsePatterns(`
# comment
.github/**
demo/lib/feedback.ts
**/package.json
**/.env*
`);

test("ignores comments and blank lines", () => {
  assert.deepEqual(patterns, [".github/**", "demo/lib/feedback.ts", "**/package.json", "**/.env*"]);
});

test("flags files under a folder glob, exact paths, and files at any depth", () => {
  assert.deepEqual(
    findViolations(patterns, [".github/workflows/ci.yml", "demo/lib/feedback.ts", "package.json", "demo/package.json", "demo/.env.local"]),
    [".github/workflows/ci.yml", "demo/lib/feedback.ts", "package.json", "demo/package.json", "demo/.env.local"],
  );
});

test("allows ordinary application files", () => {
  assert.deepEqual(findViolations(patterns, ["demo/lib/bookings.ts", "demo/components/BookingForm.tsx", "demo/app/globals.css"]), []);
});

test("does not treat dots or similar names as wildcards", () => {
  assert.deepEqual(findViolations(patterns, ["demo/lib/feedbackXts", "demo/lib/feedback.ts.bak", ".githubx/a"]), []);
});
