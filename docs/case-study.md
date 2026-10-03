# Case study: fourteen weeks of feedback-to-code

This is the history of the loop in one real system, anonymized. Dates are given as weeks from the start (week 1 is the week of the first commit). All numbers come from the system's own state files and git history as of week 14.

## Context

- **The system:** an internal B2B web application of a small team, in production, used daily by staff on the customer's side.
- **The reporters:** testers and staff on the customer's side — 30 reporter accounts, 589 pinned reports over the period. They are known people, not the public.
- **The developer:** one owner-developer, working with coding agents (Claude Code, Codex, Cursor).
- **The tracker:** Linear. **The coding agent in the current loop:** Codex Cloud, started from the tracker.

## Four generations

| Generation | Weeks | What it did | Why it was replaced |
|---|---|---|---|
| 1. Early experiments | 1–2 | Two separate pieces. A GitHub Actions workflow started a coding agent from GitHub Issues — but it fixed the UI of the triage tool itself, not the product. A scheduled job ran an agent over the product's feedback table in read-only mode: it analysed, it did not change code. | Neither connected feedback from the product to code changes in the product. The read-only logic moved into the next generation. |
| 2. Triage engine with a chat UI | 2–6 | A separate service received reports, ran research, and from week 3 created Linear issues automatically. Users talked to it in a chat UI. | The owner decided that Linear is the only place where bugs are worked on. The chat UI was retired in week 4; the engine moved into the product repository in week 6. |
| 3. Manual cloud agent from Linear | 3–4 | A person mentioned the cloud coding agent in a Linear issue, and the agent tried to fix it. | The agent had no route to production and no way to open a PR, so its "PR prepared" comments did not correspond to real PRs: 0 of 5 checked had one. A second problem: the research step wrote the agent's trigger mention into 104 issue descriptions, and those started runs nobody asked for. |
| 4. Automated dispatcher | 4–14 (running) | The loop described in [concept.md](concept.md): queue, research, human approval, red-first scenario, cloud agent, draft PR, merge by a human or a separate session, verification in production. | — |

## Numbers

Outcomes of the current generation, one record per issue, weeks 4–14:

| Outcome | Issues |
|---|---|
| Shipped to production | 121 (80 in combined "wave" PRs, 41 alone) |
| Draft PR opened, not shipped | 112 (44 still open, 65 closed without merge, 3 merged outside the loop) |
| Failed | 103 |
| Waiting in the queue | 56 (31 of them stuck since the longest outage) |
| Agent made no changes | 53 |
| Abandoned | 20 |
| Other (grouped as duplicate 6, not reproduced 4, scenario changed 3, blocked 1) | 14 |
| **Total issues dispatched** | **479** |

About one issue in four reached production (121 of 479).

The three most common failure reasons:

| Reason | Issues |
|---|---|
| The cloud task never appeared within 24 hours | 41 |
| The PR did not match the expected open draft on the main branch | 36 |
| Lost to the `git add` outage (see below) and marked failed by hand | 13 |

Production verification (principle [7](concept.md#7-done-means-verified-in-production)) was switched on in week 14. Since then it returned 53 green verdicts and 2 red.

## What broke

| What happened | How long | Principle it led to |
|---|---|---|
| A bug in an exclude pattern of the `git add` step stopped PR publishing. No PRs were published, and nothing reported an error. | 12 days | [10](concept.md#10-liveness-measured-by-progress-not-by-a-running-process) |
| A liveness check looked at the wrong table, decided the engine was dead, and killed it. The dispatcher kept running every minute without errors and dispatched nothing. | about 2 days | [10](concept.md#10-liveness-measured-by-progress-not-by-a-running-process) |
| A tunnel in front of the agent host stripped a path prefix, so report delivery got 404 responses. | about 1 day | [1](concept.md#1-durable-feedback-queue) |
| The tracker's API quota ran out — twice. | under a day the first time | [10](concept.md#10-liveness-measured-by-progress-not-by-a-running-process) |
| The model provider refused new sessions for the research step. | almost 6 days | [10](concept.md#10-liveness-measured-by-progress-not-by-a-running-process) |
| Opening a draft PR moved the issue to *In Review*, so reporters were asked to check fixes that had not shipped. | first 3 days of generation 4 | [7](concept.md#7-done-means-verified-in-production) |
| People left issues sitting in *Approved for fix*, and each poll of the tracker saw them again, starting duplicate runs. | a standing problem, not an outage | [8](concept.md#8-exactly-one-run-per-ticket) |

## Quality of cloud-agent PRs

The bad PRs took three recurring shapes:

1. **Only a test changed.** The agent edited or added a test and left the code alone.
2. **The wrong component edited.** The change was real but in a different place from the one in the report.
3. **The symptom hidden.** The visible error disappeared; the cause stayed.

The cloud environment explains part of this. It had no access to production, no browser to reproduce the report, and got 403 errors on the tracker's attachments — so it never saw the screenshot. This is why the current loop writes a failing browser scenario before the agent runs (principle [5](concept.md#5-red-first-scenario)) and checks the result in production after (principle [7](concept.md#7-done-means-verified-in-production)).

## What worked

- **The durable queue.** During the two-day engine outage, 12 reports waited in the queue with a retryable status. After the engine came back, a manual drain delivered all 12 with no failures.
- **Moving the browser into its own container.** Page loads for scenarios failed with network errors in 20 of 52 runs on the shared host and in 0 of 39 runs in a dedicated container.
- **Combining fixes into wave PRs.** 80 of the 121 shipped issues went out in combined PRs, merged and deployed by a separate session (principle [9](concept.md#9-merge-and-deploy-are-not-the-coding-agents-job)).

## Lessons

1. Put a queue between the form and everything else. → [1](concept.md#1-durable-feedback-queue)
2. Do not let agent-written text contain the word that starts another agent. → [2](concept.md#2-research-before-the-ticket), [3](concept.md#3-a-human-approves-before-coding)
3. A coding agent without a way to reproduce the problem produces plausible-looking PRs. Give it a failing scenario. → [5](concept.md#5-red-first-scenario)
4. "PR opened" is not progress for the reporter. Count only what runs in production. → [7](concept.md#7-done-means-verified-in-production)
5. Statuses that people use as a parking spot need exactly-once markers. → [8](concept.md#8-exactly-one-run-per-ticket)
6. Monitor the output of the loop, not its processes. The two worst outages produced no errors. → [10](concept.md#10-liveness-measured-by-progress-not-by-a-running-process)
7. Use a bot account from the first day. → [12](concept.md#12-the-bot-has-its-own-account)
