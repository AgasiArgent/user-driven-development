# Templates reference

What each file in `templates/` does, and the settings it reads. Your agent installs these by following [SETUP.md](../SETUP.md); read this page when you want to know what it put in your repository, or to change something by hand.

```text
widget -> your database -> delivery -> GitHub issue (label: feedback)
                                         | udd-research.yml comments
                                         | you add "approved"
                                         v
                          udd-fix.yml: test must fail on production, fix,
                          up to 3 attempts, no-fly check, draft PR
                                         | preview deployment of the fix
                                         v
                          udd-preview.yml: same test passes (label: fix-ready)
                                         | you merge and deploy
                                         v
                          udd-verify.yml: the same test runs in production
                          issue closed, label: verified
```

## Workflows

| File | Runs when | What it does |
|---|---|---|
| `templates/workflows/udd-research.yml` | An issue with `feedback` is opened or labelled | The agent reads the report and the code with read-only tools and writes a comment: likely files, duplicates, open questions. Its output is cleaned before it is posted. |
| `templates/workflows/udd-fix.yml` | A person adds `approved` to an issue that has `feedback` | Job kinds: **guard** decides and marks the issue `in-progress`. **agent-N** holds the model token and edits files; it installs nothing and runs nothing, and it must add one test tagged `@udd-<issue number>`. **red-N** has no model token and no write token: it applies only the test files of the patch to the base commit and runs the test against `UDD_PROD_URL`, where it must fail. Up to three attempts. **verdict-N** reads the red report with the trusted `red-first.mjs` and runs the patch check (exactly one test tagged `@udd-<n>` and a change to app code) to decide whether another attempt is needed. **publish** runs no project code: it checks the patch hash, repeats both decisions with copies of the trusted scripts, checks no-fly zones, and opens a draft PR; the label stays `in-progress` until the preview check passes. |
| `templates/workflows/udd-preview.yml` | `udd-fix.yml` starts it automatically (workflow dispatch with `issue`) after it creates the draft PR; a non-production deployment succeeding (Vercel reports these to GitHub by itself) also starts it; or by hand with `issue` and, optionally, `url` | Without a `url` it polls the GitHub deployments of the PR head commit every 30 seconds for up to 20 minutes and uses the address of the first successful non-production one. Finds the `udd/fix-<n>` pull request that owns the deployed commit, runs its tagged test against the preview address under the test account, and the trusted checker decides. A pass labels the issue `fix-ready`; a failure labels it `needs-human`. The address must be https and its host must end with `UDD_PREVIEW_HOST_SUFFIX`. `UDD_PREVIEW_BYPASS` reaches the test as an environment variable together with `UDD_PREVIEW_HOST`; the Playwright fixtures send it as `x-vercel-protection-bypass` only to that host. No model is involved. |
| `templates/workflows/udd-verify.yml` | A production deployment succeeds, or by hand | Runs the tagged tests of shipped issues against `UDD_PROD_URL`. A pass labels the issue `verified` and closes it. A failure reopens it, labels it `needs-human` and removes `shipped`. If the fix is not deployed yet, the issue is skipped. |
| `templates/workflows/udd-routine.yml` | Weekly, or by hand | Runs the routines in [ROUTINES.md](../ROUTINES.md). |

## Scripts

| File | What it decides |
|---|---|
| `templates/scripts/udd/red-first.mjs` | Whether a Playwright report shows the tagged test failing on the base and passing on the fix. A retry that passes counts as a pass. |
| `templates/scripts/udd/patch-check.mjs` | Whether a patch has exactly one added test tagged `@udd-<n>` and a change outside the test files. |
| `templates/scripts/udd/verify-plan.mjs` | Which issues to verify after a deploy, and what to do with the result. |
| `templates/scripts/udd/routine-guard.mjs` | Whether a routine may run (one open item at most) and which findings are new. |
| `templates/scripts/udd/sanitize.mjs` | Cleans agent and reporter text: HTML is escaped and each `@` gets a zero-width space, so text can neither ping people nor wake a bot. The issue body is cut at 65,000 characters. |
| `templates/scripts/udd/status.mjs` | Maps issue labels to the status the reporter sees. |
| `templates/scripts/udd/no-fly-check.mjs` | Fails if a patch touches a path that matches a glob in `.udd/no-fly.txt`. It matches file paths only, never file contents. Rename detection is off, so moving a protected file is caught. |

## Settings

Labels (exact names): `feedback`, `researched`, `approved`, `in-progress`, `fix-ready`, `shipped`, `verified`, `needs-human`, `routine`, `routine:dead-code`, `routine:duplicates`, `routine:security`, `security`.

Repository variables:

| Name | Default | Meaning |
|---|---|---|
| `UDD_AGENT_ENABLED` | off | `true` turns the agent workflows on. |
| `UDD_INSTALL_CMD` | `npm ci` | Install command, frozen-lockfile form for your package manager (`pnpm install --frozen-lockfile`, `yarn install --immutable`, `npm install -g bun && bun install --frozen-lockfile`; corepack is enabled for pnpm and yarn). Run with `bash -c`. |
| `UDD_TEST_CMD` | `npm test` | Unit tests. |
| `UDD_E2E_CMD` | `npx playwright test` | Browser tests. |
| `UDD_TEST_GLOB` | `**/*.spec.ts,**/*.test.ts,e2e/**` | Which paths count as tests. Only changes to these are kept on the base when checking that the test fails first. |
| `UDD_PREVIEW_HOST_SUFFIX` | none | Allowed suffix of preview hosts, starting with a dot (Vercel: `.vercel.app`). Without it `udd-preview.yml` tests nothing. |
| `UDD_RESEARCH_DAILY_CAP` | `20` | Most issues researched per day. Research runs automatically on every report, so this limits subscription use. |
| `UDD_PROD_URL` | none | Production address: the fix test must fail there, and `udd-verify.yml` checks it after the deploy. Without it the workflows stop. |

Secrets: `UDD_PREVIEW_BYPASS` (optional, Vercel Protection Bypass for Automation), `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`, uses your subscription), `UDD_TEST_USER_EMAIL`, `UDD_TEST_USER_PASSWORD`. `ANTHROPIC_API_KEY` works as an alternative to the token; if you use it, set a monthly spend limit on the key in the Anthropic console.

## Widget

```html
<script src="/widget.js" data-endpoint="/api/feedback" data-user="alice" defer></script>
```

- `widget.js` is one file with no framework, about 290 KB, most of it the screenshot library. Build it with `npm ci && npm run build:widget`; it lands in `widget/dist/widget.js`.
- `data-endpoint` is where reports are sent. Your backend accepts the body described in [`contracts/feedback-report.schema.json`](../contracts/feedback-report.schema.json) and answers `201 {"id": "...", "status": "received"}`. The demo's implementation is [`demo/lib/feedback.ts`](../demo/lib/feedback.ts).
- `data-user` is optional and is passed through as is.
- Each report carries the comment, the pinned element (CSS selector, tag, text, position), a screenshot, and the page context: URL, window size, browser, the last 20 console errors and the last 20 failed requests (method, URL without query string, status, no bodies).
- Add `data-feedback-mask` to anything that shows personal data: it is painted black on the screenshot. Password fields are always masked.

## Delivery

`delivery/` moves reports with status `received` from the `feedback_outbox` table into GitHub Issues, with retries, and mirrors issue state back so the reporter sees it under **My feedback**.

```bash
export DATABASE_URL=postgres://udd:udd@localhost:55432/udd
export GITHUB_REPOSITORY=you/your-repo
export GITHUB_TOKEN=...            # issues: read and write
export PUBLIC_BASE_URL=https://your-app.example   # optional: links screenshots from the issue
npm run deliver -w delivery -- --dry-run          # prints the issues it would create
npm run deliver -w delivery -- --watch 60         # delivers and syncs every minute
```

## Limits to know

- **PRs opened with the workflow's `GITHUB_TOKEN` do not start other workflows**, so CI does not run on them automatically. Push an empty commit, or use a GitHub App token for the PR step.
- **Your approval is the main defence** against a report that tries to steer the agent. Read the issue before you add `approved`. See the [threat model](threat-model.md).
- The no-fly check does not stop the agent from reading protected files, only from changing them.
- **Screenshots in public issues are public.** With `PUBLIC_BASE_URL` set, every issue links to `/api/feedback/FB-<n>/screenshot`, which has no authentication and uses sequential ids. In a public repository, leave `PUBLIC_BASE_URL` unset or put that route behind your app's login.
- The agent has no shell, so it cannot run tests itself; the workflow runs them after it.
- Vercel's GitHub environment name for production is not documented, and Netlify's `deployment_status` behaviour is unverified. `udd-verify.yml` can always be started by hand as a fallback.
