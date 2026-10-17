# SETUP.md: install the feedback loop (for the agent)

You are a coding agent working inside the owner's app. This file installs a loop: users report
a problem from the app, a GitHub issue appears, an agent looks into it, the owner approves, a
draft PR arrives with a test that fails on the live site and passes on the preview deployment of
the fix, and after you merge, the fix is checked on the live site again.

Every step has three parts: what to do, how to check it worked, what to do if it did not.
Do the steps in order. Do not skip a check. Never print a secret value, and never put one in a
file you commit.

Other files: `ROUTINES.md` (weekly routines, optional), `WEEKLY.md` (the owner's weekly run),
`RULES.md` (the rules behind the loop, for people).

## 0. Preconditions

1. Get the kit next to the app, outside the app's folder:
   `KIT=$(mktemp -d)/udd-kit && git clone --depth 1 https://github.com/AgasiArgent/user-driven-development "$KIT"`
   and keep `$KIT` for the rest of the setup. Files below that start with `templates/`,
   `widget/`, `delivery/` or `demo/` are in `$KIT`.
   - Check: `ls "$KIT/templates/workflows"` lists five `udd-*.yml` files.
   - If it fails: ask the owner for network access or a copy of the kit.
2. Work on a new branch of the app: `git switch -c udd-setup`. Do not push to the default branch.
   - Check: `git branch --show-current` prints `udd-setup`.
3. Make sure `gh` is signed in with admin rights on the repository.
   - Check: `gh auth status` succeeds and `gh repo view --json viewerPermission -q .viewerPermission` prints `ADMIN`.
   - If it fails: ask the owner to run `gh auth login`. Without admin rights you cannot set labels, variables or secrets; stop and say so.

## 1. Ask six questions

Ask all six at once. State your guess for each, so the owner can just say "yes".

1. Which GitHub repository, and which package manager (npm, pnpm, yarn, bun)? Guess: `git remote get-url origin`, and the lockfile in the repository root (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock` or `bun.lockb`).
2. Is there a database, and which (Supabase, Postgres, none)? Guess: look for `@supabase/supabase-js`, `pg`, `prisma` in `package.json`.
3. Where do screenshots go? Default: the app's own storage, behind login.
4. Is there a test account in production for the checks? It must hold no real data and no admin rights. If not, the fix and production checks stay off and the rest works.
5. How is the app deployed (Vercel, Netlify, other)? It decides how `udd-preview.yml` and `udd-verify.yml` start (section 8a).
6. Is the repository public or private? `gh repo view --json isPrivate -q .isPrivate`. It decides the security routine (`ROUTINES.md` section 4).

- Check: you have six answers. Write them down in your notes, not in a file in the repo.
- If an answer is "I don't know": use the default, say which one you took, and go on. The exception is the lockfile: with no lockfile in the repository, refuse to enable the loop (section 10), because the workflows install with a frozen lockfile. Ask the owner to commit one first.

## 2. Create the labels

The names are fixed. Colors come from `LABEL_COLORS` in `templates/scripts/udd/status.mjs`.

1. For each of the 13 labels run `gh label create <name> --color <hex> --force`:
   `feedback`, `researched`, `approved`, `in-progress`, `fix-ready`, `shipped`, `verified`,
   `needs-human`, `routine`, `routine:dead-code`, `routine:duplicates`, `routine:security`, `security`.
   - Check: `gh label list --limit 100 --json name -q '.[].name'` shows all 13.
   - If it fails: a missing label makes a workflow step fail later. Re-run `gh label create` for the missing name and read the error.

## 3. Add the widget

The widget is a script that adds a "Report a problem" button. The user clicks the broken part of
the page and writes what is wrong. It sends: text, screenshot, CSS selector of the clicked
element, page address, console errors, failed requests. Input fields are masked.

1. Build the widget inside the cloned kit, not in the app:
   `cd "$KIT" && npm ci -w widget && npm run build -w widget`. The output is `$KIT/widget/dist/widget.js`
   (one file). `@medv/finder` and `html2canvas-pro` are bundled into it at build time, so the app
   needs no widget dependency and no bundler step. Copy only that one file into the app's `public/`
   (or static) folder. Do not copy `widget/src/` into the app.
   - Check: `ls -l` on the copied `widget.js` shows a file of a few hundred KB.
2. Load the script on every page for a signed-in user:
   `<script src="/widget.js" data-endpoint="/api/feedback" defer></script>` (change the route name if
   the stack wants another). Do not set `data-user`: the user is never taken from the page (section 4, rule 1).
   - Check: open the app in a browser. The button shows on a page, and clicking an element highlights it.
   - If it fails: open the console. A warning `data-endpoint is missing` means the script tag lost its attribute.
3. Hints by stack:
   - Next.js (App Router): put the script in `app/layout.tsx` with `next/script` (`strategy="afterInteractive"`), only when a user is signed in. Put the built file in `public/`.
   - Vite + Express: build the widget to `dist` or `public/`, add the script tag to `index.html`, the script tag needs no user attribute.
   - Other: any page template that every signed-in page shares.

## 4. Add the intake route

The route receives a report and creates the issue. Pattern: `demo/lib/feedback.ts` (limits, JSON
checks) and `delivery/src/issueBody.ts` (issue text). Copy the logic, not the demo's lack of auth.

Rules for the route (all are required):
1. Only a signed-in user may call it. Return 401 otherwise. The user id comes from the server-side session, never from `data-user` or the request body (ignore any user field in the body). The widget sends a plain `fetch` with no custom headers, so the session must travel in a same-origin cookie. The widget has no hook for an auth header: if the app uses token auth, give the route cookie-based session access for this call.
2. Rate limit per user (for example 10 reports per hour). Return 429 over the limit.
3. Body limit 3 MB. Return 413 over it.
4. Store the report in `feedback_reports` (section 4a) with status `received`. Store the screenshot in the storage from question 3, behind login. Never a public link.
5. Create the issue with the GitHub REST API: `POST /repos/{owner}/{repo}/issues`, label `feedback`. The token is named `UDD_GITHUB_TOKEN`. It is a fine-grained token for this one repository only, with the permissions "Issues: Read and write" and "Metadata: Read". The owner creates it in GitHub, Settings, Developer settings, Fine-grained tokens, and enters it in the hosting provider's environment variables (server only). It never goes into code, a committed file, or a `NEXT_PUBLIC_*` or `VITE_*` variable.
6. Build title and body with the rules of `renderIssue` in `delivery/src/issueBody.ts`: `&`, `<`, `>` escaped; a zero-width space after every `@`; the body cut to `MAX_BODY` (65,000 characters) with `> _(truncated)_`; the user's text quoted with `>`.
7. Answer `201` with JSON `{"id": "<report id>"}` as soon as the report is saved, even if the GitHub issue is still pending. The widget treats anything but `201` with an `id` as a failure. If GitHub fails, keep the row as `received` and retry on the next call to the route and when the "My feedback" page opens. Set `issue_number` when the retry succeeds.
8. With no database (question 2): create the issue directly, then answer `201` with `{"id": "<issue number>"}`. If GitHub fails, answer an error status (502), not `201`, and tell the owner a report can be lost if GitHub is down.

- Check: sign in, send a report from the widget. `gh issue list --label feedback` shows a new issue, its body has no raw `<` and no `@` followed directly by a letter.
- Check: call the route without signing in. It answers 401.
- Check (retry): set a wrong GitHub token for one local run and send a report. The row stays `received`; with the right token the next call creates the issue.
- If it fails: read the route's server log. A 403 from GitHub means `UDD_GITHUB_TOKEN` lacks "Issues: Read and write" or is for another repository.

### 4a. The table

Create `feedback_reports` with a migration in the app's migration system (see
`demo/db/migrations/001_init.sql` for the shape of `feedback_outbox`):
`id`, `user_id`, `status` (default `received`), `payload` (json), `screenshot_path`,
`issue_number` (null until created), `attempts`, `created_at`.
- Supabase: turn on row level security and add a policy so a user reads only rows with `user_id = auth.uid()`. The server writes with the service key, on the server only.
- Check: with two test users, user A cannot read user B's rows (query as A, expect zero rows).
- If it fails: no RLS means anyone with the public key reads every report. Fix before going on.

## 5. Add the "My feedback" page

A signed-in user sees their reports and the status of each.

1. List the user's rows. For each row with an `issue_number`, read the issue's labels, state and
   state reason from GitHub (server side, cached for a minute) and turn them into a status with
   `statusFromIssue` from `templates/scripts/udd/status.mjs`. Copy that function into the app's
   source; do not import from `.udd/`. A row with no issue number shows "Received".
2. Statuses to show: Received, Looked into, Approved, In progress, Fix ready, Shipped,
   Verified in production, Waiting for the developer, Declined.
3. Retry any row without an issue number when the page opens (section 4, rule 7).
   - Check: the page shows the report from section 4 as "Received". Add the label `researched` to its issue by hand, reload: "Looked into".
   - If it fails: the GitHub read needs the same token; the same `UDD_GITHUB_TOKEN` works here.

## 6. Install workflows and scripts

1. `mkdir -p .github/workflows .udd/scripts scripts`
2. Copy `templates/workflows/*.yml` to `.github/workflows/`.
3. Copy `templates/scripts/udd/*.mjs` to `.udd/scripts/`. These are the only scripts to copy. Do not copy
   the `scripts/no-fly-check.mjs` in the kit root: it is a re-export stub for the kit's own tests and
   breaks outside the kit. Both `udd-fix.yml` and `udd-routine.yml` read `.udd/scripts/no-fly-check.mjs`.
4. Create `.udd/no-fly.txt` from the kit's template `templates/no-fly.txt` (one glob per line, the
   paths an agent may not change alone). Add `e2e/fixtures.ts` (section 7). Read it, then add the app's own sensitive paths that it lacks.
5. Routines are optional. Copy `templates/routines/*.md` to `.udd/routines/` only for the routines you want
   (`dead-code.md`, `duplicates.md`, `security.md`) and follow `ROUTINES.md`. A routine whose prompt is missing is skipped.
   - Check: `node --check .udd/scripts/*.mjs` is silent; `ls .github/workflows` shows `udd-research.yml udd-fix.yml udd-preview.yml udd-verify.yml udd-routine.yml`; `actionlint .github/workflows/udd-*.yml` passes if `actionlint` is installed.
   - Check: `printf '.udd/x.ts\0' | node .udd/scripts/no-fly-check.mjs -z .udd/no-fly.txt` exits non-zero (a protected path is refused). Run it as `... ; echo "exit=$?"`: it must not print `exit=0`.
   - If it fails: do not edit the workflows to make a check pass. They call files by these exact paths; fix the path you copied to. If the self-check exits 0, `.udd/no-fly.txt` is empty or wrong; copy the template again.
6. Tell the owner the loop needs the repository setting "Allow GitHub Actions to create and approve pull requests". Set it yourself:
   `gh api -X PUT repos/{owner}/{repo}/actions/permissions/workflow -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true`
   - Check: `gh api repos/{owner}/{repo}/actions/permissions/workflow` shows `can_approve_pull_request_reviews: true`.
   - If it fails: the organization may forbid it. Ask the owner to change it in Settings, Actions, General.

## 7. Playwright tests

The workflows run browser tests whose title or tag contains `@udd-<issue number>`. The fix loop is
"red on production, green on preview": the test must fail on the live site (`UDD_PROD_URL`), then
pass on the preview deployment of the fix.

1. If the app has no Playwright, add it as a dev dependency (the one allowed new dependency):
   `npm i -D @playwright/test`, then `npx playwright install chromium`. Add `e2e/`.
2. Create `playwright.config.ts`, a global setup and a fixtures file once, now. Together they must:
   - read the address from `PLAYWRIGHT_BASE_URL` (fall back to the local dev server);
   - log in the test account in the global setup and save the session with `storageState`; the
     credentials come from `UDD_TEST_USER_EMAIL` and `UDD_TEST_USER_PASSWORD`;
   - add the header `x-vercel-protection-bypass` (value `UDD_PREVIEW_BYPASS`) only to requests whose
     host equals `UDD_PREVIEW_HOST`, and send nothing when the secret is empty. Never put it in
     `use.extraHTTPHeaders`: that would send the secret to every host the page calls. The workflow sets
     `UDD_PREVIEW_HOST` to the host of the preview address it tests;
   - need no database for the check against production.

   Sketch (adapt the login to the app):

```ts
// playwright.config.ts
import { defineConfig } from "@playwright/test";
export default defineConfig({
  globalSetup: "./e2e/global-setup.ts", // signs in with UDD_TEST_USER_*, saves e2e/.auth/state.json
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    storageState: "e2e/.auth/state.json",
  },
});
// e2e/fixtures.ts: every test imports { test, expect } from here
import { test as base } from "@playwright/test";
const { UDD_PREVIEW_HOST: host, UDD_PREVIEW_BYPASS: secret } = process.env;
export const test = base.extend({
  context: async ({ context }, use) => {
    if (host && secret) await context.route((u) => u.host === host, (r) =>
      r.continue({ headers: { ...r.request().headers(), "x-vercel-protection-bypass": secret } }));
    await use(context);
  },
});
export { expect } from "@playwright/test";
```

   `playwright.config.*` and the global setup are no-fly paths (`templates/no-fly.txt`). Add the line
   `e2e/fixtures.ts` to `.udd/no-fly.txt` too (section 6). The agent cannot change these files later,
   so get them right now. Tell the owner that only a person edits them from here on.
3. `UDD_E2E_CMD` (default `npx playwright test`) must accept extra arguments, because the
   workflows append `--grep` and `--reporter=json`. A wrapper script that ignores arguments breaks them.
4. Add one smoke test `e2e/udd-smoke.spec.ts` that loads the home page. It has no `@udd-` tag, so it is never run as a fix check.
5. Test accounts: in tests, sign in only through the config's storage state or `process.env.UDD_TEST_USER_EMAIL` and `UDD_TEST_USER_PASSWORD`. Never write them in a file.
   - Check: `PLAYWRIGHT_BASE_URL=http://localhost:3000 npx playwright test --workers=2` passes with the app running, and the smoke test runs signed in.
   - If it fails: read the Playwright error. A missing browser means `npx playwright install chromium` did not run; a redirect to the login page means the global setup did not save the session.

## 8. Variables and secrets

Repository variables you set yourself (`gh variable set NAME --body VALUE`):
- `UDD_AGENT_ENABLED`: set `true` only at the very end (section 9).
- `UDD_INSTALL_CMD`: the install command from question 1, always the frozen-lockfile form: `npm ci`, `pnpm install --frozen-lockfile`, `yarn install --immutable` or `npm install -g bun && bun install --frozen-lockfile` (corepack, which the workflows enable, covers pnpm and yarn but not bun). The workflows run it with `bash -c`. Default `npm ci`; set it for every other manager.
- `UDD_TEST_CMD`: the app's unit test command for that manager (default `npm test`; for example `pnpm test`, `yarn test`, `bun test`).
- `UDD_E2E_CMD`: default `npx playwright test`.
- `UDD_TEST_GLOB`: which files count as tests (default `**/*.spec.ts,**/*.test.ts,e2e/**`).
- `UDD_PROD_URL`: the production address, only if question 4 was yes. The fix workflow runs the new test against it and must see it fail; `udd-verify.yml` runs it there again after the deploy.
- `UDD_PREVIEW_HOST_SUFFIX`: which preview addresses `udd-preview.yml` may test. It must start with a dot; an address is accepted only if it is https and its host ends with this suffix. Vercel: `.vercel.app` (or the project's custom preview domain, with a leading dot). Other hosts: the suffix of their preview addresses, for example `.netlify.app`. Without it the preview check tests nothing and says so in the run summary.
- `UDD_RESEARCH_DAILY_CAP`: how many issues the research workflow may look into per day, default 20. Research runs automatically on every new report, with no approval, so this cap is what limits how much of the owner's Claude subscription a flood of reports can use. Past the cap an issue is not researched and the run says so.

Secrets the **owner** enters. Tell the owner the name, where to get it, and the command. You never see or print the value:
- `CLAUDE_CODE_OAUTH_TOKEN`: run `claude setup-token` in their terminal (Claude Pro or Max), then `gh secret set CLAUDE_CODE_OAUTH_TOKEN`. An API key in `ANTHROPIC_API_KEY` works instead; then set a monthly spend limit on it.
- `UDD_TEST_USER_EMAIL` and `UDD_TEST_USER_PASSWORD`: the test account from question 4, set the same way.
- `UDD_PREVIEW_BYPASS` (optional, Vercel only): in Vercel open Project, Settings, Deployment Protection, Protection Bypass for Automation, create a secret, then `gh secret set UDD_PREVIEW_BYPASS`. Without it, previews behind Vercel's login page cannot be tested.
- `UDD_GITHUB_TOKEN` (section 4) goes into the app's own hosting environment variables, not into GitHub secrets and not into code.

### 8a. How the preview check starts

`udd-preview.yml` tests the fix branch `udd/fix-<n>` against its preview address. It starts
automatically: `udd-fix.yml` runs `gh workflow run udd-preview.yml -f issue=<n>` right after it creates the
draft PR, and Vercel's deployment events start it too.
- With no `url`, the workflow polls the GitHub deployments of the PR head commit (every 30 seconds, up to 20 minutes) until one succeeds in a non-production environment, and tests its address. The host must still end with `UDD_PREVIEW_HOST_SUFFIX`.
- By hand (`workflow_dispatch`), with no URL: `gh workflow run udd-preview.yml -f issue=<n>`. If the host does not report deployments to GitHub, pass the address: `gh workflow run udd-preview.yml -f url=<preview address> -f issue=<n>`.
- Production deployments start `udd-verify.yml` the same way, by hand: `gh workflow run udd-verify.yml -f url=<address>`.

Before a fix becomes a draft PR, a patch check (`templates/scripts/udd/patch-check.mjs`) requires exactly
one test tagged `@udd-<n>` and a change to app code, not only to tests. The red run on production is a signal,
not proof: the test is written by the agent. The guarantees are the patch check, the green run on the preview,
the draft PR and the owner's review.

Tell the owner the risk plainly: the tests are written by the agent and run against production and
preview under the test account. That account must hold no real data and no admin rights, and the
tests must touch only its own data.

- Check: `gh variable list` shows the variables; `gh secret list` shows the secret names (never values).
- If a secret is missing: stop and ask. Do not enable the loop until `CLAUDE_CODE_OAUTH_TOKEN` is listed and section 8b is done.

### 8b. Preview deployments run the agent's code (REQUIRED)

On Vercel every pushed `udd/fix-*` branch is built and deployed before anyone reviews it, so the
agent's code runs in the Preview environment with whatever that environment holds. Before you enable
the loop, the Preview environment must hold NO production secrets:
- a separate Supabase project for Preview (or only the anon key with RLS on), never the production database;
- no service-role key, no `UDD_GITHUB_TOKEN`, no payment or email keys scoped to Preview;
- the test account exists in the preview database, with no real data and no admin rights.

How to check: in Vercel open Project, Settings, Environment Variables, and read the Environments
column of every row. A secret that lists Preview (or "All Environments") is exposed; scope it to
Production only, or give Preview its own value. Other hosts: the same check in their settings.
- Check: no production secret in the Preview environment, and the test account can sign in on a preview deployment.
- If it fails: do not enable the loop. Ask the owner to rescope the variables, then check again.

## 9. Rules for the app's own agent

Append `templates/CLAUDE.md.snippet` to the app's `CLAUDE.md` (create it if absent). Do not
overwrite what is there.
- Check: `grep -c '@udd-' CLAUDE.md` prints 1 or more.
- If it fails: the snippet did not land; append it again.

## 10. Self-check, then switch on

Run each check. All six must pass.

1. Labels: 13 present (section 2).
2. Widget to issue: a real report from the browser creates an issue with the label `feedback` (section 4).
3. Escaping: a report containing `<img src=x onerror=1>` and `@someone` shows as text with no mention (read the issue body).
4. "My feedback" shows the report and moves to "Looked into" when `researched` is added (section 5).
5. Files: `.github/workflows/udd-*.yml`, `.udd/scripts/*.mjs` (seven files including `no-fly-check.mjs` and `patch-check.mjs`), `.udd/no-fly.txt` exist, a lockfile is committed, the no-fly self-check from section 6 exits non-zero, and `UDD_INSTALL_CMD` and `UDD_TEST_CMD` pass locally.
6. No secret value is in `git diff` (`git diff --stat` and a search of the diff for `ghp_`, `sk-`, `github_pat_` finds nothing).

- Check: all six items above pass.
- If one fails: go back to its section and use that section's "If it fails" line. Do not switch the loop on with a failing item.

Then: commit on `udd-setup` (`git add` only the files you created), set `UDD_AGENT_ENABLED=true`
with `gh variable set UDD_AGENT_ENABLED --body true`, and tell the owner to open a pull request
for the branch and merge it. Workflows only run from the default branch.

Tell the owner two limits plainly:
- Pull requests opened by the workflows use `GITHUB_TOKEN`, so the app's own CI does not run on them automatically (the preview check is a separate workflow and is not affected). Run CI by hand before merging, or configure a GitHub App token.
- In a public repository every user report becomes a public issue. Users must not report secrets or personal data. The agent's research comment is sanitized but still public. Security checks run only locally there (`ROUTINES.md` section 4).

Finish with a short report: what was installed, what the owner still has to do (secrets, merge,
deploy, the production test account), and the first thing to try: send a report from the app.
