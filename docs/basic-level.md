# Basic level: GitHub Issues + Actions

The smallest version of the loop that runs from a fork. It covers principles 1, 3, 4, 8, 9 and 11 of [the concept](concept.md); the red-first scenario, rework rounds and production verification are in the full level.

```text
widget → feedback_outbox → delivery → GitHub Issue (label: feedback)
                                         │ a human adds the label "approved"
                                         ▼
                         GitHub Actions: udd-fix.yml
                           coding agent edits files (Claude Code)
                           no-fly check · unit tests · draft PR
                                         │ a human reviews, merges, deploys
                                         ▼
                         issue closed → reporter sees "done" in the app
```

## What each piece does

| Piece | Where | What it does |
|---|---|---|
| Delivery | `delivery/` | Moves reports with status `received` from `feedback_outbox` into GitHub Issues, with retries; mirrors issue state back (`approved`, `in_progress`, `done`, `rejected`) so the reporter sees it under **My feedback**. |
| Issue text | `delivery/src/issueBody.ts` | Report text is untrusted: HTML is escaped and every `@` gets a zero-width space, so feedback can neither ping people nor wake up bots. |
| Agent workflow | `.github/workflows/udd-fix.yml` | Runs only when a person (not a bot) adds `approved` to an issue labelled `feedback`, once per issue. Three jobs: **guard** decides; **agent** edits files with a read-only token and no shell, then the tests run without secrets; **publish** applies the saved patch, checks no-fly zones with a copy of the checker taken from `main`, and opens a **draft** PR. Code written by the agent never runs next to a write token. |
| No-fly zones | `.udd/no-fly.txt`, `scripts/no-fly-check.mjs` | Paths the agent may not change. If it does, no PR is opened and the issue gets a comment. |

## Turn it on in your fork

It is off by default, so a fork never spends money by accident.

1. **Labels.** Create them once:
   ```bash
   gh label create feedback --color 1d76db
   gh label create approved --color 0e8a16
   gh label create agent-pr --color 5319e7
   ```
2. **Model key.** Add one repository secret: `ANTHROPIC_API_KEY` (pay per use) or `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`, uses a Claude subscription).
3. **Switch.** Add the repository variable `UDD_AGENT_ENABLED` = `true`.
4. **Delivery.** Run it next to your app with a token that can write issues (a fine-grained token with *Issues: read and write* on this repository):
   ```bash
   export DATABASE_URL=postgres://udd:udd@localhost:55432/udd
   export GITHUB_REPOSITORY=you/your-fork
   export GITHUB_TOKEN=...            # issues: read and write
   export PUBLIC_BASE_URL=https://your-app.example   # optional: links screenshots from the issue
   npm run deliver -w delivery -- --dry-run          # prints the issues it would create
   npm run deliver -w delivery -- --watch 60         # delivers and syncs every minute
   ```

Then send feedback in the demo, add `approved` to the issue that appears, and watch the **Actions** tab.

## What it costs

Each approved issue is one agent run, capped at 30 turns. With an API key you pay per token; with a subscription token it counts against your plan's limits. Nothing runs before a human adds `approved`.

## Limits you should know

- **PRs opened with the workflow's `GITHUB_TOKEN` do not start other workflows**, so CI does not run on them automatically. Push an empty commit, or use a GitHub App token for the PR step if you need checks to run.
- **The agent cannot reproduce the problem in a browser** and nothing checks the fix in production. That is what the full level adds.
- **The approval is the main defence** against a report that tries to steer the agent. Read the issue before you add `approved`. See the [threat model](threat-model.md).
- The no-fly check runs on the patch that will be committed, with rename detection off, so moving a protected file is caught. It does not stop the agent from reading those files.
- **Screenshots in public issues are public.** With `PUBLIC_BASE_URL` set, every issue links to `/api/feedback/FB-<n>/screenshot`, which has no authentication and sequential ids. In a public fork, leave `PUBLIC_BASE_URL` unset or put that route behind your app's login.
- The agent has no shell, so it cannot run tests itself; the workflow runs them after it, and the result goes into the PR description.
- With `ANTHROPIC_API_KEY`, set a monthly spend limit on the key in the Anthropic console.
