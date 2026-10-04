// Usage:
//   npm run deliver -w delivery -- [--dry-run] [--watch <seconds>]
// Env: DATABASE_URL, GITHUB_TOKEN, GITHUB_REPOSITORY ("owner/repo"), PUBLIC_BASE_URL (optional).
import pg from "pg";
import { deliverOnce, syncStatuses } from "./deliver.ts";
import { createGitHubClient } from "./github.ts";
import { renderIssue, type Payload } from "./issueBody.ts";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const watchIndex = args.indexOf("--watch");
const watchSeconds = watchIndex >= 0 ? Number(args[watchIndex + 1]) : 0;

const repo = process.env.GITHUB_REPOSITORY ?? "";
const publicBaseUrl = process.env.PUBLIC_BASE_URL || undefined;
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://udd:udd@localhost:55432/udd", max: 2 });

async function preview(): Promise<void> {
  const { rows } = await db.query<{ id: string; payload: Payload }>(
    "SELECT id, payload FROM feedback_outbox WHERE status = 'received' ORDER BY created_at, id LIMIT 20",
  );
  if (!rows.length) console.log("Nothing to deliver.");
  for (const r of rows) {
    const issue = renderIssue(Number(r.id), r.payload, publicBaseUrl);
    console.log(`--- would create in ${repo || "<GITHUB_REPOSITORY>"}: ${issue.title}\n${issue.body}\n`);
  }
}

async function pass(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    throw new Error("Set GITHUB_TOKEN and GITHUB_REPOSITORY=owner/repo, or use --dry-run.");
  }
  const tracker = createGitHubClient({ token, repo });
  const result = await deliverOnce(db, tracker, { repo, publicBaseUrl });
  const synced = await syncStatuses(db, tracker, { repo, publicBaseUrl });
  console.log(`${new Date().toISOString()} delivered=${result.delivered} failed=${result.failed} status_changes=${synced}`);
}

try {
  if (dryRun) await preview();
  else if (watchSeconds > 0) {
    for (;;) {
      await pass().catch((err) => console.error(`pass failed: ${err instanceof Error ? err.message : err}`));
      await new Promise((r) => setTimeout(r, watchSeconds * 1000));
    }
  } else await pass();
} finally {
  await db.end();
}
