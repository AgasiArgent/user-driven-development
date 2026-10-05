# Full level: queue, research, Linear, Codex Cloud, production verification

A reference implementation of the whole loop from [the concept](concept.md), one module per principle. Every module is covered by tests against fakes (an in-memory tracker, a scripted coding agent, recorded shell commands). It needs your own server, a Linear workspace and Codex Cloud to run for real.

```text
widget → feedback_outbox ──intake──▶ research ──▶ Linear: Triage
                                                    │ a human adds "Scenario: …" and moves it to
                                                    ▼ Approved for fix
                     dispatch: claim once · no-fly label? · scenario fails in production?
                               Codex Cloud task → apply → no-fly paths → checks   (up to 3 rounds)
                               → draft PR · issue In Progress · reporter sees "in_progress"
                                                    │ a human merges and deploys
                                                    ▼
                     verify:   merged · deployed (/api/version) · CI green · scenario passes
                               → In Review · reporter sees "fixed"
                     liveness: alerts when reports or runs stop moving
```

## Modules

| Principle | Module (`full/src/`) | What it does |
|---|---|---|
| 1. Durable queue | `intake.ts` | Takes `received` rows with `SKIP LOCKED`; a tracker failure leaves the report queued, five failures mark it `delivery_failed`. |
| 2. Research before the ticket | `research.ts`, `model.ts` | Finds likely code (element text, selector classes, URL path; tests and the loop's own folders are skipped), a fingerprint for duplicates, and — with a model key — kind, summary and uncertainty. Duplicates become a comment on the open issue. |
| 3. Human approval | `dispatcher.ts` | Only issues in **Approved for fix** are taken. |
| 4. No-fly zones in code | `noFly.ts`, `.udd/no-fly.txt`, `.udd/no-fly-keywords.txt` | At research time: likely code in a no-fly path or a report word starting with a no-fly keyword → label `no-auto-fix`, which the dispatcher refuses. After the agent: changed files in no-fly paths → no PR. |
| 5. Red-first scenario | `scenario.ts` | The issue names a Playwright test (`Scenario: bug 3`); it must fail in production before the agent starts. |
| 6. Bounded rework | `dispatcher.ts` | Up to three agent rounds; each new round gets the previous failure output. Then a human. |
| 7. Verified in production | `verify.ts`, `demo/app/api/version` | **In Review** only when the PR is merged, its merge commit is in what production runs, CI on main is green and the scenario passes in production. |
| 8. Exactly one run | `store.ts`, table `dispatch_runs` | The issue id is the primary key; a second poll cannot start a second agent. A hand-back to Triage clears it, so a deliberate re-approval starts fresh. |
| 9. Agent stops at a draft PR | `agent/codexCloud.ts`, `git.ts` | The agent only produces a diff; the dispatcher applies it, runs checks, commits, pushes and opens a draft PR. |
| 10. Liveness by progress | `liveness.ts` | Alerts on a queue that is not moving, failed deliveries, and agent runs without a result for 24 h. Exit code 1 when there are alerts. |
| 11. Reporter sees status | `store.ts` | Report status follows the issue: `delivered` → `in_progress` → `fixed`. |
| 12. Bot account | setup below | Use separate Linear and GitHub accounts for the automation. |

## Set it up

1. **Linear.** In one team, create the states `Triage`, `Approved for fix`, `In Progress`, `In Review`, `Done`, `Canceled`, and the labels `feedback` and `no-auto-fix`. Create an API key **for a bot member**, not for yourself.
2. **GitHub.** Authenticate `gh` and git on the server as a bot account with push access; the dispatcher pushes `udd/<issue>` branches and opens draft PRs.
3. **Codex Cloud.** Create an environment for the repository, `codex login` on the server, note the environment id.
4. **Production.** Deploy with `GIT_SHA` set at build time (`GIT_SHA=$(git rev-parse HEAD) docker compose build`) so `/api/version` reports the running commit.
5. **Environment** for the loop:

   | Variable | Used by | Meaning |
   |---|---|---|
   | `DATABASE_URL` | all | The application database with `feedback_outbox` |
   | `LINEAR_API_KEY`, `LINEAR_TEAM_ID` | intake, dispatch, verify | Tracker access |
   | `CODEX_ENV_ID` | dispatch | Codex Cloud environment |
   | `PROD_URL` | dispatch, verify | Where scenarios run and `/api/version` is read |
   | `REPO_DIR` | all | A clone of this repository (default: this checkout) |
   | `ANTHROPIC_API_KEY`, `UDD_MODEL` | intake (optional) | Model for research; without it research still finds code and duplicates |
   | `PUBLIC_BASE_URL` | intake (optional) | Links screenshots from issues |
   | `UDD_CHECKS_DATABASE_URL` | dispatch, verify | **A throwaway database** for the checks. Install, tests and scenarios run code the agent wrote, with only this variable set — never the server's `DATABASE_URL`, API keys or tokens. It must differ from `DATABASE_URL`: the demo's tests truncate tables. |

6. **Run** each step on a schedule (cron or systemd):
   ```bash
   npm run loop -w full -- intake --watch 60
   npm run loop -w full -- dispatch --watch 60
   npm run loop -w full -- verify --watch 300
   npm run loop -w full -- liveness        # every 10 minutes; alert on exit code 1
   npm run loop -w full -- intake --dry-run  # see what research finds, without writing anything
   ```

## Isolation

Install, unit tests and Playwright scenarios run code the agent wrote. The dispatcher runs them with an almost empty environment (`PATH`, `HOME`, `LANG` and `UDD_CHECKS_DATABASE_URL` as `DATABASE_URL`), so they cannot read the application database or the loop's keys. They still run as the same operating-system user on the same machine. For production use, run the dispatcher in a container or a separate user account with nothing else on it.

A scenario that could not run at all (production unreachable, browser missing, unreadable output) never counts as a failing test: dispatch hands the issue back with that reason, and verify waits and tries again.

## What a human does

1. Reads a new issue in **Triage**: the report, the likely code, the uncertainty.
2. Adds a line `Scenario: <title of a Playwright test>` that describes the correct behavior — writing the test first if there is none — and moves the issue to **Approved for fix**.
3. Reviews the draft PR, merges and deploys it.
4. After the loop moves the issue to **In Review**, checks it and marks it **Done**.

## Not included

These existed in the original system and are left out of the reference to keep it small:

- an agent that writes the red-first scenario itself (here a human names it);
- combining several fixes into one "wave" PR;
- verifying a branch on a preview deployment before merge;
- notifications to reporters outside the app.

## Costs and caveats

- Every approved issue is up to three Codex Cloud tasks; with `ANTHROPIC_API_KEY`, every report is one model call.
- `agent/codexCloud.ts` reads the `codex cloud` CLI's text output, which can change between versions. It fails loudly when it cannot find a task id; check it against your version first.
- The loop has never been run here against live Linear and Codex Cloud; only the tests above. Start with one issue and watch each step.
