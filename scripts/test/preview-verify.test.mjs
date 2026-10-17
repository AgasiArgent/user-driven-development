import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
const PREVIEW = "templates/workflows/udd-preview.yml";
const VERIFY = "templates/workflows/udd-verify.yml";

function jobs(text) {
  const body = text.slice(text.search(/^jobs:\n/m) + "jobs:\n".length);
  const out = {};
  for (const m of body.matchAll(/^  ([a-z][\w-]*):\n([\s\S]*?)(?=^  [a-z][\w-]*:\n|(?![\s\S]))/gm)) out[m[1]] = m[2];
  return out;
}
const preview = () => read(PREVIEW);
const verify = () => read(VERIFY);

test("preview and verify are byte-identical to their copies in .github/workflows", () => {
  for (const f of ["udd-preview.yml", "udd-verify.yml"]) {
    assert.ok(existsSync(`.github/workflows/${f}`), `${f} missing in .github/workflows`);
    assert.equal(read(`.github/workflows/${f}`), read(`templates/workflows/${f}`));
  }
});

test("preview: only successful non-production deployments and manual runs", () => {
  const t = preview();
  assert.match(t, /^permissions: \{\}$/m);
  assert.match(t, /deployment_status:/);
  assert.match(t, /workflow_dispatch:[\s\S]*?url:[\s\S]*?issue:/);
  const find = jobs(t).find;
  assert.match(find, /github\.event\.deployment_status\.state == 'success'/);
  assert.match(find, /github\.event\.deployment\.environment != 'Production'/);
  assert.match(find, /github\.event\.deployment\.environment != 'production'/);
  assert.match(find, /github\.event_name == 'workflow_dispatch'/);
  assert.match(t, /environment_url/);
  assert.match(t, /target_url/);
});

test("preview: only udd/fix-<digits> heads from this repository, found by the deployed commit", () => {
  const find = jobs(preview()).find;
  assert.match(find, /commits\/\$sha\/pulls|commits\/\$\{?SHA\}?\/pulls/);
  assert.match(find, /\^udd\/fix-\[0-9\]\+\$/);
  assert.match(find, /head\.repo\.full_name|\.head\.repo/);
  assert.match(find, /\.head\.sha/);
  assert.match(find, /^\s+issue: /m);
  assert.doesNotMatch(find, /: write/);
});

test("preview: the job that runs project code has no write permission and no write token", () => {
  const test_ = jobs(preview()).test;
  assert.match(test_, /permissions:\s*\n\s+contents: read/);
  assert.doesNotMatch(test_, /: write/);
  assert.match(test_, /persist-credentials: false/);
  assert.doesNotMatch(test_, /cache:/);
  assert.doesNotMatch(test_, /GH_TOKEN|github\.token|GITHUB_TOKEN/);
  assert.doesNotMatch(test_, /CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY/);
  assert.match(test_, /npm ci/);
  assert.match(test_, /UDD_TEST_USER_EMAIL/);
  assert.match(test_, /UDD_TEST_USER_PASSWORD/);
  assert.match(test_, /PLAYWRIGHT_BASE_URL/);
  assert.match(test_, /--grep/);
  assert.match(test_, /secrets\.UDD_PREVIEW_BYPASS/);
});

test("preview: bypass secret is optional and goes to the config as a Vercel header", () => {
  const t = preview();
  assert.match(t, /x-vercel-protection-bypass/);
  assert.match(t, /optional/i);
  // never a hard requirement
  assert.doesNotMatch(t, /-z "\$\{?UDD_PREVIEW_BYPASS\}?"[^\n]*exit 1/);
});

test("preview: labels change in a separate job with trusted scripts and no project code", () => {
  const all = jobs(preview());
  const verdict = all.verdict;
  assert.ok(verdict, "verdict job missing");
  assert.match(verdict, /issues: write/);
  assert.match(verdict, /default_branch/);
  assert.match(verdict, /red-first\.mjs head /);
  assert.doesNotMatch(verdict, /npm (ci|install|test)|npx |E2E_CMD/);
  assert.match(verdict, /--add-label fix-ready/);
  assert.match(verdict, /--remove-label in-progress/);
  assert.match(verdict, /--add-label needs-human/);
  assert.match(verdict, /GITHUB_RUN_ID/);
  assert.doesNotMatch(all.test, /--add-label|--remove-label/);
});

test("both workflows use tagRegex from red-first.mjs for --grep, never a bare tag", () => {
  for (const t of [preview(), verify()]) {
    assert.match(t, /red-first\.mjs regex /);
    assert.doesNotMatch(t, /--grep "@udd-/);
  }
});

test("no job with a write permission installs or runs project code (both workflows)", () => {
  for (const t of [preview(), verify()]) {
    for (const [name, body] of Object.entries(jobs(t))) {
      if (!/: write/.test(body)) continue;
      assert.doesNotMatch(body, /npm (ci|install|test)|npx |E2E_CMD|setup-node[\s\S]*cache:/, `${name} runs project code with a write token`);
    }
  }
});

test("verify: tests run in a job without a write token; labels in a separate trusted job", () => {
  const t = verify();
  const all = jobs(t);
  assert.match(t, /^permissions: \{\}$/m);
  assert.match(all.test, /permissions:\s*\n\s+contents: read/);
  assert.doesNotMatch(all.test, /: write/);
  assert.doesNotMatch(all.test, /GH_TOKEN|github\.token/);
  assert.match(all.test, /persist-credentials: false/);
  assert.match(all.test, /PLAYWRIGHT_BASE_URL/);
  assert.match(all.test, /UDD_TEST_USER_EMAIL/);
  assert.match(all.apply, /issues: write/);
  assert.match(all.apply, /default_branch/);
  assert.match(all.apply, /verify-plan\.mjs outcome/);
  assert.match(all.plan, /verify-plan\.mjs/);
  assert.match(all.plan, /vars\.UDD_PROD_URL/);
  assert.match(all.plan, /inputs\.url/);
});

test("verify: only successful production deployments or manual runs", () => {
  const plan = jobs(verify()).plan;
  assert.match(plan, /github\.event\.deployment_status\.state == 'success'/);
  assert.match(plan, /github\.event\.deployment\.environment == 'Production'/);
  assert.match(plan, /github\.event\.deployment\.environment == 'production'/);
  assert.match(verify(), /workflow_dispatch:[\s\S]*?url:/);
});

// ---- hardening: secrets scope, bypass host, host allow-list, sanitised URL, labels, report validity ----

const stepsOf = (job) => job.split(/^      - /m).slice(1);
const SECRET_RE = /secrets\.UDD_(TEST_USER_EMAIL|TEST_USER_PASSWORD|PREVIEW_BYPASS)/;

test("secrets live only in the env of the one step that runs the tests (both workflows)", () => {
  for (const [name, t] of [["preview", preview()], ["verify", verify()]]) {
    const test_ = jobs(t).test;
    const head = test_.slice(0, test_.search(/^    steps:/m));
    assert.doesNotMatch(head, SECRET_RE, `${name}: secret at job level`);
    const withSecrets = stepsOf(test_).filter((s) => SECRET_RE.test(s));
    assert.equal(withSecrets.length, 1, `${name}: secrets must appear in exactly one step`);
    assert.match(withSecrets[0], /--grep/, `${name}: that step must be the one running the tests`);
    assert.doesNotMatch(withSecrets[0], /npm ci|playwright install/);
    assert.match(withSecrets[0], /UDD_TEST_USER_EMAIL/);
    assert.match(withSecrets[0], /UDD_TEST_USER_PASSWORD/);
  }
  const step = stepsOf(jobs(preview()).test).find((s) => SECRET_RE.test(s));
  assert.match(step, /secrets\.UDD_PREVIEW_BYPASS/);
  assert.doesNotMatch(jobs(verify()).test, /UDD_PREVIEW_BYPASS/);
});

test("preview: bypass is scoped to the preview host and the env contract is documented at the top", () => {
  const t = preview();
  const step = stepsOf(jobs(t).test).find((s) => SECRET_RE.test(s));
  assert.match(step, /UDD_PREVIEW_HOST: \$\{\{ needs\.find\.outputs\.host \}\}/);
  assert.match(jobs(t).find, /^\s+host: /m);
  const top = t.slice(0, t.search(/^name:/m));
  assert.match(top, /UDD_PREVIEW_HOST/);
  assert.match(top, /UDD_PREVIEW_BYPASS/);
  assert.match(top, /route|fixture/i);
  assert.match(top, /only|equals/i);
});

test("preview: host allow-list by UDD_PREVIEW_HOST_SUFFIX in both modes, https only", () => {
  const find = jobs(preview()).find;
  assert.match(find, /vars\.UDD_PREVIEW_HOST_SUFFIX/);
  assert.match(find, /case "\$url" in https:\/\/\*\)/);
  assert.match(find, /\[\[:space:\]\]/);
  assert.match(find, /\$\{?SUFFIX\}?/);
  // the suffix check happens before any pull request is looked up from the URL, in the shared path
  assert.match(find.slice(find.search(/Find the fix pull request/)), /SUFFIX/);
  assert.match(find, /host.*\$SUFFIX|\$SUFFIX.*host/s);
  // empty suffix means stop, never allow-all
  assert.match(find, /-z "\$SUFFIX"/);
  // userinfo / port / backslash tricks in the authority are rejected
  assert.match(find, /@/);
});

test("preview: dispatch mode requires a successful deployment of the PR head sha with the same host", () => {
  const find = jobs(preview()).find;
  assert.match(find, /deployments: read/);
  assert.match(find, /repos\/\$GITHUB_REPOSITORY\/deployments\?sha=\$head_sha|deployments\?sha=/);
  assert.match(find, /\/statuses/);
  assert.match(find, /environment_url/);
  assert.match(find, /state == "success"|\.state == "success"/);
  assert.match(find, /"\$EVENT" = "workflow_dispatch"[\s\S]*deployments\?sha=/);
});

test("preview: the URL is untrusted text, passed through sanitize.mjs before any comment", () => {
  const verdict = jobs(preview()).verdict;
  assert.match(verdict, /node \.udd\/scripts\/sanitize\.mjs/);
  assert.doesNotMatch(verdict, /--body "[^"]*\$URL/);
  assert.doesNotMatch(verdict, /--body "[^"]*\$\{URL/);
  assert.match(verdict, /--body "[^"]*\$safe_url/);
  assert.doesNotMatch(jobs(verify()).apply, /--body "[^"]*\$PROD_URL/);
  assert.match(jobs(verify()).apply, /sanitize\.mjs/);
});

test("preview: full label set on each transition", () => {
  const v = jobs(preview()).verdict;
  assert.match(v, /--add-label fix-ready --remove-label in-progress,needs-human/);
  assert.match(v, /--add-label needs-human --remove-label fix-ready,in-progress/);
});

test("verify: a missing or unparsable report is an error, only a valid empty report means skipped", () => {
  const t = verify();
  const apply = jobs(t).apply;
  assert.match(apply, /\.config/);
  assert.match(apply, /\.suites/);
  assert.match(apply, /--add-label needs-human/);
  assert.match(apply, /exit 1|errors/);
  const errAt = apply.search(/needs-human/);
  const skipAt = apply.search(/Skipped/);
  assert.ok(errAt > -1 && skipAt > -1);
  assert.match(apply, /ERROR/);
  // the test job must not paper a broken run over with an empty-but-valid report
  assert.doesNotMatch(jobs(t).test, /echo '\{\}' > "\$report"[\s\S]*suites/);
});
