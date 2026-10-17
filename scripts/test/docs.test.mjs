import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
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

// --- Review fixes: setup contract details ---

test("SETUP.md names UDD_GITHUB_TOKEN and the 201 intake answer, and never uses $TMPDIR", () => {
  const text = read("SETUP.md");
  assert.ok(text.includes("`UDD_GITHUB_TOKEN`"), "SETUP.md lacks UDD_GITHUB_TOKEN");
  assert.match(text, /\b201\b/);
  assert.ok(!text.includes("$TMPDIR"), "SETUP.md still uses $TMPDIR");
  assert.ok(!/\b202\b/.test(text), "SETUP.md still mentions 202");
  assert.ok(text.includes("mktemp -d"), "SETUP.md does not use mktemp -d");
  assert.ok(text.includes("npm run build -w widget"), "SETUP.md lacks the widget build command");
  assert.ok(text.includes("templates/no-fly.txt"), "SETUP.md lacks the no-fly template path");
  assert.match(text, /GITHUB_TOKEN/);
  assert.match(text, /public issue/i);
});

test("README states the spec section 10 numbers in its wording", () => {
  const text = read("README.md");
  assert.ok(text.includes("the loop itself brought 121 of 479 issues to completion over 14 weeks"));
  assert.ok(text.includes("12 days of downtime with no errors"));
  assert.ok(text.includes("467 of 529"));
  assert.match(text, /Limits/);
  assert.match(text, /public issue/i);
  assert.ok(!/[–—]/.test(text), "README has em or en dashes");
});

// --- Red on production, green on preview (2026-10-17) ---

const SPEC = "docs/superpowers/specs/2026-10-17-vibecoder-kit-design.md";

/** Every vars.X / secrets.X the committed workflows reference. */
function workflowNames() {
  const dir = "templates/workflows";
  const out = new Set();
  for (const f of readdirSync(join(root, dir)).filter((n) => n.endsWith(".yml"))) {
    for (const m of read(`${dir}/${f}`).matchAll(/\$\{\{\s*(?:vars|secrets)\.([A-Za-z0-9_]+)/g)) out.add(m[1]);
  }
  return [...out].sort();
}

test("SETUP.md names every variable and secret the workflows reference", () => {
  const names = workflowNames();
  assert.ok(names.includes("UDD_PREVIEW_BYPASS") && names.includes("UDD_PROD_URL"), "parser found too little");
  const text = read("SETUP.md");
  for (const n of names) assert.ok(text.includes(`\`${n}\``), `SETUP.md does not mention ${n}`);
});

test("SETUP.md covers the preview check: config, bypass, hosts and the test-account risk", () => {
  const text = read("SETUP.md");
  for (const needle of ["storageState", "x-vercel-protection-bypass", "Protection Bypass for Automation", "workflow_dispatch", "udd-preview.yml", "no-fly"]) {
    assert.ok(text.includes(needle), `SETUP.md lacks ${needle}`);
  }
  assert.match(text, /playwright\.config[\s\S]{0,200}(cannot|never) change/i);
  assert.match(text, /no real data/i);
  assert.match(text, /no admin/i);
  assert.match(text, /five `?udd-\*\.yml|five workflow/i);
  assert.ok(!/four `?udd-/i.test(text), "SETUP.md still says four workflows");
});

test("CLAUDE.md.snippet: one tagged test, red on production today, green after the fix, test account data only", () => {
  const text = read("templates/CLAUDE.md.snippet");
  assert.match(text, /fails on production/i);
  assert.match(text, /one Playwright test/i);
  assert.match(text, /test account/i);
});

test("README, RULES and basic-level describe red-first as fail on the live site, pass on the preview", () => {
  for (const f of ["README.md", "RULES.md"]) {
    const text = read(f);
    assert.match(text, /fail on the live site first and pass on the preview/i, `${f} lacks the plain red-first wording`);
    assert.ok(!/[–—]/.test(text), `${f} has em or en dashes`);
  }
  assert.ok(read("docs/basic-level.md").includes("udd-preview.yml"));
  assert.match(read("README.md"), /Four GitHub workflows|four GitHub workflows/);
  assert.match(read("RULES.md"), /preview/i);
});

test("spec: decision in section 2, preview step in 5.4 and 9", () => {
  const text = read(SPEC);
  const sec = (a, b) => text.slice(text.indexOf(a), text.indexOf(b));
  assert.match(sec("## 2.", "## 3."), /red on production, green on preview/i);
  assert.ok(sec("## 2.", "## 3.").includes("2026-10-17"));
  const s54 = sec("### 5.4", "## 6.");
  for (const needle of ["udd-preview.yml", "UDD_PROD_URL", "red-first.mjs", "sha256", "UDD_PREVIEW_BYPASS"]) assert.ok(s54.includes(needle), `5.4 lacks ${needle}`);
  assert.match(sec("## 9.", "## 10."), /udd-preview\.yml|preview/i);
  assert.ok(text.split("\n").length <= 300);
});
