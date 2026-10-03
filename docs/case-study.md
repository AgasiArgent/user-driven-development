# Case study: fourteen weeks of feedback-to-code

This is the history of the loop in one real system, anonymized. Dates are given as weeks: week 1 is the week of the first commit of generation 1.

The numbers come from four places: the dispatcher's state file, the product's git history, the production database (reporter counts), and the owner's working notes kept during the period (outage durations and incident details).

## Context

- **The system:** an internal B2B web application of a small team, in production, used by staff on the customer's side.
- **The reporters:** testers and staff on the customer's side — 30 reporter accounts (2 of them look like test accounts) and 589 pinned reports between weeks 3 and 14. They are known people, not the public.
- **The developer:** one owner-developer, working with coding agents (Claude Code, Codex, Cursor).
- **The tracker:** Linear. **The coding agent in the current loop:** Codex Cloud, started from the tracker.

## Four generations

| Generation | Weeks | What it did | Why it was replaced |
|---|---|---|---|
| 1. Early experiments | 1–2 | Two separate pieces. Five GitHub Actions workflows started a coding agent from GitHub Issues — but they fixed a separate chat application (the one that later hosted the generation-2 engine), not the product. A scheduled job ran an agent over the product's feedback table in read-only mode: it analysed, it did not change code. Both went quiet in week 2. | Neither connected feedback from the product to code changes in the product. The read-only logic moved into the next generation. |
| 2. Triage engine with a chat UI | 2–6 | A separate service received reports, ran research, and from week 3 created Linear issues automatically. Users talked to it in a chat UI. | The owner decided that Linear is the only place where bugs are worked on. The chat UI was retired in week 4. The engine itself was not replaced: it moved into the product repository in week 6 and is still the research step of generation 4. |
| 3. Manual cloud agent from Linear | 3–4 | A person mentioned the cloud coding agent in a Linear issue, and the agent tried to fix it. | The agent had no route to production and no way to open a PR, so its "PR prepared" comments did not correspond to real PRs: 0 of 5 checked had one. A second problem: the research step wrote the agent's trigger mention into 104 issue descriptions, and those started runs nobody asked for. |
| 4. Automated dispatcher | 4–14 (running) | From week 4: queue, research, human approval, cloud agent, draft PR, merge by a human or a separate session. Production verification was added in week 13; the red-first scenario and bounded rework in week 14. | — |

The full loop described in [concept.md](concept.md) has existed only since week 14. The numbers below were produced almost entirely by the shorter loop of weeks 4–13.

## Numbers

Outcomes of generation 4, one record per issue, weeks 4–14:

| Outcome | Issues |
|---|---|
| Marked shipped by the dispatcher | 121 (80 in combined "wave" PRs, 41 alone) |
| Draft PR opened, not marked shipped | 112 (44 still open, 65 closed without merge, 3 merged but not recorded as shipped) |
| Failed | 103 |
| Pending: dispatched, but no cloud task ever started | 56 |
| Agent made no changes | 53 |
| Abandoned | 20 |
| Other (grouped into another issue 6, not reproduced 4, scenario changed 3, blocked 1) | 14 |
| **Total issues dispatched** | **479** |

About one issue in four was marked shipped (121 of 479). "Shipped" here is the dispatcher's own record. Production verification, added at the end, has a last verdict for 55 issues: 53 green and 2 red.

31 of the 56 pending issues were dispatched during the longest outage. A failure while listing cloud tasks stopped the whole dispatcher run, and they were never picked up.

The three most common failure reasons:

| Reason | Issues |
|---|---|
| The cloud task never appeared within 24 hours | 41 |
| An existing PR for the issue was not an open draft against the main branch, so the dispatcher stopped | 36 |
| Caught in the `git add` outage and marked failed by hand when it ended | 13 |

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

The cloud environment explains part of this. It had no access to production, no browser to reproduce the report, and got 403 errors when it tried to open screenshots attached to the tracker issue. These problems are why the red-first scenario (principle [5](concept.md#5-red-first-scenario)) and the production check (principle [7](concept.md#7-done-means-verified-in-production)) were added at the end of the period. There is not enough data yet to say how much they change the outcomes.

## What worked

- **The durable queue.** During the two-day engine outage, 12 reports waited in the queue with a retryable status. After the engine came back, a manual drain delivered all 12 with no failures.
- **Moving the browser into its own container.** Page loads for scenarios failed with network errors in 20 of 52 attempts on the shared host and in 0 of 39 in a dedicated container.
- **Combining fixes into wave PRs.** 80 of the 121 shipped issues went out in combined PRs, merged and deployed by a separate session (principle [9](concept.md#9-merge-and-deploy-are-not-the-coding-agents-job)).

## Lessons

1. Put a queue between the form and everything else. → [1](concept.md#1-durable-feedback-queue)
2. Do not let agent-written text contain the word that starts another agent. → [2](concept.md#2-research-before-the-ticket), [3](concept.md#3-a-human-approves-before-coding)
3. A coding agent that cannot reproduce the problem produces plausible-looking PRs. Give it a way to reproduce it; the red-first scenario is this system's answer, and it is still new. → [5](concept.md#5-red-first-scenario)
4. "PR opened" is not progress for the reporter. Count only what runs in production. → [7](concept.md#7-done-means-verified-in-production)
5. Statuses that people use as a parking spot need exactly-once markers. → [8](concept.md#8-exactly-one-run-per-ticket)
6. Monitor the output of the loop, not its processes. The 12-day and the 2-day outages both produced no errors. → [10](concept.md#10-liveness-measured-by-progress-not-by-a-running-process)
7. Use a bot account from the first day. → [12](concept.md#12-the-bot-has-its-own-account)
