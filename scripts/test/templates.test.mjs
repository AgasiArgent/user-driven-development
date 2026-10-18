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
const RUNS_PROJECT_CODE = /npm ci|UDD_INSTALL_CMD|UDD_E2E_CMD|UDD_TEST_CMD/;
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
    // the whole .git is saved before the agent and put back before git reads the tree again
    assert.match(j, /tar -C "\$GITHUB_WORKSPACE" -cf "\$RUNNER_TEMP\/dotgit\.tar" \.git[\s\S]*claude-code-action[\s\S]*rm -rf \.git && tar -C "\$GITHUB_WORKSPACE" -xf "\$RUNNER_TEMP\/dotgit\.tar"/);
    assert.doesNotMatch(j, /gitconfig|\.git\/hooks/);
    assert.match(j, /\bg diff --cached --binary --no-renames --no-ext-diff --no-textconv/);
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
    assert.doesNotMatch(j, /UDD_TEST_GLOB/, "red applies only the pre-check's testFiles, not the whole glob");
    assert.match(j, /UDD_INSTALL_CMD: \$\{\{ vars\.UDD_INSTALL_CMD \|\| 'npm ci' \}\}/);
    assert.match(j, /bash -c "\$UDD_INSTALL_CMD"/);
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
    assert.ok(j.indexOf('bash -c "$UDD_INSTALL_CMD"') < j.indexOf("secrets.UDD_TEST_USER_EMAIL"), "test secrets must come after the install, on the test step only");
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

// ---- hardening: git metadata, secret scan, patch check, labels ----
const GIT_HARDENED = /GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=\/dev\/null git -c core\.hooksPath=\/dev\/null -c core\.fsmonitor=false -c core\.attributesFile=\/dev\/null/;
const stepsOf = (j) => j.split(/^      - /m).slice(1);
const agentJobs = () => {
  const fix = read("templates/workflows/udd-fix.yml");
  return [1, 2, 3].map((n) => [`fix agent-${n}`, job(fix, `agent-${n}`)]).concat([["research agent", job(read("templates/workflows/udd-research.yml"), "agent")]]);
};

test("agent jobs: .git is restored from a tar and every later git command is hardened", () => {
  for (const [name, j] of agentJobs()) {
    assert.match(j, /tar -C "\$GITHUB_WORKSPACE" -cf "\$RUNNER_TEMP\/dotgit\.tar" \.git/, name);
    assert.match(j, /rm -rf \.git && tar -C "\$GITHUB_WORKSPACE" -xf "\$RUNNER_TEMP\/dotgit\.tar"/, name);
    assert.ok(j.indexOf("-cf ") < j.indexOf("claude-code-action") && j.indexOf("claude-code-action") < j.indexOf("-xf "), `${name}: tar before the agent, untar after`);
    assert.doesNotMatch(j, /gitconfig|\.git\/hooks/, name);
    if (/\bgit (add|diff)\b|\bg add|\bg diff/.test(j)) {
      assert.match(j, GIT_HARDENED, name);
      assert.match(j, /--no-ext-diff --no-textconv/, name);
      assert.doesNotMatch(j, /^\s*git (add|diff)/m, `${name}: bare git after the agent`);
    }
  }
});

test("agent jobs: the artifact is scanned for the model secret literals before upload", () => {
  for (const [name, j] of agentJobs()) {
    const steps = stepsOf(j);
    const agent = steps.findIndex((s) => /claude-code-action/.test(s));
    const scan = steps.findIndex((s) => /grep -[a-z]*F[a-z]* -- "\$S"/.test(s));
    const upload = steps.findIndex((s) => /upload-artifact/.test(s));
    assert.ok(agent >= 0 && scan > agent && upload > scan, `${name}: agent, then scan, then upload`);
    assert.match(steps[scan], /CLAUDE_CODE_OAUTH_TOKEN: \$\{\{ secrets\.CLAUDE_CODE_OAUTH_TOKEN \}\}/, name);
    assert.match(steps[scan], /ANTHROPIC_API_KEY: \$\{\{ secrets\.ANTHROPIC_API_KEY \}\}/, name);
    assert.match(steps[scan], /\[ -n "\$S" \]/, `${name}: empty values are skipped`);
    assert.match(steps[scan], /exit 1/, name);
    assert.doesNotMatch(steps[scan], /echo[^\n]*\$S\b|printf[^\n]*\$S\b|\$\{S\}/, `${name}: never prints the secret`);
    assert.doesNotMatch(steps[scan], /RUNS_PROJECT_CODE|npm /, name);
  }
});

test("fix: publish checks every attempt with the trusted patch-check before it can win", () => {
  const p = job(read("templates/workflows/udd-fix.yml"), "publish");
  assert.match(p, /cp [^\n]*\.udd\/scripts\/patch-check\.mjs[^\n]*trusted/);
  assert.match(p, /UDD_TEST_GLOB: \$\{\{ vars\.UDD_TEST_GLOB \|\| '\*\*\/\*\.spec\.ts,\*\*\/\*\.test\.ts,e2e\/\*\*' \}\}/);
  const pick = p.slice(p.indexOf("Pick the winning attempt"), p.indexOf("Ask for a human"));
  const red = pick.indexOf("trusted/red-first.mjs");
  const patch = pick.indexOf('node "$RUNNER_TEMP/trusted/patch-check.mjs" "$in/patch-$n/agent.patch" "@udd-$ISSUE" "$UDD_TEST_GLOB" --files-z');
  const win = pick.indexOf("winner=$n");
  assert.ok(red >= 0 && patch > red && win > patch, "both checks gate the winner");
  assert.doesNotMatch(p, /node \.udd\/scripts/);
});

test("fix: verdict jobs take the patch check's reason from pre-check and pass it on", () => {
  const t = read("templates/workflows/udd-fix.yml");
  for (const n of [1, 2]) {
    const j = job(t, `verdict-${n}`);
    assert.match(j, new RegExp(`needs\\.pre-check-${n}\\.outputs\\.reason`));
    assert.match(j, new RegExp(`needs\\.pre-check-${n}\\.outputs\\.ok`));
    assert.doesNotMatch(j, /patch-check\.mjs/, "no patch-check without the NUL file list");
    assert.doesNotMatch(j, /: write|npm ci|UDD_INSTALL_CMD/);
    assert.doesNotMatch(j, MODEL_SECRET);
  }
  assert.match(job(t, "agent-2"), /patch check/i);
  assert.match(job(t, "agent-3"), /patch check/i);
});

test("fix: every label transition sets the full set", () => {
  const t = read("templates/workflows/udd-fix.yml");
  const SET = (add, rm) => new RegExp(`--add-label ${add}( --remove-label (${rm.join("|")}))+`);
  const rmOf = (line) => [...line.matchAll(/--remove-label ([\w-]+)/g)].map((m) => m[1]).sort();
  const edits = (j) => j.split("\n").filter((l) => /gh issue edit/.test(l));
  const guard = edits(job(t, "guard"));
  assert.equal(guard.length, 1);
  assert.match(guard[0], /--add-label in-progress/);
  assert.deepEqual(rmOf(guard[0]), ["fix-ready", "needs-human", "verified"]);
  const pub = job(t, "publish");
  const fails = edits(pub).filter((l) => /--add-label needs-human/.test(l));
  assert.ok(fails.length >= 3, "no-winner, no-fly and a catch-all failure step");
  for (const l of fails) assert.deepEqual(rmOf(l), ["fix-ready", "in-progress"]);
  assert.match(pub, /if: failure\(\)/);
  const ok = edits(pub).filter((l) => /--add-label in-progress/.test(l));
  assert.equal(ok.length, 1);
  assert.deepEqual(rmOf(ok[0]), ["fix-ready", "needs-human", "verified"]);
  const shipped = edits(job(t, "shipped"));
  assert.equal(shipped.length, 1);
  assert.match(shipped[0], /--add-label shipped/);
  assert.deepEqual(rmOf(shipped[0]), ["fix-ready", "in-progress", "needs-human"]);
  void SET;
});

// ---- round 2: file-tool scoping, pre-check, install command, research cap, preview trigger ----
const PERM_DOCS = "https://code.claude.com/docs/en/permissions";
const DENIED = ["//proc/**", "//sys/**", "//etc/**", "//tmp/**", "//home/runner/work/_temp/**", "~/.*", "~/.*/**"];
const argList = (j, flag) => {
  const m = j.match(new RegExp(`${flag}\\s+"([^"]*)"`));
  return m ? m[1].split(",") : null;
};
const modelJobs = () => [
  ...[1, 2, 3].map((n) => [`fix agent-${n}`, job(read("templates/workflows/udd-fix.yml"), `agent-${n}`)]),
  ["research agent", job(read("templates/workflows/udd-research.yml"), "agent")],
  ["routine agent", job(read("templates/workflows/udd-routine.yml"), "agent")],
];

test("file tools: allow only workspace-scoped Read/Edit (Glob and Grep follow the Read rules), deny everything outside the workspace", () => {
  for (const f of ["udd-fix.yml", "udd-research.yml", "udd-routine.yml"]) assert.match(read(`templates/workflows/${f}`), new RegExp(PERM_DOCS.replace(/[/.]/g, "\\$&")), `${f} cites the permission docs`);
  for (const [name, j] of modelJobs()) {
    const allow = argList(j, "--allowedTools");
    const deny = argList(j, "--disallowedTools");
    assert.ok(allow && deny, `${name}: both lists`);
    // Bare Glob/Grep would be allowed tool-wide; the docs apply Read rules to them, so only path-scoped Read/Edit are granted.
    assert.deepEqual(allow.sort(), ["Edit(./**)", "Read(./**)"].sort(), name);
    for (const p of DENIED) {
      assert.ok(deny.includes(`Read(${p})`), `${name}: Read(${p}) denied`);
      assert.ok(deny.includes(`Edit(${p})`), `${name}: Edit(${p}) denied`);
    }
    // the docs: only Read and Edit path rules are consulted (Write, Glob, Grep path rules are ignored and warn)
    for (const r of [...allow, ...deny]) assert.doesNotMatch(r, /^(Write|Glob|Grep|Bash)\(/, `${name}: ${r}`);
    assert.doesNotMatch(allow.join(), /Bash/);
  }
});

test("research: the open-issues list lives in the workspace, because the runner temp dir is denied", () => {
  const j = job(read("templates/workflows/udd-research.yml"), "agent");
  assert.doesNotMatch(j, /runner\.temp \}\}\/open-issues\.json/);
  assert.match(j, /> udd-open-issues\.json/);
  assert.match(j, /udd-open-issues\.json/);
});

test("fix: pre-check-N sits between agent-N and red-N, with no secrets, no install, trusted scripts", () => {
  const t = read("templates/workflows/udd-fix.yml");
  assert.deepEqual(jobsOf(t).filter((n) => /^pre-check-/.test(n)), ["pre-check-1", "pre-check-2", "pre-check-3"]);
  for (const n of [1, 2, 3]) {
    const j = job(t, `pre-check-${n}`);
    assert.match(j, new RegExp(`needs: \\[[^\\]]*agent-${n}`));
    assert.match(j, /permissions:\s*\n\s+contents: read/);
    assert.doesNotMatch(j, /: write|secrets\.|setup-node|cache:|claude-code-action/);
    assert.doesNotMatch(j, RUNS_PROJECT_CODE);
    assert.match(j, /persist-credentials: false/);
    assert.match(j, new RegExp(`needs\\.agent-${n}\\.outputs\\.sha`));
    assert.match(j, /sha256sum/);
    assert.match(j, /outputs:[\s\S]*ok:[\s\S]*reason:[\s\S]*testFiles:/);
    assert.ok(j.indexOf("/trusted") < j.indexOf("git apply"), "trusted copies are taken before the patch is applied");
    assert.match(j, /git -c core\.quotePath=false diff --cached --name-only -z --no-renames/);
    assert.match(j, /trusted\/no-fly-check\.mjs" -z "\$RUNNER_TEMP\/trusted\/no-fly\.txt"/);
    assert.match(j, /trusted\/patch-check\.mjs" "[^"]*agent\.patch" "@udd-\$ISSUE" "\$UDD_TEST_GLOB" --files-z/);
    assert.doesNotMatch(j, /node \.udd\/scripts/);
    const r = job(t, `red-${n}`);
    assert.match(r, new RegExp(`needs: \\[[^\\]]*pre-check-${n}`));
    assert.match(r, new RegExp(`if: [^\n]*needs\\.pre-check-${n}\\.outputs\\.ok == 'true'`));
    assert.match(r, new RegExp(`needs\\.pre-check-${n}\\.outputs\\.testFiles`));
    assert.match(r, /xargs -0 -r -a "\$RUNNER_TEMP\/tests\.list" git --literal-pathspecs diff --cached/);
    assert.match(r, /--literal-pathspecs/);
  }
});

test("fix: publish re-runs patch-check and no-fly per attempt from a scratch index", () => {
  const p = job(read("templates/workflows/udd-fix.yml"), "publish");
  const pick = p.slice(p.indexOf("Pick the winning attempt"), p.indexOf("Ask for a human"));
  assert.match(pick, /GIT_INDEX_FILE=/);
  assert.match(pick, /apply --cached/);
  assert.match(pick, /trusted\/no-fly-check\.mjs" -z/);
  assert.match(pick, /name-only -z --no-renames/);
});

test("fix: publish may dispatch the preview workflow (actions: write on that job only)", () => {
  const t = read("templates/workflows/udd-fix.yml");
  assert.match(job(t, "publish"), /actions: write/);
  for (const n of jobsOf(t)) if (n !== "publish") assert.doesNotMatch(job(t, n), /actions: write/, n);
  const p = job(t, "publish");
  assert.ok(p.indexOf("gh workflow run udd-preview.yml -f issue=\"$ISSUE\"") > p.indexOf("gh pr create --draft"));
});

test("research: a daily cap on research and a single queue on the agent job only", () => {
  const t = read("templates/workflows/udd-research.yml");
  // A workflow-level group would let issue events that the guard skips displace a pending research run.
  assert.doesNotMatch(t, /^concurrency:/m);
  assert.match(job(t, "agent"), /concurrency:\n\s+group: udd-research-agent\n\s+cancel-in-progress: false/);
  const g = job(t, "guard");
  assert.match(g, /UDD_RESEARCH_DAILY_CAP \|\| '20'/);
  assert.match(g, /issues\/events/);
  assert.match(g, /\.label\.name==\"researched\"|label\.name == \"researched\"/);
  assert.match(g, /-ge "\$CAP"|>= *"?\$CAP/);
});

test("fix: an attempt with no changes is terminal: no further attempt, comment, needs-human", () => {
  const t = read("templates/workflows/udd-fix.yml");
  assert.match(job(t, "agent-2"), /needs\.verdict-1\.outputs\.reason != 'no-changes'/);
  const a3 = job(t, "agent-3");
  assert.match(a3, /needs\.verdict-1\.outputs\.reason != 'no-changes'/);
  assert.match(a3, /needs\.verdict-2\.outputs\.reason != 'no-changes'/);
  const publish = job(t, "publish");
  assert.match(publish, /terminal=no-changes; break/);
  assert.match(publish, /found nothing to change/);
  assert.match(publish, /steps\.pick\.outputs\.terminal/);
});
