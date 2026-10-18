# The loop and its principles

The rules now live in [RULES.md](../RULES.md). Each one has the failure that led to it and the file in this kit that enforces it. This page keeps the list of titles so that links from the [case study](case-study.md) still work.

```text
User pins feedback in the app
  → durable queue
  → agent researches the report and files an issue
  → a human approves it
  → a failing test is written first
  → a coding agent opens a draft PR, up to 3 attempts
  → a human merges and deploys
  → the same test is re-run in production
  → the reporter sees "verified"
```

## 1. Durable feedback queue

See [RULES.md, rule 1](../RULES.md#1-put-a-queue-between-the-form-and-everything-else).

## 2. Research before the ticket

See [RULES.md, rule 2](../RULES.md#2-research-before-the-issue-and-keep-agent-text-harmless).

## 3. A human approves before coding

See [RULES.md, rule 3](../RULES.md#3-a-person-approves-before-any-code-is-written).

## 4. No-fly zones enforced in code

See [RULES.md, rule 4](../RULES.md#4-no-fly-zones-are-checked-by-code).

## 5. Red-first scenario

See [RULES.md, rule 5](../RULES.md#5-write-the-failing-test-first).

## 6. Bounded rework (max 3 rounds)

See [RULES.md, rule 6](../RULES.md#6-three-attempts-then-a-person).

## 7. "Done" means verified in production

See [RULES.md, rule 7](../RULES.md#7-done-means-it-passes-in-production).

## 8. Exactly one run per ticket

See [RULES.md, rule 8](../RULES.md#8-one-run-per-issue).

## 9. Merge and deploy are not the coding agent's job

See [RULES.md, rule 9](../RULES.md#9-the-agent-stops-at-a-draft-pr).

## 10. Liveness measured by progress, not by a running process

See [RULES.md, rule 10](../RULES.md#10-watch-what-the-loop-produces-not-whether-it-is-running).

## 11. The reporter sees the status

See [RULES.md, rule 11](../RULES.md#11-the-reporter-sees-the-status).

## 12. The bot has its own account

See [RULES.md, rule 12](../RULES.md#12-the-automation-acts-as-a-bot).
