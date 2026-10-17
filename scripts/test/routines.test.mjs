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

const jobNames = [...wf.matchAll(/^  ([a-z][\w-]*):\n/gm)].map((m) => m[1]);
const stepsOf = (job) => jobBlock(job).split(/^      - /m).slice(1);

test("workflow: template and .github copy are byte-identical", () => {
  assert.equal(readFileSync(".github/workflows/udd-routine.yml", "utf8"), wf);
});
test("isolation: a job with model secrets never runs project code, tests or lifecycle scripts", () => {
  for (const name of jobNames) {
    const job = jobBlock(name);
    if (!/secrets\./.test(job)) continue;
    assert.doesNotMatch(job, /UDD_TEST_CMD/, `${name} runs project tests next to a secret`);
    assert.doesNotMatch(job, /npm (ci|install|audit|test|run)\b(?![^\n]*--ignore-scripts)/, `${name} runs npm next to a secret`);
    assert.doesNotMatch(job, /cache: npm/, `${name} has a cache next to a secret`);
  }
  assert.ok(jobNames.some((n) => /secrets\./.test(jobBlock(n))), "some job holds the model token");
});
test("isolation: the test job has no secrets, no cache, read-only token, no stored credentials", () => {
  const t = jobBlock("verify");
  assert.match(t, /UDD_TEST_CMD/);
  assert.doesNotMatch(t, /secrets\./);
  assert.doesNotMatch(t, /cache:/);
  assert.match(t, /contents: read/);
  assert.doesNotMatch(t, /: write/);
  assert.match(t, /persist-credentials: false/);
  assert.match(t, /sha256sum/);
  for (const [name, job] of jobNames.map((n) => [n, jobBlock(n)])) {
    if (name !== "verify") assert.doesNotMatch(job, /UDD_TEST_CMD/, `${name} must not run project tests`);
  }
});
test("isolation: npm audit runs in a job without secrets; the agent only receives its JSON", () => {
  const audit = jobBlock("audit");
  assert.match(audit, /npm audit --json/);
  assert.doesNotMatch(audit, /secrets\./);
  assert.doesNotMatch(audit, /cache:/);
  assert.match(audit, /persist-credentials: false/);
  assert.doesNotMatch(jobBlock("agent"), /npm audit/);
  assert.match(jobBlock("agent"), /udd-audit\.json/);
});
test("integrity: the agent job uploads its result first and records the sha256 as a job output", () => {
  const agent = jobBlock("agent");
  assert.match(agent, /outputs:\n(?:\s+sha-[\w-]+: .*\n){3}/);
  assert.match(agent, /sha256sum/);
  const steps = stepsOf("agent");
  const save = steps.findIndex((s) => /sha256sum/.test(s));
  const upload = steps.findIndex((s) => /upload-artifact/.test(s));
  const agentStep = steps.findIndex((s) => /claude-code-action/.test(s));
  assert.ok(agentStep < save && save < upload, "agent, then save+hash, then upload");
  assert.equal(upload, steps.length - 1, "nothing runs after the upload");
  assert.match(steps[save], /gitconfig/, "git config is restored before git touches agent-written files");
});
test("integrity: every consumer verifies the sha256 from the agent job output", () => {
  for (const name of ["verify", "publish-pr", "publish-security"]) {
    const job = jobBlock(name);
    assert.match(job, /sha256sum/, `${name} hashes the artifact`);
    assert.match(job, /needs\.agent\.outputs\[(format\('sha-\{0\}'|'sha-)/, `${name} reads the recorded hash`);
  }
});
test("publish-pr: trusted scripts from the base commit, NUL-separated file list", () => {
  const pr = jobBlock("publish-pr");
  const steps = stepsOf("publish-pr");
  const keep = steps.findIndex((s) => /trusted copy/i.test(s));
  const apply = steps.findIndex((s) => /git apply/.test(s));
  assert.ok(keep >= 0 && keep < apply, "trusted copy is taken before the patch is applied");
  assert.match(pr, /git -c core\.quotePath=false diff --cached --name-only -z --no-renames/);
  assert.match(pr, /no-fly-check\.mjs" -z /);
  assert.doesNotMatch(pr, /node \.udd\//, "publish-pr runs no script from the patched tree");
});
test("security: at most one issue per run, titled with the run date, one checklist", () => {
  const sec = jobBlock("publish-security");
  assert.equal((sec.match(/gh issue create/g) ?? []).length, 1);
  assert.ok(sec.indexOf("gh issue create") > sec.lastIndexOf("done"), "gh issue create is after the loop, not inside it");
  assert.match(sec, /Security check \$/);
  assert.match(sec, /- \[ \]/);
  assert.match(sec, /--label security --label routine --label routine:security/);
  assert.match(sec, /private == 'true'/);
});
test("ROUTINES.md: token limits, one security issue, advisories need an App token", () => {
  const text = readFileSync("ROUTINES.md", "utf8");
  assert.match(text, /GITHUB_TOKEN/);
  assert.match(text, /Repository security advisories: write/);
  assert.match(text, /docs\.github\.com\/en\/actions\/concepts\/security\/github_token/);
  assert.match(text, /WEEKLY\.md/);
  assert.match(text, /do not trigger/i);
  assert.match(text, /Security check/);
  assert.doesNotMatch(text, /one issue per new finding/);
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
