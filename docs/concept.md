# The loop and its principles

User-driven development is a loop in which a user's feedback about a running application becomes a code change, with a human deciding what gets built and production deciding what counts as done.

```text
User pins feedback in the app
  → durable queue
  → agent researches the report and files an issue        (Triage)
  → a human approves it                                    (Approved for fix)
  → a failing browser scenario is written first
  → a cloud coding agent opens a draft PR, up to 3 rounds
  → a human (or a separate session) merges and deploys
  → the scenario is re-run in production                   (In Review)
  → the reporter checks it                                 (Done, or back to In Progress)
```

Most principles below exist because the system broke without them; where it did, the linked section of the [case study](case-study.md) describes what happened. The rest are design choices made for the same loop.

## 1. Durable feedback queue

**What.** A report is first written to a queue table in the application's own database and gets an ID right away. Delivery to the agents is a separate, retried step.

**Why.** The application, the network path and the agent host fail independently. With a queue in between, a failure delays a report instead of losing it. See [What worked](case-study.md#what-worked).

## 2. Research before the ticket

**What.** Before any issue exists, an agent classifies the report, groups duplicates, points to the likely code, and writes down what it is unsure about. The issue is created only after that, and it keeps the reporter's original text and screenshot.

**Why.** A raw report is rarely enough for a coding agent, and a human approving it needs to see what the change would touch. Writing the research into the issue makes the approval an informed decision.

## 3. A human approves before coding

**What.** Moving an issue to *Approved for fix* is the only way to start a coding agent. Nothing reaches the coding step from the feedback form directly.

**Why.** Report text is untrusted input to an agent (see the [threat model](threat-model.md)), and coding runs cost money. Approval is where both are controlled.

## 4. No-fly zones enforced in code

**What.** Some areas are never fixed automatically — for example money calculations and access rights. This is checked in code before any coding starts (in the original system, in the research step); it is not a sentence in the agent's prompt.

**Why.** A prompt instruction can be ignored or overridden by the report text. A check in code cannot.

## 5. Red-first scenario

**What.** Before the fix, a browser scenario is written that reproduces the problem, and it is run against production to prove that it fails there.

**Why.** Without a failing scenario there is no way to tell a real fix from a change that only looks like one. See [Quality of cloud-agent PRs](case-study.md#quality-of-cloud-agent-prs).

## 6. Bounded rework (max 3 rounds)

**What.** If checks fail, the coding agent gets the feedback and tries again — at most three times. After that, the issue goes to a human.

**Why.** Every round costs money and reviewer attention. A fixed limit makes the worst-case cost of one issue known in advance.

## 7. "Done" means verified in production

**What.** An issue moves to *In Review* only when the change is merged, the merge commit is running in production, CI on the main branch is green, and the scenario passes in production. A draft PR is not a result.

**Why.** For a while, opening a draft PR moved the issue forward. Reporters were asked to check fixes that had not shipped. See [What broke](case-study.md#what-broke).

## 8. Exactly one run per ticket

**What.** The dispatcher uses a lock and per-issue markers so that polling the tracker again never starts a second coding run for the same issue.

**Why.** People leave issues sitting in the approval status, and every poll sees them again. Without markers, that becomes duplicate runs and duplicate PRs.

## 9. Merge and deploy are not the coding agent's job

**What.** The coding agent stops at a draft PR. Merging and deploying are done by a human or by a separate session that can combine several fixes into one PR.

**Why.** The coding agent works without access to production. The step that changes production should be done by someone who can see it.

## 10. Liveness measured by progress, not by a running process

**What.** Monitoring checks that issues actually move through the loop — reports become issues, approved issues become PRs — not only that a process is running.

**Why.** The longest outage in the case study was silent: the processes were running, and no PR came out of them. See [What broke](case-study.md#what-broke).

## 11. The reporter sees the status

**What.** The person who sent feedback can see its status inside the application, from "received" to "shipped".

**Why.** Without it, the only way for a reporter to learn what happened to their feedback is to ask the owner.

## 12. The bot has its own account

**What.** Comments, status changes and PRs made by the automation come from a dedicated bot account with only the permissions it needs.

**Why.** In the original system the automations ran under the owner's personal tracker key. Nothing showed which actions were automated, and the automations had the owner's permissions.
