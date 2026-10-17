# SETUP.md: install the feedback loop (for the agent)

You are a coding agent working inside the owner's app. This file installs a loop: users report
a problem from the app, a GitHub issue appears, an agent looks into it, the owner approves, a
draft PR arrives with a test that fails before the fix and passes after it, and the fix is
checked on the live site.

Every step has three parts: what to do, how to check it worked, what to do if it did not.
Do the steps in order. Do not skip a check. Never print a secret value, and never put one in a
file you commit.

Other files: `ROUTINES.md` (weekly routines, optional), `WEEKLY.md` (the owner's weekly run),
`RULES.md` (the rules behind the loop, for people).

## 0. Preconditions

1. Get the kit next to the app, outside the app's folder:
   `git clone --depth 1 https://github.com/AgasiArgent/user-driven-development "$TMPDIR/udd-kit"`
   and call that folder `$KIT` from here on. Files below that start with `templates/`,
   `widget/`, `delivery/` or `demo/` are in `$KIT`.
   - Check: `ls "$KIT/templates/workflows"` lists four `udd-*.yml` files.
   - If it fails: ask the owner for network access or a copy of the kit.
2. Work on a new branch of the app: `git switch -c udd-setup`. Do not push to the default branch.
   - Check: `git branch --show-current` prints `udd-setup`.
3. Make sure `gh` is signed in with admin rights on the repository.
   - Check: `gh auth status` succeeds and `gh repo view --json viewerPermission -q .viewerPermission` prints `ADMIN`.
   - If it fails: ask the owner to run `gh auth login`. Without admin rights you cannot set labels, variables or secrets; stop and say so.

## 1. Ask six questions

Ask all six at once. State your guess for each, so the owner can just say "yes".

1. Which GitHub repository? Guess: `git remote get-url origin`.
2. Is there a database, and which (Supabase, Postgres, none)? Guess: look for `@supabase/supabase-js`, `pg`, `prisma` in `package.json`.
3. Where do screenshots go? Default: the app's own storage, behind login.
4. Is there a test account in production for checks after deploy? If not, the production check stays off and the rest works.
5. How is the app deployed (Vercel, Netlify, other)? It decides how `udd-verify.yml` starts.
6. Is the repository public or private? `gh repo view --json isPrivate -q .isPrivate`. It decides the security routine (`ROUTINES.md` section 4).

- Check: you have six answers. Write them down in your notes, not in a file in the repo.
- If an answer is "I don't know": use the default, say which one you took, and go on.

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

1. Copy `widget/src/` into the app as a folder (for example `feedback-widget/`). Read
   `widget/src/index.ts` first: it shows the one script tag the widget needs. `widget/build.mjs` and
   `widget/tsconfig.json` show how the kit bundles it. The widget has no runtime dependency; use the
   app's existing bundler, or `esbuild` if it is already installed. Add no new npm dependency.
2. Load the built script on every page for a signed-in user, with
   `data-endpoint="/api/feedback"` (change the route name if the stack wants another) and
   `data-user` set to the signed-in user's id.
   - Check: open the app in a browser. The button shows on a page, and clicking an element highlights it.
   - If it fails: open the console. A warning `data-endpoint is missing` means the script tag lost its attribute.
3. Hints by stack:
   - Next.js (App Router): put the script in `app/layout.tsx` with `next/script` (`strategy="afterInteractive"`), only when a user is signed in. Put the built file in `public/`.
   - Vite + Express: build the widget to `dist` or `public/`, add the script tag to `index.html`, set `data-user` after login from the client.
   - Other: any page template that every signed-in page shares.

## 4. Add the intake route

The route receives a report and creates the issue. Pattern: `demo/lib/feedback.ts` (limits, JSON
checks) and `delivery/src/issueBody.ts` (issue text). Copy the logic, not the demo's lack of auth.

Rules for the route (all are required):
1. Only a signed-in user may call it. Return 401 otherwise.
2. Rate limit per user (for example 10 reports per hour). Return 429 over the limit.
3. Body limit 3 MB. Return 413 over it.
4. Store the report in `feedback_reports` (section 4a) with status `received`. Store the screenshot in the storage from question 3, behind login. Never a public link.
5. Create the issue with the GitHub REST API: `POST /repos/{owner}/{repo}/issues`, label `feedback`. The GitHub token lives only on the server, with the permission "Issues: write" and nothing else (a fine-grained token limited to this repository).
6. Build title and body with the rules of `renderIssue` in `delivery/src/issueBody.ts`: `&`, `<`, `>` escaped; a zero-width space after every `@`; the body cut to `MAX_BODY` (65,000 characters) with `> _(truncated)_`; the user's text quoted with `>`.
7. If GitHub fails, keep the row as `received`, answer 202, and retry on the next call to the route and when the "My feedback" page opens. Set `issue_number` when the retry succeeds.
8. With no database (question 2): create the issue directly and tell the owner a report can be lost if GitHub is down.

- Check: sign in, send a report from the widget. `gh issue list --label feedback` shows a new issue, its body has no raw `<` and no `@` followed directly by a letter.
- Check: call the route without signing in. It answers 401.
- Check (retry): set a wrong GitHub token for one local run and send a report. The row stays `received`; with the right token the next call creates the issue.
- If it fails: read the route's server log. A 403 from GitHub means the token lacks "Issues: write" or is for another repository.

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
   - If it fails: the GitHub read needs the same token; "Issues: read" is enough here.

## 6. Install workflows and scripts

1. `mkdir -p .github/workflows .udd/scripts scripts`
2. Copy `templates/workflows/*.yml` to `.github/workflows/`.
3. Copy `templates/scripts/udd/*.mjs` to `.udd/scripts/`.
4. Copy `scripts/no-fly-check.mjs` from the kit root to **both** `scripts/no-fly-check.mjs` and
   `.udd/scripts/no-fly-check.mjs` (`udd-fix.yml` reads the first, `udd-routine.yml` the second).
5. Create `.udd/no-fly.txt`: one glob per line, the paths an agent may not change alone. Start
   from the kit's `.udd/no-fly.txt` and replace its project paths with the app's:
   keep `.github/**`, `.udd/**`, `scripts/**`; add database migrations, auth code, the intake route,
   the widget's masking code, `package.json` and the lock file, and the payment code if there is any.
   Copy `.udd/no-fly-keywords.txt` and `.udd/research-ignore.txt` from the kit if they exist.
6. Optional: copy `templates/routines/*.md` to `.udd/routines/` and follow `ROUTINES.md` to turn the routines on.
   - Check: `node --check .udd/scripts/*.mjs` is silent; `ls .github/workflows` shows `udd-research.yml udd-fix.yml udd-verify.yml udd-routine.yml`; `actionlint .github/workflows/udd-*.yml` passes if `actionlint` is installed.
   - If it fails: do not edit the workflows to make a check pass. They call files by these exact paths; fix the path you copied to.
7. Tell the owner the loop needs the repository setting "Allow GitHub Actions to create and approve pull requests". Set it yourself:
   `gh api -X PUT repos/{owner}/{repo}/actions/permissions/workflow -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true`
   - Check: `gh api repos/{owner}/{repo}/actions/permissions/workflow` shows `can_approve_pull_request_reviews: true`.
   - If it fails: the organization may forbid it. Ask the owner to change it in Settings, Actions, General.

## 7. Playwright tests

The fix and verify workflows run browser tests whose title or tag contains `@udd-<issue number>`.

1. If the app has no Playwright, add it as a dev dependency (the one allowed new dependency):
   `npm i -D @playwright/test`, then `npx playwright install chromium`. Add `e2e/` and a `playwright.config.ts`.
   The config must read the address from `PLAYWRIGHT_BASE_URL` (fall back to the local dev server)
   and need no database for the check against production.
2. `UDD_E2E_CMD` (default `npx playwright test`) must accept extra arguments, because the
   workflows append `--grep` and `--reporter=json`. A wrapper script that ignores arguments breaks them.
3. Add one smoke test `e2e/udd-smoke.spec.ts` that loads the home page. It has no `@udd-` tag, so it is never run as a fix check.
4. Test accounts: in tests, sign in only with `process.env.UDD_TEST_USER_EMAIL` and `UDD_TEST_USER_PASSWORD`. Never write them in a file.
   - Check: `PLAYWRIGHT_BASE_URL=http://localhost:3000 npx playwright test --workers=2` passes with the app running.
   - If it fails: read the Playwright error. A missing browser means `npx playwright install chromium` did not run.

## 8. Variables and secrets

Repository variables you set yourself (`gh variable set NAME --body VALUE`):
- `UDD_AGENT_ENABLED`: set `true` only at the very end (section 9).
- `UDD_TEST_CMD`: the app's unit test command (default `npm test`).
- `UDD_E2E_CMD`: default `npx playwright test`.
- `UDD_TEST_GLOB`: which files count as tests (default `**/*.spec.ts,**/*.test.ts,e2e/**`).
- `UDD_PROD_URL`: the production address, only if question 4 was yes.

Secrets the **owner** enters. Tell the owner the name, where to get it, and the command. You never see or print the value:
- `CLAUDE_CODE_OAUTH_TOKEN`: run `claude setup-token` in their terminal (Claude Pro or Max), then `gh secret set CLAUDE_CODE_OAUTH_TOKEN`.
- `UDD_TEST_USER_EMAIL` and `UDD_TEST_USER_PASSWORD`: the production test account from question 4, set the same way.
- The server-side GitHub token of section 4 goes into the app's own host settings, not into GitHub secrets.

- Check: `gh variable list` shows the variables; `gh secret list` shows the secret names (never values).
- If a secret is missing: stop and ask. Do not enable the loop until `CLAUDE_CODE_OAUTH_TOKEN` is listed.

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
5. Files: `.github/workflows/udd-*.yml`, `.udd/scripts/*.mjs` (six files including `no-fly-check.mjs`), `.udd/no-fly.txt` exist, and `UDD_TEST_CMD` passes locally.
6. No secret value is in `git diff` (`git diff --stat` and a search of the diff for `ghp_`, `sk-`, `github_pat_` finds nothing).

- Check: all six items above pass.
- If one fails: go back to its section and use that section's "If it fails" line. Do not switch the loop on with a failing item.

Then: commit on `udd-setup` (`git add` only the files you created), set `UDD_AGENT_ENABLED=true`
with `gh variable set UDD_AGENT_ENABLED --body true`, and tell the owner to open a pull request
for the branch and merge it. Workflows only run from the default branch.

Finish with a short report: what was installed, what the owner still has to do (secrets, merge,
deploy, the production test account), and the first thing to try: send a report from the app.
