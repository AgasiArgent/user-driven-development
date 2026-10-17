import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";

const wf = readFileSync("templates/workflows/udd-routine.yml", "utf8");
const jobBlock = (name) => {
  const m = wf.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][\\w-]*:\\n|(?![\\s\\S]))`, "m"));
  assert.ok(m, `job ${name} exists`);
  return m[1];
};

test("workflow: weekly schedule + manual run", () => {
  assert.match(wf, /^\s+schedule:\n\s+- cron: "[^"]+"/m);
  assert.match(wf, /workflow_dispatch:/);
});
test("workflow: matrix over the three routines", () => {
  assert.match(wf, /routine:\s*\[dead-code, duplicates, security\]/);
});
test("workflow: guard calls routine-guard.mjs and publish filters known findings", () => {
  assert.match(wf, /\.udd\/scripts\/routine-guard\.mjs/);
  assert.match(wf, /routine-guard\.mjs filter/);
  assert.match(wf, /\.udd\/known-findings\.json/);
});
test("workflow: agent job is read-only and runs no shell", () => {
  const agent = jobBlock("agent");
  assert.match(agent, /contents: read/);
  assert.doesNotMatch(agent, /contents: write|pull-requests: write/);
  assert.match(agent, /persist-credentials: false/);
  assert.doesNotMatch(agent, /allowedTools[^\n]*Bash/);
});
test("workflow: security findings are published only for private repositories (Review Focus 5)", () => {
  const sec = jobBlock("publish-security");
  assert.match(sec, /if:[^\n]*private == 'true'/);
  assert.match(jobBlock("meta"), /\.private/);
  assert.doesNotMatch(jobBlock("publish-pr"), /routine-guard\.mjs filter/);
});
test("workflow: PR routines open drafts with routine labels and check no-fly zones", () => {
  const pr = jobBlock("publish-pr");
  assert.match(pr, /gh pr create --draft/);
  assert.match(pr, /routine:\$ROUTINE/);
  assert.match(pr, /no-fly-check\.mjs/);
});
test("workflow: agent text goes through sanitize before reaching GitHub", () => {
  assert.match(jobBlock("publish-security"), /sanitize\.mjs/);
});
test("workflow: uses the subscription token", () => {
  assert.match(wf, /claude_code_oauth_token: \$\{\{ secrets\.CLAUDE_CODE_OAUTH_TOKEN \}\}/);
});

const dir = "templates/routines";
const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
test("three routine prompts exist", () => {
  assert.deepEqual(files.sort(), ["dead-code.md", "duplicates.md", "security.md"]);
});
for (const f of files) {
  test(`routine prompt ${f}: sections and length`, () => {
    const text = readFileSync(`${dir}/${f}`, "utf8");
    for (const h of ["## Goal", "## Rules", "## Output"]) assert.ok(text.includes(h), `${f} has ${h}`);
    assert.ok(text.split("\n").length <= 120);
  });
}
test("security.md lists all seven checks", () => {
  const text = readFileSync(`${dir}/security.md`, "utf8").toLowerCase();
  for (const k of ["validates its input", "own data", "secret keys", "as html", "sql", "npm audit", "secrets in git"]) {
    assert.ok(text.includes(k), `security.md mentions ${k}`);
  }
  assert.match(text, /rotate this key/);
  assert.match(text, /findings\.json/);
});
test("ROUTINES.md is short and cites the advisory docs", () => {
  const text = readFileSync("ROUTINES.md", "utf8");
  assert.ok(text.split("\n").length <= 300);
  assert.match(text, /docs\.github\.com\/en\/rest\/security-advisories\/repository-advisories/);
  assert.match(text, /Public repositories/);
  assert.match(text, /known-findings\.json/);
  assert.match(text, /claude-code-security-review/);
});
