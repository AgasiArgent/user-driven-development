import type pg from "pg";
import type { IssueTracker } from "./github.ts";
import { renderIssue, type Payload } from "./issueBody.ts";

export interface DeliveryOptions {
  /** "owner/repo" the issues are created in. */
  repo: string;
  publicBaseUrl?: string;
  batch?: number;
}

const MAX_ATTEMPTS = 5;

/**
 * One delivery pass: received reports → issues. Each report is locked (SKIP LOCKED) and committed in
 * its own transaction, so two passes never deliver the same report and a crash mid-pass keeps
 * everything delivered before it. A failed call leaves the report queued for the next pass.
 */
export async function deliverOnce(db: pg.Pool, tracker: IssueTracker, opts: DeliveryOptions): Promise<{ delivered: number; failed: number }> {
  let delivered = 0;
  let failed = 0;
  const seen: number[] = [];
  for (let i = 0; i < (opts.batch ?? 20); i++) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{ id: string; payload: Payload; attempts: number }>(
        `SELECT id, payload, attempts FROM feedback_outbox
          WHERE status = 'received' AND id <> ALL($1::bigint[])
          ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [seen],
      );
      const row = rows[0];
      if (!row) {
        await client.query("COMMIT");
        break;
      }
      const id = Number(row.id);
      seen.push(id);
      try {
        // shortcut: if the commit below fails after GitHub accepted the issue, the next pass creates
        // a duplicate. Rare with per-row commits; search for the "[FB-<id>]" title prefix if it matters.
        const { number } = await tracker.createIssue(renderIssue(id, row.payload, opts.publicBaseUrl));
        await client.query(
          `UPDATE feedback_outbox SET status = 'delivered', issue_ref = $2, delivered_at = now(),
                  attempts = attempts + 1, last_error = NULL, updated_at = now() WHERE id = $1`,
          [id, `${opts.repo}#${number}`],
        );
        delivered++;
      } catch (err) {
        await client.query(
          `UPDATE feedback_outbox SET attempts = $2::int, last_error = $3, updated_at = now(),
                  status = CASE WHEN $2::int >= $4::int THEN 'delivery_failed' ELSE status END WHERE id = $1`,
          [id, row.attempts + 1, String(err instanceof Error ? err.message : err).slice(0, 500), MAX_ATTEMPTS],
        );
        failed++;
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
  return { delivered, failed };
}

/** Mirrors the issue's state back to the report, so the reporter sees it in the app. */
export function statusFromIssue(issue: { state: string; stateReason: string | null; labels: string[] }): string | null {
  if (issue.state === "closed") return issue.stateReason === "not_planned" ? "rejected" : "done";
  if (issue.labels.includes("agent-pr")) return "in_progress";
  if (issue.labels.includes("approved")) return "approved";
  return null;
}

export async function syncStatuses(db: pg.Pool, tracker: IssueTracker, opts: DeliveryOptions): Promise<number> {
  const prefix = `${opts.repo}#`;
  const { rows } = await db.query<{ id: string; status: string; issue_ref: string }>(
    `SELECT id, status, issue_ref FROM feedback_outbox
      WHERE status IN ('delivered', 'approved', 'in_progress') AND starts_with(issue_ref, $1)`,
    [prefix],
  );
  let changed = 0;
  for (const row of rows) {
    try {
      const next = statusFromIssue(await tracker.getIssue(Number(row.issue_ref.slice(prefix.length))));
      if (next && next !== row.status) {
        await db.query("UPDATE feedback_outbox SET status = $2, updated_at = now() WHERE id = $1", [row.id, next]);
        changed++;
      }
    } catch (err) {
      // A deleted or transferred issue must not stop the others from syncing.
      console.error(`sync ${row.issue_ref}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return changed;
}
