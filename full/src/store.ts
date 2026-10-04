import type pg from "pg";

export interface Run {
  issue_id: string;
  issue_key: string;
  status: string;
  round: number;
  task_id: string | null;
  branch: string | null;
  pr_url: string | null;
  last_error: string | null;
  updated_at: Date;
}

type Fields = Partial<Pick<Run, "status" | "round" | "task_id" | "branch" | "pr_url" | "last_error">>;

/** Principle 8: the primary key makes the first claim win; every later poll gets false. */
export async function claim(db: pg.Pool, issueId: string, issueKey: string): Promise<boolean> {
  const { rowCount } = await db.query(
    "INSERT INTO dispatch_runs (issue_id, issue_key, status) VALUES ($1, $2, 'claimed') ON CONFLICT (issue_id) DO NOTHING",
    [issueId, issueKey],
  );
  return rowCount === 1;
}

export async function getRun(db: pg.Pool, issueId: string): Promise<Run | undefined> {
  return (await db.query<Run>("SELECT * FROM dispatch_runs WHERE issue_id = $1", [issueId])).rows[0];
}

export async function runsWithStatus(db: pg.Pool, status: string): Promise<Run[]> {
  return (await db.query<Run>("SELECT * FROM dispatch_runs WHERE status = $1 ORDER BY updated_at", [status])).rows;
}

const COLUMNS = new Set(["status", "round", "task_id", "branch", "pr_url", "last_error"]);

export async function updateRun(db: pg.Pool, issueId: string, fields: Fields): Promise<void> {
  const keys = Object.keys(fields).filter((k) => COLUMNS.has(k));
  if (!keys.length) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  await db.query(`UPDATE dispatch_runs SET ${sets}, updated_at = now() WHERE issue_id = $1`, [issueId, ...keys.map((k) => fields[k as keyof Fields])]);
}

/** Principle 11: the reporter sees progress. Reports are linked to the issue by its key (issue_ref). */
export async function setReportStatus(db: pg.Pool, issueKey: string, status: "in_progress" | "fixed" | "delivered"): Promise<void> {
  await db.query("UPDATE feedback_outbox SET status = $2, updated_at = now() WHERE issue_ref = $1", [issueKey, status]);
}
