# ROUTINES.md: weekly routines (for the agent)

Three weekly routines run on GitHub Actions: dead code, duplicated code, security. Each one
opens a draft PR or issues. Nothing is merged or fixed without a person.

Every step: what to do, how to check, what to do if it fails.

## 1. Install

1. Copy `templates/workflows/udd-routine.yml` to `.github/workflows/udd-routine.yml`.
   Copy `templates/routines/*.md` to `.udd/routines/` only for the routines you want (`dead-code.md`,
   `duplicates.md`, `security.md`). A routine whose prompt is missing is skipped with a notice, not an error.
   Copy `routine-guard.mjs`, `sanitize.mjs` and `no-fly-check.mjs` from `templates/scripts/udd/` to `.udd/scripts/`.
   - Check: `ls .udd/routines .udd/scripts` shows the prompts you chose and the scripts; `actionlint` passes.
   - If it fails: the workflow calls files by these exact paths. Do not rename them.
2. Set the repository variable `UDD_AGENT_ENABLED=true` and the secret `CLAUDE_CODE_OAUTH_TOKEN`
   (a Claude Pro or Max subscription token; `ANTHROPIC_API_KEY` also works).
   - Check: `gh variable list` shows the variable; `gh secret list` shows the secret name.
   - If it fails: ask the owner to run `claude setup-token` and give you the token to store.
3. Run it once by hand: `gh workflow run udd-routine.yml`, then `gh run watch`.
   - Check: the run finishes green. Skipped routines are fine.
   - If it fails: read the failing step with `gh run view --log-failed`. The usual cause is a missing secret.

Schedule: Monday 06:00 UTC (`cron: "0 6 * * 1"`).

## 2. Turn a routine off

Remove it from every `routine: [...]` list in `.github/workflows/udd-routine.yml`
(`agent` and, for dead code and duplicates, `verify` and `publish-pr`). To stop everything, set
`UDD_AGENT_ENABLED` to anything but `true`.
- Check: `gh workflow run udd-routine.yml` no longer starts the removed routine.

## 3. Rules

1. At most one open PR or issue per routine. While one is open (label `routine:<name>`), that
   routine is skipped.
2. A rejected finding goes into `.udd/known-findings.json` and is never proposed again:
   `[{"key": "...", "reason": "why", "date": "YYYY-MM-DD"}]`. The key is in the PR text or issue body.
3. Changes pass the project tests (`UDD_TEST_CMD`, default `npm test`) and the no-fly check.
   The tests run in the `verify` job, which has no secrets, no cache and a read-only token.
4. Findings arrive where people look: a draft PR or an issue, never a build artifact.
5. Success is merged PRs and closed issues, not runs. `WEEKLY.md` reports it.

## 3a. Who holds which key

The job with the model token (`agent`) runs no project code: no install, no tests, no `npm`
scripts, and the agent has no shell. Its result (a patch, or `findings.json`) is uploaded first
and its sha256 is recorded as a job output. Then:

- `verify` (no secrets, `permissions: contents: read`, no `cache:`, `persist-credentials: false`)
  checks the sha256, applies the patch to a fresh checkout, runs `UDD_INSTALL_CMD` (default `npm ci`) and `UDD_TEST_CMD`,
  and uploads only a small outcome file.
- `audit` (no secrets) runs `npm audit --json` on the lockfile; the agent receives only the JSON.
- `publish-pr` and `publish-security` check the sha256 again. `publish-pr` uses copies of the
  no-fly checker and its list taken before the patch is applied, and lists changed files with
  `git -c core.quotePath=false diff --cached --name-only -z --no-renames`, passed to
  `no-fly-check.mjs -z`.

Pull requests opened with the workflow `GITHUB_TOKEN` do not trigger other workflows, so the
app's own CI does not run on a routine PR. The owner runs it by hand before merging, or
configures a GitHub App token for the PR step
(https://docs.github.com/en/actions/concepts/security/github_token).

Labels: `routine`, `routine:dead-code`, `routine:duplicates`, `routine:security`, `security`.

## 4. Security routine

It checks seven things: input validation on routes, per-user data access (including Supabase
RLS), secret keys in the browser, user text as HTML, SQL built from input, `npm audit`, and
secrets in git. The agent writes `udd-findings.json`; the workflow drops anything already in
`.udd/known-findings.json` and opens at most ONE issue per run, titled "Security check
<date of the run>", with a checklist of the new findings (at most 20) and the labels
`routine`, `routine:security`, `security`. No new findings means no issue. A secret in git becomes an issue titled "Rotate this key"; no PR, and the
value is never printed.

Fixing comes later and only on request: first the finding, then a person decides.

### Public repositories

The scheduled security routine is off. Findings about a public repository must not appear
in a public issue or PR. The `publish-security` job runs only when `private == 'true'`, and
the agent step is skipped too. Run the security check from `WEEKLY.md` locally instead.
Findings stay in the terminal, and a fix is a normal commit that does not describe the hole.

Why not draft security advisories from the workflow? `GITHUB_TOKEN` cannot create draft
security advisories: the `permissions:` key has no entry for repository security advisories.
The endpoint `POST /repos/{owner}/{repo}/security-advisories` needs a GitHub App installation
token with "Repository security advisories: write"
(https://docs.github.com/en/rest/security-advisories/repository-advisories,
https://docs.github.com/en/actions/concepts/security/github_token). So public repositories run
the security check locally via `WEEKLY.md`, unless the owner sets up such an App.

Sources:
- https://docs.github.com/en/rest/security-advisories/repository-advisories
- https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication
- https://docs.github.com/en/actions/concepts/security/github_token
- https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax

## 5. Cost

Public repositories: GitHub Actions on standard hosted runners is free. Private repositories on
GitHub Free include 2,000 minutes per month (the Free row of the plans table; larger runners
are always billed). One weekly run uses well under 30 minutes. The model runs on the
subscription token. Source:
https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions

## 6. Optional paid add-on

`anthropics/claude-code-security-review` reviews each pull request for security problems.
It needs an API key (billed per use; ask the owner first) and sees only the PR's changes.
It complements the weekly full-codebase review; it does not replace it.

## 7. Deployment status (for verify)

Vercel creates GitHub deployments, so `deployment_status` events exist
(https://vercel.com/docs/git/vercel-for-github). The docs do not state the environment name
sent to GitHub, so check it on the first deploy. For Netlify the docs describe only commit
statuses and checks (https://docs.netlify.com/deploy/deploy-notifications), not deployments.
