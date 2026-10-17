import assert from "node:assert/strict";
import { test } from "node:test";
import { findViolations, parsePatterns } from "../../templates/scripts/udd/no-fly-check.mjs";

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

// ---- -z mode, fail-closed input handling, default patterns ----
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(root, "templates", "scripts", "udd", "no-fly-check.mjs");
const dir = mkdtempSync(join(tmpdir(), "nofly-"));
const listFile = join(dir, "list.txt");
writeFileSync(listFile, "e2e/**\n");
const run = (args, input) => spawnSync("node", [cli, ...args], { input, encoding: "utf8" });

test("-z: non-ASCII path under a protected pattern is caught", () => {
  const r = run(["-z", listFile], "src/ok.ts\0e2e/тест.spec.ts\0");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /e2e\/тест\.spec\.ts/);
});

test("-z: a path containing a newline is handled as one path", () => {
  const r = run(["-z", listFile], "e2e/a\nb.ts\0");
  assert.equal(r.status, 1);
});

test("-z: clean paths pass", () => {
  const r = run(["-z", listFile], "src/a.ts\0src/б.ts\0");
  assert.equal(r.status, 0);
});

test("-z: git-quoted path fails closed", () => {
  const r = run(["-z", listFile], '"e2e/\\321\\202.ts"\0');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /quoted/i);
});

test("newline mode: git-quoted path fails closed", () => {
  const r = run([listFile], '"e2e/\\321\\202.ts"\n');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /quoted/i);
});

test("newline mode still flags and passes as before", () => {
  assert.equal(run([listFile], "e2e/a.ts\n").status, 1);
  assert.equal(run([listFile], "src/a.ts\n").status, 0);
});

test("unreadable pattern list fails closed", () => {
  const r = run(["-z", join(dir, "missing.txt")], "a\0");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /pattern/i);
});

test("empty pattern list fails closed", () => {
  const empty = join(dir, "empty.txt");
  writeFileSync(empty, "# only a comment\n");
  const r = run(["-z", empty], "a\0");
  assert.notEqual(r.status, 0);
});

const samples = {
  "**/playwright.config.*": ["playwright.config.ts", "app/playwright.config.mjs"],
  "**/global-setup.*": ["e2e/global-setup.ts"],
  "**/global-teardown.*": ["e2e/global-teardown.js"],
  "**/tsconfig*.json": ["tsconfig.json", "app/tsconfig.build.json"],
  ".github/**": [".github/workflows/ci.yml"],
  ".udd/**": [".udd/no-fly.txt"],
};
for (const file of ["templates/no-fly.txt", ".udd/no-fly.txt"]) {
  test(`${file} contains every default pattern and matches samples`, () => {
    const pats = parsePatterns(readFileSync(join(root, file), "utf8"));
    for (const [pat, paths] of Object.entries(samples)) {
      assert.ok(pats.includes(pat), `${file} lacks ${pat}`);
      assert.deepEqual(findViolations([pat], paths), paths);
    }
    assert.deepEqual(findViolations(pats, ["src/app/page.tsx"]), []);
  });
}

test("templates/no-fly.txt is covered by .udd/no-fly.txt (superset)", () => {
  const t = parsePatterns(readFileSync(join(root, "templates/no-fly.txt"), "utf8"));
  const u = new Set(parsePatterns(readFileSync(join(root, ".udd/no-fly.txt"), "utf8")));
  assert.deepEqual(t.filter((p) => !u.has(p)), []);
});

test("scripts/no-fly-check.mjs re-exports the canonical kit module", async () => {
  const legacy = await import("../no-fly-check.mjs");
  const canonical = await import("../../templates/scripts/udd/no-fly-check.mjs");
  assert.equal(legacy.findViolations, canonical.findViolations);
  assert.equal(legacy.parsePatterns, canonical.parsePatterns);
  assert.equal(legacy.parseFileList, canonical.parseFileList);
});
