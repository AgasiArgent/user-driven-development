import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
const lines = (p) => read(p).split("\n").length - (read(p).endsWith("\n") ? 1 : 0);

const AGENT_FILES = ["SETUP.md", "WEEKLY.md", "ROUTINES.md"];
const PATH_PREFIXES = ["templates/", "widget/", "delivery/", "demo/"];

const LABELS = [
  "feedback", "researched", "approved", "in-progress", "fix-ready", "shipped", "verified",
  "needs-human", "routine", "routine:dead-code", "routine:duplicates", "routine:security", "security",
];
const VARIABLES = ["UDD_AGENT_ENABLED", "UDD_TEST_CMD", "UDD_E2E_CMD", "UDD_TEST_GLOB", "UDD_PROD_URL"];
const SECRETS = ["CLAUDE_CODE_OAUTH_TOKEN", "UDD_TEST_USER_EMAIL", "UDD_TEST_USER_PASSWORD"];

/** Every backticked token that looks like a path into the kit's own folders. */
function kitPaths(text) {
  const out = new Set();
  for (const m of text.matchAll(/`([^`\s]+)`/g)) {
    const t = m[1].replace(/[.,:;]+$/, "");
    if (PATH_PREFIXES.some((p) => t.startsWith(p)) && !/[*<>{}$]/.test(t)) out.add(t);
  }
  return [...out];
}

for (const f of AGENT_FILES) {
  test(`${f} is at most 300 lines`, () => {
    assert.ok(lines(f) <= 300, `${f} has ${lines(f)} lines`);
  });
  test(`${f}: every kit path in backticks exists`, () => {
    for (const p of kitPaths(read(f))) assert.ok(existsSync(join(root, p)), `${f} mentions ${p}, which does not exist`);
  });
}

test("SETUP.md names all 13 labels, all variables and all secrets", () => {
  const text = read("SETUP.md");
  for (const name of [...LABELS, ...VARIABLES, ...SECRETS]) {
    assert.ok(text.includes(`\`${name}\``), `SETUP.md does not mention ${name}`);
  }
});

test("SETUP.md asks the six questions of the spec (section 5.1)", () => {
  const text = read("SETUP.md");
  const section = text.slice(text.indexOf("## 1."), text.indexOf("## 2."));
  const questions = section.split("\n").filter((l) => /^[1-6]\. /.test(l));
  assert.equal(questions.length, 6);
  const topics = [/repository/i, /database/i, /screenshots/i, /test account/i, /deployed/i, /public or private/i];
  topics.forEach((re, i) => assert.match(questions[i], re, `question ${i + 1}`));
});

test("every SETUP.md step has a check and a failure path", () => {
  const text = read("SETUP.md");
  const sections = text.split(/^## /m).slice(1).filter((s) => /^\d+\./.test(s));
  assert.ok(sections.length >= 9);
  for (const s of sections) {
    const title = s.split("\n")[0];
    assert.match(s, /- Check:/, `section "${title}" has no check`);
    assert.match(s, /^\s*- If /m, `section "${title}" has no failure path`);
  }
});

test("SETUP.md copies the files the workflows call by their exact paths", () => {
  const text = read("SETUP.md");
  for (const needle of ["templates/workflows/*.yml", "templates/scripts/udd/*.mjs", "scripts/no-fly-check.mjs", ".udd/scripts/no-fly-check.mjs", ".udd/no-fly.txt", "PLAYWRIGHT_BASE_URL"]) {
    assert.ok(text.includes(needle), `SETUP.md does not mention ${needle}`);
  }
});

test("CLAUDE.md.snippet carries the cycle rules", () => {
  const text = read("templates/CLAUDE.md.snippet");
  assert.match(text, /@udd-<issue number>/);
  assert.match(text, /untrusted/i);
  assert.match(text, /test account/i);
  assert.match(text, /\.udd\/no-fly\.txt/);
});

test("WEEKLY.md covers the five steps and the public-repository rule", () => {
  const text = read("WEEKLY.md");
  for (const label of ["needs-human", "approved", "routine", "fix-ready"]) assert.ok(text.includes(label), `WEEKLY.md lacks ${label}`);
  assert.match(text, /terminal only/i);
  assert.equal((text.match(/^## \d\./gm) ?? []).length, 5);
});

// --- Task 9 content: RULES.md and README ---

test("RULES.md has 15 rules, each with Rule, Why and Enforced by", () => {
  assert.ok(existsSync(join(root, "RULES.md")), "RULES.md is missing");
  const text = read("RULES.md");
  for (const key of ["Rule", "Why", "Enforced by"]) {
    assert.equal((text.match(new RegExp(`^\\s*(?:[-*]\\s+)?\\*\\*${key}:\\*\\*`, "gm")) ?? []).length, 15, `expected 15 **${key}:** lines`);
  }
});

test("RULES.md: every file named in Enforced by exists", () => {
  assert.ok(existsSync(join(root, "RULES.md")), "RULES.md is missing");
  const enforced = read("RULES.md").split("\n").filter((l) => /\*\*Enforced by:\*\*/.test(l));
  assert.equal(enforced.length, 15);
  for (const line of enforced) {
    const files = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter((t) => /[/.]/.test(t) && !/[*<>{}\s]/.test(t) && /\.\w+$|\/$/.test(t));
    assert.ok(files.length > 0, `no file in: ${line}`);
    for (const f of files) assert.ok(existsSync(join(root, f)), `Enforced by names ${f}, which does not exist`);
  }
});

test("README has the paste phrase word for word and links the four agent and rule files", () => {
  const text = read("README.md");
  assert.ok(
    text.includes("Read https://github.com/AgasiArgent/user-driven-development/blob/main/SETUP.md and set it up in this app."),
    "README lacks the paste phrase",
  );
  for (const f of ["SETUP.md", "RULES.md", "WEEKLY.md", "ROUTINES.md"]) {
    assert.match(text, new RegExp(`\\]\\((?:\\./)?${f.replace(".", "\\.")}\\)`), `README has no link to ${f}`);
  }
});
