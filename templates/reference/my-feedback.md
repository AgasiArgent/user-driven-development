# Reference: the "My feedback" page

Both acceptance apps got this page wrong (stale status; empty list). Follow this contract.
Snippets are stack-neutral TypeScript: adapt the framework glue, keep the rules.

## Rules

1. Store the GitHub issue number with the report at intake. Never find reports by parsing the issue body.
2. Read status by issue number from the GitHub REST API with `cache: 'no-store'`. No data cache:
   acceptance showed a 60 s stale status ("Received" after the issue was verified).
3. Map the issue to a status with `statusFromIssue` (below, copied from `.udd/scripts/status.mjs`).
4. Show a user only their own reports. The issue body holds no user id, only an opaque reporter id.

## With a database

Add a `github_issue_number` column to the report row. Intake creates the issue, then saves the number.

```ts
// intake (server): after the issue is created
await db.reports.update(report.id, { githubIssueNumber: issue.number });

// my feedback (server): only the signed-in user's rows
const rows = await db.reports.findMany({ userId: session.userId });
const items = await Promise.all(rows.map(async (r) => ({
  id: r.id,
  comment: r.comment,
  status: await readStatus(r.githubIssueNumber),
})));
```

## With no database

Intake returns the issue number as the report id. The browser keeps the list, keyed per signed-in user,
so two people on one browser do not see each other's reports.

```ts
const key = (userId: string) => `udd:my-feedback:${userId}`;

export function remember(userId: string, issueNumber: number, comment: string) {
  const list: { n: number; comment: string }[] = JSON.parse(localStorage.getItem(key(userId)) ?? "[]");
  localStorage.setItem(key(userId), JSON.stringify([{ n: issueNumber, comment }, ...list]));
}

// The page calls GET /api/my-feedback/status?n=12&n=15 and shows the result next to each stored comment.
```

The status route reads only the numbers it is given and returns nothing but the status. It must refuse
numbers that are not feedback issues (no `feedback` label).

## Reading the status

```ts
async function readStatus(n: number) {
  const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPO}/issues/${n}`, {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
    },
    cache: "no-store", // no data cache; Next.js: also export const dynamic = "force-dynamic" on the route
  });
  if (!res.ok) return { key: "unknown", text: "Status unavailable" };
  const issue = await res.json();
  return statusFromIssue({
    labels: issue.labels.map((l: { name: string }) => l.name),
    state: issue.state,
    stateReason: issue.state_reason,
  });
}
```

## statusFromIssue (copy from `.udd/scripts/status.mjs`)

```ts
const RULES = [
  ["verified", "Verified in production"],
  ["needs-human", "Waiting for the developer"],
  ["shipped", "Shipped"],
  ["fix-ready", "Fix ready"],
  ["in-progress", "In progress"],
  ["approved", "Approved"],
  ["researched", "Looked into"],
];

export function statusFromIssue({ labels = [], state, stateReason = null }) {
  if (state === "closed" && stateReason === "not_planned") return { key: "declined", text: "Declined" };
  for (const [key, text] of RULES) if (labels.includes(key)) return { key, text };
  if (state === "closed" && stateReason === "completed") return { key: "shipped", text: "Shipped" };
  return { key: "received", text: "Received" };
}
```

## Screenshots

- Store the screenshot in private storage (a private bucket or table), never at a public URL.
- Put in the issue a link to an app route, for example `/api/feedback/FB-12/screenshot`. That route serves
  the image only to a signed-in owner of the report or an admin (session check plus role check), else 404.
- An app with no storage keeps nothing: write "screenshot not kept" in the issue instead of a link.
