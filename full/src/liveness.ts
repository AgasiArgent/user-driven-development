import type pg from "pg";

export interface LivenessLimits {
  queueMinutes: number;
  runHours: number;
}

const DEFAULTS: LivenessLimits = { queueMinutes: 15, runHours: 24 };

/**
 * Principle 10: check that work moves, not that processes are up. Returns human-readable alerts;
 * an empty list means the loop is moving.
 */
export async function livenessAlerts(db: pg.Pool, now = new Date(), limits = DEFAULTS): Promise<string[]> {
  const alerts: string[] = [];
  const oldest = (await db.query<{ created_at: Date }>("SELECT min(created_at) AS created_at FROM feedback_outbox WHERE status = 'received'")).rows[0]?.created_at;
  if (oldest) {
    const minutes = Math.floor((now.getTime() - new Date(oldest).getTime()) / 60_000);
    if (minutes > limits.queueMinutes) alerts.push(`Intake is not moving: the oldest queued report has been waiting for ${minutes} min.`);
  }
  const failed = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM feedback_outbox WHERE status = 'delivery_failed'")).rows[0].n;
  if (failed) alerts.push(`${failed} report(s) could not be delivered after 5 attempts (status delivery_failed).`);
  const stale = await db.query<{ issue_key: string; hours: number }>(
    "SELECT issue_key, floor(extract(epoch FROM ($1::timestamptz - updated_at)) / 3600)::int AS hours FROM dispatch_runs WHERE status IN ('claimed', 'coding') AND updated_at < $1::timestamptz - make_interval(hours => $2)",
    [now, limits.runHours],
  );
  for (const r of stale.rows) alerts.push(`Agent run for ${r.issue_key} has had no result for ${r.hours} h.`);
  return alerts;
}
