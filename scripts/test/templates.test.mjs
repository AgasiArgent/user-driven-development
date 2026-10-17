import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
const list = (dir, ext) => (existsSync(join(root, dir)) ? readdirSync(join(root, dir)).filter((f) => f.endsWith(ext)) : []);

// Slice of one job (from "  <name>:" to the next two-space-indented key).
function job(text, name) {
  const m = text.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][\\w-]*:\\n|(?![\\s\\S]))`, "m"));
  assert.ok(m, `job ${name} not found`);
  return m[1];
}

test("every template workflow is byte-identical to its copy in .github/workflows", () => {
  const files = list("templates/workflows", ".yml");
  assert.ok(files.length > 0, "no template workflows found");
  for (const f of files) {
    assert.ok(existsSync(join(root, ".github/workflows", f)), `${f} is missing in .github/workflows`);
    assert.equal(read(`.github/workflows/${f}`), read(`templates/workflows/${f}`), `${f} differs from its template`);
  }
});

test("every template script is byte-identical to its copy in .udd/scripts", () => {
  const files = list("templates/scripts/udd", ".mjs");
  assert.ok(files.length > 0, "no template scripts found");
  for (const f of files) {
    assert.ok(existsSync(join(root, ".udd/scripts", f)), `${f} is missing in .udd/scripts`);
    assert.equal(read(`.udd/scripts/${f}`), read(`templates/scripts/udd/${f}`), `${f} differs from its template`);
  }
});

test("no extra scripts in .udd/scripts without a template", () => {
  const tpl = new Set(list("templates/scripts/udd", ".mjs"));
  for (const f of list(".udd/scripts", ".mjs")) assert.ok(tpl.has(f), `.udd/scripts/${f} has no template`);
});

test("research: triggers on opened and labeled, needs feedback and no researched, agent has no Bash", () => {
  const t = read("templates/workflows/udd-research.yml");
  assert.match(t, /issues:\s*\n\s+types: \[opened, labeled\]/);
  assert.match(t, /contains\(github\.event\.issue\.labels\.\*\.name, 'feedback'\)/);
  assert.match(t, /!contains\(github\.event\.issue\.labels\.\*\.name, 'researched'\)/);
  const tools = [...t.matchAll(/--allowedTools\s+"([^"]*)"/g)].map((m) => m[1]);
  assert.ok(tools.length >= 1);
  for (const list of tools) assert.doesNotMatch(list, /Bash/);
  assert.match(t, /sanitize\.mjs/);
  assert.match(t, /--add-label researched/);
  assert.match(t, /guard:[\s\S]*agent:[\s\S]*publish:/);
  assert.match(job(t, "agent"), /contents: read/);
  assert.doesNotMatch(job(t, "agent"), /: write/);
});

test("fix: only a person's approved label on a feedback issue starts the agent", () => {
  const t = read("templates/workflows/udd-fix.yml");
  const guard = job(t, "guard");
  assert.match(guard, /github\.event\.sender\.type == 'User'/);
  assert.match(guard, /contains\(github\.event\.issue\.labels\.\*\.name, 'feedback'\)/);
  assert.match(guard, /vars\.UDD_AGENT_ENABLED == 'true'/);
  assert.match(guard, /github\.event\.label\.name == 'approved'/);
  assert.match(guard, /--add-label in-progress/);
});

test("fix: three attempts, each gated on the previous one failing, with the red-first check", () => {
  const t = read("templates/workflows/udd-fix.yml");
  const agent = job(t, "agent");
  for (const n of [1, 2, 3]) assert.match(agent, new RegExp(`id: attempt-${n}\\b`), `attempt-${n} missing`);
  assert.doesNotMatch(agent, /id: attempt-4/);
  assert.match(agent, /id: attempt-2\b[\s\S]*?if: [^\n]*steps\.check-1\.outputs\.ok != 'true'/);
  assert.match(agent, /id: attempt-3\b[\s\S]*?if: [^\n]*steps\.check-1\.outputs\.ok != 'true'[^\n]*steps\.check-2\.outputs\.ok != 'true'/);
  assert.match(agent, /node \.udd\/scripts\/red-first\.mjs/);
  assert.match(agent, /@udd-/);
});

test("fix: agent job never holds a write token and has no shell tool", () => {
  const t = read("templates/workflows/udd-fix.yml");
  const agent = job(t, "agent");
  assert.doesNotMatch(agent, /contents: write/);
  assert.doesNotMatch(agent, /(issues|pull-requests): write/);
  assert.match(agent, /persist-credentials: false/);
  for (const m of agent.matchAll(/--allowedTools\s+"([^"]*)"/g)) assert.doesNotMatch(m[1], /Bash/);
  assert.match(job(t, "publish"), /contents: write/);
  assert.match(job(t, "publish"), /no-fly-check\.mjs/);
});

test("fix: failure after three attempts goes to needs-human without a PR", () => {
  const publish = job(read("templates/workflows/udd-fix.yml"), "publish");
  assert.match(publish, /--add-label needs-human/);
  assert.match(publish, /--add-label fix-ready/);
  assert.match(publish, /--remove-label in-progress/);
  assert.match(publish, /gh pr create --draft/);
});

test("fix: shipped job runs on a merged udd/fix-* pull request", () => {
  const t = read("templates/workflows/udd-fix.yml");
  assert.match(t, /pull_request:\s*\n\s+types: \[closed\]/);
  const shipped = job(t, "shipped");
  assert.match(shipped, /github\.event\.pull_request\.merged == true/);
  assert.match(shipped, /startsWith\(github\.event\.pull_request\.head\.ref, 'udd\/fix-'\)/);
  assert.match(shipped, /--add-label shipped/);
  assert.match(shipped, /--remove-label fix-ready/);
  assert.doesNotMatch(shipped, /actions\/checkout/);
});

test("verify: runs on a successful production deployment or by hand with a url", () => {
  const t = read("templates/workflows/udd-verify.yml");
  assert.match(t, /deployment_status:/);
  assert.match(t, /workflow_dispatch:[\s\S]*?url:/);
  assert.match(t, /github\.event\.deployment_status\.state == 'success'/);
  assert.match(t, /github\.event\.deployment\.environment == 'Production'/);
  assert.match(t, /github\.event\.deployment\.environment == 'production'/);
  assert.match(t, /PLAYWRIGHT_BASE_URL/);
  assert.match(t, /inputs\.url/);
  assert.match(t, /vars\.UDD_PROD_URL/);
  assert.match(t, /verify-plan\.mjs/);
  assert.match(t, /verify-plan\.mjs outcome/);
  assert.match(t, /UDD_TEST_USER_EMAIL/);
  assert.match(t, /UDD_TEST_USER_PASSWORD/);
  assert.doesNotMatch(t, /claude-code-action/);
});

test("every workflow in the kit declares empty top-level permissions", () => {
  for (const f of list("templates/workflows", ".yml")) {
    assert.match(read(`templates/workflows/${f}`), /^permissions: \{\}$/m, `${f}: top-level permissions must be {}`);
  }
});

test("model workflows use the subscription token and keep the API key optional", () => {
  for (const f of ["udd-research.yml", "udd-fix.yml"]) {
    const t = read(`templates/workflows/${f}`);
    assert.match(t, /claude_code_oauth_token: \$\{\{ secrets\.CLAUDE_CODE_OAUTH_TOKEN \}\}/);
    assert.match(t, /anthropic_api_key: \$\{\{ secrets\.ANTHROPIC_API_KEY \}\}/);
  }
});
