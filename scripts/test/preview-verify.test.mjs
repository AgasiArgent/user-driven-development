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
