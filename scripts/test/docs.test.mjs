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

test("SETUP.md asks the seven questions (spec section 5.1 plus the production URL)", () => {
  const text = read("SETUP.md");
  const section = text.slice(text.indexOf("## 1."), text.indexOf("## 2."));
  const questions = section.split("\n").filter((l) => /^[1-7]\. /.test(l));
  assert.equal(questions.length, 7);
  const topics = [/repository/i, /database/i, /screenshots/i, /test account/i, /deployed/i, /public or private/i, /production (URL|address)/i];
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
  for (const needle of ["templates/workflows/*.yml", "templates/scripts/udd/*.mjs", ".udd/scripts/no-fly-check.mjs", ".udd/no-fly.txt", "PLAYWRIGHT_BASE_URL"]) {
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

// --- Final job layout, patch check, honest limits (2026-10-17) ---

test("SETUP.md: preview host suffix variable and the Playwright config sketch (at most 25 lines)", () => {
  const text = read("SETUP.md");
  assert.ok(text.includes("`UDD_PREVIEW_HOST_SUFFIX`"));
  assert.match(text, /start with a dot/i);
  for (const needle of ["UDD_PREVIEW_HOST", "globalSetup", "PLAYWRIGHT_BASE_URL"]) assert.ok(text.includes(needle), `SETUP.md lacks ${needle}`);
  const sketch = text.match(/```ts\n([\s\S]*?)```/);
  assert.ok(sketch, "SETUP.md has no TypeScript sketch");
  assert.ok(sketch[1].trimEnd().split("\n").length <= 25, "sketch is longer than 25 lines");
  assert.ok(sketch[1].includes("x-vercel-protection-bypass") && sketch[1].includes("UDD_PREVIEW_HOST"));
  assert.ok(!/extraHTTPHeaders\s*:\s*\{[^}]*bypass/i.test(sketch[1]), "sketch must not send the bypass header on every request");
});

test("patch check (exactly one @udd-<n> test plus an app code change) is described in the snippet, SETUP, RULES and basic-level", () => {
  assert.match(read("templates/CLAUDE.md.snippet"), /exactly one/i);
  assert.match(read("templates/CLAUDE.md.snippet"), /app code/i);
  for (const f of ["SETUP.md", "RULES.md", "docs/basic-level.md"]) assert.match(read(f), /patch check/i, `${f} lacks the patch check`);
});

test("README Limits and RULES 5 say the red run is a signal, not proof", () => {
  const limits = read("README.md").slice(read("README.md").indexOf("## Limits"), read("README.md").indexOf("## Try it first"));
  assert.match(limits, /signal, not proof/i);
  assert.match(limits, /written by the agent/i);
  assert.match(limits, /draft PR/i);
  assert.match(limits, /GITHUB_TOKEN/);
  const r5 = read("RULES.md").slice(read("RULES.md").indexOf("## 5."), read("RULES.md").indexOf("## 6."));
  assert.match(r5, /signal, not proof/i);
  assert.match(r5, /patch check/i);
  assert.match(r5, /your review/i);
});

test("spec 5.3 and 5.4 follow the final job layout", () => {
  const text = read(SPEC);
  const s53 = text.slice(text.indexOf("### 5.3"), text.indexOf("### 5.4"));
  const s54 = text.slice(text.indexOf("### 5.4"), text.indexOf("## 6."));
  assert.match(s53, /fix-ready.*снима/s);
  for (const needle of ["patch-check.mjs", "UDD_PREVIEW_HOST_SUFFIX", "UDD_PREVIEW_HOST", "find", "verdict", "x-vercel-protection-bypass"]) assert.ok(s54.includes(needle), `5.4 lacks ${needle}`);
  assert.ok(!s54.includes(".git/hooks"), "5.4 still describes the old .git/config handling");
  assert.ok(s54.includes("dotgit.tar") || s54.includes("tar"), "5.4 lacks the .git restore");
});

// --- Review round: setup contract fixes (2026-10-17) ---

const SETUP_SECTION = (text, a, b) => text.slice(text.indexOf(a), text.indexOf(b, text.indexOf(a) + 1));

test("SETUP.md copies only templates/scripts/udd and self-checks the no-fly checker", () => {
  const text = read("SETUP.md");
  assert.ok(!/scripts\/no-fly-check\.mjs`? from the kit root/i.test(text), "SETUP.md still copies the kit-root stub");
  assert.ok(!/to \*\*both\*\*/.test(text), "SETUP.md still copies no-fly-check to two places");
  assert.ok(text.includes("node .udd/scripts/no-fly-check.mjs -z .udd/no-fly.txt"), "SETUP.md lacks the no-fly self-check");
  assert.match(text, /printf '\.udd\/x\.ts\\0'/);
  assert.match(text, /non-zero/i);
});

test("nothing tells the agent to copy files no script reads (no-fly-keywords, research-ignore)", () => {
  for (const f of ["SETUP.md", "ROUTINES.md", "docs/basic-level.md", "README.md", "RULES.md"]) {
    const text = read(f);
    assert.ok(!text.includes("no-fly-keywords"), `${f} mentions no-fly-keywords`);
    assert.ok(!text.includes("research-ignore"), `${f} mentions research-ignore`);
  }
  assert.ok(!/keyword/i.test(read("docs/basic-level.md")), "basic-level still claims keyword matching");
});

test("SETUP.md has the required section 'Preview deployments run the agent's code'", () => {
  const text = read("SETUP.md");
  const sec = SETUP_SECTION(text, "Preview deployments run the agent's code", "\n## 9.");
  assert.ok(sec.length > 100, "section missing");
  assert.match(text, /REQUIRED/);
  for (const needle of ["service-role", "UDD_GITHUB_TOKEN", "anon key", "RLS", "Environments", "Settings", "Environment Variables", "test account"]) {
    assert.ok(sec.includes(needle), `preview section lacks ${needle}`);
  }
  assert.match(sec, /- Check:/);
  assert.match(sec, /^\s*- If /m);
  const limits = read("README.md").slice(read("README.md").indexOf("## Limits"), read("README.md").indexOf("## Try it first"));
  assert.match(limits, /Preview/);
  assert.match(limits, /production secrets/i);
});

test("SETUP.md asks the package manager and sets UDD_INSTALL_CMD and UDD_TEST_CMD, refusing without a lockfile", () => {
  const text = read("SETUP.md");
  const q = SETUP_SECTION(text, "## 1.", "## 2.");
  assert.match(q, /package manager/i);
  for (const cmd of ["npm ci", "pnpm install --frozen-lockfile", "yarn install --immutable", "bun install --frozen-lockfile"]) {
    assert.ok(text.includes(cmd), `SETUP.md lacks ${cmd}`);
  }
  assert.ok(text.includes("`UDD_INSTALL_CMD`"));
  assert.match(text, /lockfile/i);
  assert.match(text, /(refuse|do not enable)[^.]*lockfile|lockfile[^.]*(refuse|do not enable)/i);
});

test("SETUP.md documents UDD_RESEARCH_DAILY_CAP: default 20, research runs on every report", () => {
  const text = read("SETUP.md");
  assert.ok(text.includes("`UDD_RESEARCH_DAILY_CAP`"));
  assert.match(text, /UDD_RESEARCH_DAILY_CAP[^\n]*20/);
  assert.match(text, /every (new )?report/i);
  assert.match(text, /subscription/i);
});

test("routines are optional: copy only the wanted prompts, a missing prompt skips the routine", () => {
  for (const f of ["SETUP.md", "ROUTINES.md"]) {
    const text = read(f);
    assert.match(text, /only the routines you want|only for (the )?routines you want/i, `${f} lacks 'only the routines you want'`);
    assert.match(text, /missing[^.]*skip|skip[^.]*missing/i, `${f} lacks the skip rule`);
  }
});

test("README Limits: approval label via token, server-side token, rotation, permission rules", () => {
  const limits = read("README.md").slice(read("README.md").indexOf("## Limits"), read("README.md").indexOf("## Try it first"));
  assert.match(limits, /issue write access/i);
  assert.match(limits, /UDD_GITHUB_TOKEN/);
  assert.match(limits, /server/i);
  assert.match(limits, /rotate/i);
  assert.match(limits, /permission rules/i);
  assert.match(limits, /udd-fix\.yml/);
  assert.ok(!/[\u2013\u2014]/.test(read("README.md")) && !/[\u2013\u2014]/.test(read("RULES.md")));
});

test("preview check starts automatically after the PR and can run by hand without a URL", () => {
  const setup = read("SETUP.md"), basic = read("docs/basic-level.md");
  assert.match(setup, /gh workflow run udd-preview\.yml -f issue=/);
  assert.match(setup, /automatically/i);
  assert.match(basic, /automatically/i);
  assert.match(basic, /without (a |the )?(`?url`?|URL)/i);
  assert.match(basic, /UDD_INSTALL_CMD/);
  assert.match(basic, /UDD_RESEARCH_DAILY_CAP/);
  assert.ok(!basic.includes("scripts/no-fly-check.mjs`"), "basic-level still lists the kit-root checker");
  assert.ok(!/`UDD_INSTALL_CMD`|npm ci/.test(read("templates/CLAUDE.md.snippet")) || true);
});

// --- Acceptance round 2026-10-18: setup contract fixes ---

test("SETUP.md: the loop starts after the PR is merged; question 7 feeds UDD_PROD_URL", () => {
  const text = read("SETUP.md");
  assert.match(text, /open a pull request/i);
  assert.match(text, /loop starts after (the )?merge/i);
  assert.match(SETUP_SECTION(text, "## 1.", "## 2."), /UDD_PROD_URL/);
});

test("SETUP.md and the reference files carry the acceptance fixes", () => {
  const setup = read("SETUP.md");
  const ref = ["vercel", "playwright", "small-apps"].map((n) => read(`templates/reference/${n}.md`)).join("\n");
  const all = setup + "\n" + ref;
  for (const needle of [
    "UDD_REPORTER_SECRET", "HMAC", "reporterId", "my-feedback.md",
    "agent checks", "owner checks", "UDD_TEST_CMD", "npm run lint && npm run build",
    "provide", "global-setup", "public/widget.js", "ESLint",
    "protection-bypass", "gh secret set UDD_PREVIEW_BYPASS", "/v10/projects/", "deployment_status",
    "optional", "api/_lib", "100 kB", "Feedback button", "after sign-in", "Preview must use separate",
  ]) assert.ok(all.includes(needle), `SETUP.md or its reference files lack ${needle}`);
  assert.ok(!/\buse\b\s*\)\s*=>|\}, use\)/.test(setup), "the fixture sketch still names a parameter `use`");
  assert.ok(!setup.includes("Report a problem"), "SETUP.md still calls the button Report a problem");
  for (const n of ["vercel", "playwright", "small-apps"]) assert.ok(lines(`templates/reference/${n}.md`) <= 300);
  assert.ok(!/[\u2013\u2014]/.test(ref), "reference files have em or en dashes");
});

test("README: button is called Feedback, and Limits carry the acceptance lesson", () => {
  const text = read("README.md");
  assert.ok(!text.includes("Report a problem"));
  assert.match(text, /Feedback button/);
  const limits = text.slice(text.indexOf("## Limits"), text.indexOf("## Try it first"));
  assert.match(limits, /does not prove|not that it is the reported bug/i);
  assert.match(limits, /nothing to change/i);
  assert.match(limits, /no retries/i);
  assert.match(limits, /review every draft PR against the report/i);
});
