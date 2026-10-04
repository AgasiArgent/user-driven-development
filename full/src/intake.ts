import type pg from "pg";
import { renderIssue } from "../../delivery/src/issueBody.ts";
import { checkNoFly, type NoFlyRules } from "./noFly.ts";
import { research, type Model, type Payload, type RepoFiles, type Research } from "./research.ts";
import type { Tracker } from "./tracker/types.ts";

export interface IntakeOptions {
  rules: NoFlyRules;
  model?: Model;
  publicBaseUrl?: string;
  batch?: number;
}

const MAX_ATTEMPTS = 5;
const FOOTER = "Move this issue to **Approved for fix** to let the dispatcher work on it. Cancel it to reject it.";

function researchSection(r: Research, noFly: { blocked: boolean; reasons: string[] }): string {
  const lines = [
    "### Research",
    `- **Kind:** ${r.kind}`,
    `- **Summary:** ${r.summary.replace(/@/g, "@​")}`,
    `- **Uncertainty:** ${r.uncertainty}`,
    "",
    "**Likely code:**",
    ...(r.codeRefs.length ? r.codeRefs.map((c) => `- \`${c.file}:${c.line}\``) : ["- none found"]),
  ];
  if (noFly.blocked) lines.push("", "### No-fly area — a human fixes this", ...noFly.reasons.map((x) => `- ${x}`));
  return lines.join("\n");
}

/**
 * Principles 1, 2 and 4: queued reports are researched first; a duplicate becomes a comment on
 * the open issue, anything else a new issue in Triage. No-fly areas get the label no-auto-fix.
 */
export async function intakeOnce(db: pg.Pool, tracker: Tracker, repo: RepoFiles, opts: IntakeOptions): Promise<{ created: number; grouped: number; failed: number }> {
  const client = await db.connect();
  const result = { created: 0, grouped: 0, failed: 0 };
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: string; payload: Payload; attempts: number }>(
      `SELECT id, payload, attempts FROM feedback_outbox
        WHERE status = 'received' ORDER BY created_at, id LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [opts.batch ?? 20],
    );
    for (const row of rows) {
      const id = Number(row.id);
      try {
        const r = await research(row.payload, repo, opts.model);
        const marker = `udd:fp=${r.fingerprint}`;
        const existing = await tracker.findOpenByMarker(marker);
        let key: string;
        if (existing) {
          await tracker.comment(existing.id, `Another report of this problem: **FB-${id}** from \`${row.payload.user ?? "unknown"}\`.\n\n> ${row.payload.comment.replace(/@/g, "@​").split("\n").join("\n> ")}`);
          key = existing.key;
          result.grouped++;
        } else {
          const noFly = checkNoFly(row.payload, r.codeRefs, opts.rules);
          const base = renderIssue(id, row.payload, opts.publicBaseUrl, FOOTER);
          const issue = await tracker.create({
            title: base.title,
            body: `${base.body}\n\n${researchSection(r, noFly)}\n\n<!-- ${marker} -->`,
            labels: noFly.blocked ? ["feedback", "no-auto-fix"] : ["feedback"],
          });
          key = issue.key;
          result.created++;
        }
        await client.query(
          "UPDATE feedback_outbox SET status = 'delivered', issue_ref = $2, delivered_at = now(), attempts = attempts + 1, last_error = NULL, updated_at = now() WHERE id = $1",
          [id, key],
        );
      } catch (err) {
        await client.query(
          `UPDATE feedback_outbox SET attempts = $2::int, last_error = $3, updated_at = now(),
                  status = CASE WHEN $2::int >= $4::int THEN 'delivery_failed' ELSE status END WHERE id = $1`,
          [id, row.attempts + 1, String(err instanceof Error ? err.message : err).slice(0, 500), MAX_ATTEMPTS],
        );
        result.failed++;
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return result;
}
