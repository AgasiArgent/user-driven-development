# The rules

Fifteen rules for running a feedback loop where your users find the problems and coding agents fix them. Twelve came out of a real system and most were added after something broke there. Three more cover the weekly routines.

Each rule has the same three lines:

- **Rule** is the whole rule in one sentence.
- **Why** is the failure that led to it.
- **Enforced by** names the file in this kit that makes the rule hold, so it does not depend on anyone remembering it.

The loop these rules protect:

```text
User pins feedback in the app
  -> durable queue
  -> agent researches the report and comments on the issue
  -> you add "approved"
  -> test fails on the live site first, then the fix, up to 3 attempts, draft PR
  -> the same test passes on the preview of the fix
  -> you merge and deploy
  -> the same test runs against production
  -> the reporter sees "verified"
```

## 1. Put a queue between the form and everything else

**Rule:** A report is saved to your own database and gets an ID before anything else happens; delivery to GitHub is a separate step that retries.

**Why:** The app, the network and the agent host fail on their own schedules. In the original system a tunnel in front of the agent host returned 404 for about a day, and the reports sent in that time were delivered later because they were already saved.

**Enforced by:** `contracts/feedback-report.schema.json`, `demo/lib/feedback.ts`, `delivery/src/deliver.ts`

## 2. Research before the issue, and keep agent text harmless

**Rule:** An agent reads the report, finds the likely code and the open questions, and writes that into the issue as a comment; any text it or the reporter wrote is cleaned before it reaches GitHub.

**Why:** A raw report is rarely enough for a coding agent, and you need to see what a change would touch before you approve it. Agent-written text must also never contain the word that wakes another agent, so every `@` is neutralised and HTML is escaped.

**Enforced by:** `templates/workflows/udd-research.yml`, `delivery/src/issueBody.ts`, `templates/scripts/udd/sanitize.mjs`

## 3. A person approves before any code is written

**Rule:** The only way to start a coding run is a person adding the `approved` label to an issue that carries `feedback`.

**Why:** Report text is untrusted input to an agent, and every run costs quota. Approval is where you control both. A label added by a bot, or on an issue that did not come from the widget, starts nothing.

**Enforced by:** `templates/workflows/udd-fix.yml`, `docs/threat-model.md`

## 4. No-fly zones are checked by code

**Rule:** Paths such as money, access rights and the loop's own workflows are listed in a file, and a change to any of them never becomes an automatic PR.

**Why:** A sentence in a prompt can be argued away by the report text. A check on the patch cannot. The check runs on the diff that would be committed, with a copy of the checker taken from the main branch.

**Enforced by:** `.udd/no-fly.txt`, `scripts/no-fly-check.mjs`

## 5. Write the failing test first

**Rule:** The agent must add one test tagged `@udd-<issue number>`. The test must fail on the live site first and pass on the preview of the fix; a run that cannot show both is not counted.


**Why:** A coding agent that cannot reproduce the problem produces changes that look right. The bad PRs in the original system had three shapes: only a test changed, the wrong component was edited, or the symptom was hidden while the cause stayed. The live site is where the bug still exists, so a test that fails there is a real reproduction. The risk is that the agent writes tests that run against production, so they use a test account with no real data and no admin rights.

**Enforced by:** `templates/scripts/udd/red-first.mjs`, `templates/workflows/udd-fix.yml`, `templates/workflows/udd-preview.yml`

## 6. Three attempts, then a person

**Rule:** If the checks fail, the agent gets the reason and tries again, at most three times; after that the issue is labelled `needs-human`.

**Why:** Every attempt costs quota and your attention. A fixed limit makes the worst case for one issue known in advance.

**Enforced by:** `templates/workflows/udd-fix.yml`

## 7. Done means it passes in production

**Rule:** An issue counts as verified only after the fix is deployed and the same tagged test passes against the live site.

**Why:** In the original system, opening a draft PR moved the issue forward for a while, and reporters were asked to check fixes that had not shipped. If the production check fails, the issue is reopened, labelled `needs-human`, and the `shipped` label is removed, so the next deploy does not retest it in a loop.

**Enforced by:** `templates/workflows/udd-verify.yml`, `templates/scripts/udd/verify-plan.mjs`

## 8. One run per issue

**Rule:** Starting a run marks the issue `in-progress`, and runs for the same issue are queued, never parallel.

**Why:** People leave issues sitting in the approved state, and every trigger sees them again. Without a marker that means duplicate runs and duplicate PRs.

**Enforced by:** `templates/workflows/udd-fix.yml`

## 9. The agent stops at a draft PR

**Rule:** Merging and deploying are yours. The agent opens a draft and applies `fix-ready`.

**Why:** The agent has no view of production. The step that changes production belongs to someone who can see it, and who can combine several small fixes into one release.

**Enforced by:** `templates/workflows/udd-fix.yml`

## 10. Watch what the loop produces, not whether it is running

**Rule:** Check weekly that reports became issues and approved issues became PRs, and look at everything stuck.

**Why:** The longest outage in the original system lasted 12 days and produced no errors. Every process was running and no PR came out. A running process says nothing about output.

**Enforced by:** `WEEKLY.md`, `templates/workflows/udd-verify.yml`

## 11. The reporter sees the status

**Rule:** The person who sent the report can see it in the app, from `received` to `verified`.

**Why:** Without it, the only way for a reporter to learn what happened is to ask you.

**Enforced by:** `templates/scripts/udd/status.mjs`, `delivery/src/deliver.ts`

## 12. The automation acts as a bot

**Rule:** Comments, labels and PRs come from the workflow's bot identity, and a label added by a bot never starts a fix run.

**Why:** In the original system the automations ran under the owner's personal key. Nothing showed which actions were automated, and the automations had all of the owner's permissions.

**Enforced by:** `templates/workflows/udd-fix.yml`

## 13. A routine has one open item and remembers a no

**Rule:** Each weekly routine keeps at most one open PR or issue, and a finding you reject is written to `.udd/known-findings.json` and never proposed again.

**Why:** A routine that stacks up items trains you to ignore them. The measure of a routine is merged PRs and closed issues, not how often it ran.

**Enforced by:** `templates/scripts/udd/routine-guard.mjs`, `templates/workflows/udd-routine.yml`

## 14. A security finding comes first, the fix comes after approval

**Rule:** The security routine reports what it found and changes nothing; a fix starts only after you approve the finding. A leaked secret gets an issue that says to rotate the key, never a PR.

**Why:** Removing a secret from the current code does not remove it from git history, so only rotating the key makes it safe. A fix made in the same step as the finding also skips the review that approval is for.

**Enforced by:** `templates/routines/security.md`, `templates/workflows/udd-routine.yml`

## 15. Findings in a public repository stay local

**Rule:** In a public repository the scheduled security routine is off. The check runs on your machine from `WEEKLY.md`, results appear only in your terminal, and the fix is an ordinary commit that does not describe the hole.

**Why:** An issue or PR in a public repository tells everyone about a vulnerability before it is fixed.

**Enforced by:** `templates/workflows/udd-routine.yml`, `ROUTINES.md`
