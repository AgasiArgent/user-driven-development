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

const MODEL_SECRET = /secrets\.(CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY)/;
const RUNS_PROJECT_CODE = /npm ci|UDD_E2E_CMD|UDD_TEST_CMD/;
const jobsOf = (text) => {
  const body = text.slice(text.search(/^jobs:\n/m));
  return [...body.matchAll(/^  ([a-z][\w-]*):\n/gm)].map((m) => m[1]);
};

test("no job that holds a model token installs or runs project code (all workflows)", () => {
  for (const f of list("templates/workflows", ".yml")) {
    const t = read(`templates/workflows/${f}`);
    for (const name of jobsOf(t)) {
      const j = job(t, name);
      if (MODEL_SECRET.test(j)) assert.doesNotMatch(j, RUNS_PROJECT_CODE, `${f}: job ${name} holds a model token and runs project code`);
    }
  }
});

test("fix: three agent jobs hold the model token and read-only contents, with no install and no tests", () => {
  const t = read("templates/workflows/udd-fix.yml");
  assert.deepEqual(jobsOf(t).filter((n) => /^agent-/.test(n)), ["agent-1", "agent-2", "agent-3"]);
  for (const n of [1, 2, 3]) {
    const j = job(t, `agent-${n}`);
    assert.match(j, MODEL_SECRET);
    assert.match(j, /contents: read/);
    assert.doesNotMatch(j, /: write/);
    assert.doesNotMatch(j, RUNS_PROJECT_CODE);
    assert.doesNotMatch(j, /playwright install|setup-node/);
    assert.match(j, /persist-credentials: false/);
    for (const m of j.matchAll(/--allowedTools\s+"([^"]*)"/g)) assert.doesNotMatch(m[1], /Bash/);
    assert.match(j, /@udd-/);
    // git state is saved before the agent and restored before git reads the tree again
    assert.match(j, /cp \.git\/config "\$RUNNER_TEMP\/gitconfig"[\s\S]*claude-code-action[\s\S]*cp "\$RUNNER_TEMP\/gitconfig" \.git\/config/);
    assert.match(j, /rm -rf \.git\/hooks/);
    assert.match(j, /git diff --cached --binary --no-renames --no-ext-diff --no-textconv/);
    assert.match(j, /sha256sum/);
    assert.match(j, /outputs:[\s\S]*sha:/);
    assert.match(j, /actions\/upload-artifact@v4/);
  }
});

test("fix: attempts 2 and 3 run only after the previous red check failed and get its reason", () => {
  const t = read("templates/workflows/udd-fix.yml");
  assert.doesNotMatch(job(t, "agent-1"), /needs\.verdict/);
  assert.match(job(t, "agent-2"), /needs: \[[^\]]*verdict-1/);
  assert.match(job(t, "agent-2"), /if: [^\n]*needs\.verdict-1\.outputs\.ok != 'true'/);
  assert.match(job(t, "agent-2"), /needs\.verdict-1\.outputs\.reason/);
  assert.match(job(t, "agent-3"), /needs: \[[^\]]*verdict-2/);
  assert.match(job(t, "agent-3"), /if: [^\n]*needs\.verdict-1\.outputs\.ok != 'true'[^\n]*needs\.verdict-2\.outputs\.ok != 'true'/);
  assert.match(job(t, "agent-3"), /needs\.verdict-2\.outputs\.reason/);
  assert.doesNotMatch(t, /agent-4|red-4/);
});

test("fix: red jobs have no write permission, no model secret, no cache, and run the tagged test on production", () => {
  const t = read("templates/workflows/udd-fix.yml");
  assert.deepEqual(jobsOf(t).filter((n) => /^red-/.test(n)), ["red-1", "red-2", "red-3"]);
  for (const n of [1, 2, 3]) {
    const j = job(t, `red-${n}`);
    assert.match(j, /permissions:\s*\n\s+contents: read/);
    assert.doesNotMatch(j, /: write/);
    assert.doesNotMatch(j, MODEL_SECRET);
    assert.doesNotMatch(j, /ANTHROPIC|CLAUDE_CODE/);
    assert.doesNotMatch(j, /claude-code-action/);
    assert.doesNotMatch(j, /cache:/);
    assert.match(j, /persist-credentials: false/);
    assert.match(j, /sha256sum/);
    assert.match(j, /vars\.UDD_TEST_GLOB/);
    assert.match(j, /npm ci/);
    assert.match(j, /UDD_E2E_CMD/);
    assert.match(j, /--grep/);
    assert.match(j, /red-first\.mjs regex/);
    assert.match(j, /PLAYWRIGHT_BASE_URL: \$\{\{ vars\.UDD_PROD_URL \}\}/);
    assert.match(j, /secrets\.UDD_TEST_USER_EMAIL/);
    assert.match(j, /secrets\.UDD_TEST_USER_PASSWORD/);
    assert.match(j, /base\.json/);
    // the verdict is computed elsewhere
    assert.doesNotMatch(j, /red-first\.mjs (base|head)/);
    // the test account secrets are never in scope while dependencies install
    assert.ok(j.indexOf("npm ci") < j.indexOf("secrets.UDD_TEST_USER_EMAIL"), "test secrets must come after npm ci, on the test step only");
  }
});

test("fix: verdict jobs only read the report with the trusted script, with no install", () => {
  const t = read("templates/workflows/udd-fix.yml");
  for (const n of [1, 2]) {
    const j = job(t, `verdict-${n}`);
    assert.match(j, /red-first\.mjs base/);
    assert.doesNotMatch(j, /: write|npm ci|UDD_E2E_CMD|UDD_TEST_CMD/);
    assert.doesNotMatch(j, MODEL_SECRET);
  }
});

test("fix: publish runs from trusted copies taken before the patch and verifies every sha256", () => {
  const t = read("templates/workflows/udd-fix.yml");
  const p = job(t, "publish");
  assert.match(p, /contents: write/);
  assert.match(p, /pull-requests: write/);
  assert.match(p, /issues: write/);
  assert.doesNotMatch(p, RUNS_PROJECT_CODE);
  assert.doesNotMatch(p, MODEL_SECRET);
  assert.doesNotMatch(p, /setup-node/);
  assert.match(p, /\$RUNNER_TEMP\/trusted/);
  assert.match(p, /cp [^\n]*red-first\.mjs[^\n]*no-fly-check\.mjs[^\n]*no-fly\.txt[^\n]*trusted/);
  assert.ok(p.indexOf("/trusted") < p.indexOf("git apply"), "trusted copies come before the patch is applied");
  assert.match(p, /sha256sum/);
  for (const n of [1, 2, 3]) assert.match(p, new RegExp(`needs\\.agent-${n}\\.outputs\\.sha`));
  assert.match(p, /node "\$RUNNER_TEMP\/trusted\/red-first\.mjs" base/);
  assert.doesNotMatch(p, /node \.udd\/scripts/);
  assert.match(p, /git -c core\.quotePath=false diff --cached --name-only -z --no-renames/);
  assert.match(p, /trusted\/no-fly-check\.mjs" -z "\$RUNNER_TEMP\/trusted\/no-fly\.txt"/);
  assert.match(p, /gh pr create --draft/);
  assert.match(p, /Fixes #/);
  assert.match(p, /udd\/fix-|\$BRANCH/);
  assert.match(p, /--add-label needs-human/);
  assert.match(p, /--remove-label in-progress/);
  // the label stays in-progress until the preview is checked
  assert.doesNotMatch(p, /--add-label fix-ready/);
  assert.match(p, /preview/i);
});

test("fix: red jobs and publish verify the patch sha256 against the agent job output", () => {
  const t = read("templates/workflows/udd-fix.yml");
  for (const n of [1, 2, 3]) assert.match(job(t, `red-${n}`), new RegExp(`needs\\.agent-${n}\\.outputs\\.sha`));
});

test("fix: failure after three attempts goes to needs-human without a PR", () => {
  const publish = job(read("templates/workflows/udd-fix.yml"), "publish");
  assert.match(publish, /--add-label needs-human --remove-label in-progress/);
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
