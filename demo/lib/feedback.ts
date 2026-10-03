import type { Db } from "./db";
import { reportErrors } from "./validate";

// Intake for the feedback widget. Contract: contracts/feedback-report.schema.json.
// WARNING: this endpoint has no authentication and no rate limit. That is fine for a local
// demo and wrong for production: put it behind your app's auth and a rate limiter.

const MAX_BODY_BYTES = 3 * 1024 * 1024;
const LIST_LIMIT = 50;

const json = (status: number, body: unknown) => Response.json(body, { status });

export async function handleFeedbackPost(req: Request, db: Db): Promise<Response> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return json(413, { error: "Report is larger than 3 MB." });
  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return json(413, { error: "Report is larger than 3 MB." });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "Body is not valid JSON." });
  }
  const errors = reportErrors(body);
  if (errors.length) return json(400, { error: errors.join("; ") });

  const { screenshot, ...payload } = body as { screenshot?: string; user?: string };
  const png = screenshot ? Buffer.from(screenshot.slice(screenshot.indexOf(",") + 1), "base64") : null;
  try {
    const { rows } = await db.query<{ id: string }>(
      "INSERT INTO feedback_outbox (payload, screenshot, user_ref) VALUES ($1, $2, $3) RETURNING id",
      [payload, png, payload.user ?? null],
    );
    return json(201, { id: `FB-${rows[0].id}`, status: "received" });
  } catch (err) {
    console.error("feedback intake: database write failed", err);
    return json(503, { error: "Feedback could not be saved right now. Please try again." });
  }
}

export async function handleFeedbackGet(req: Request, db: Db): Promise<Response> {
  const user = new URL(req.url).searchParams.get("user");
  if (!user) return json(400, { error: "The user parameter is required." });
  try {
    const { rows } = await db.query<{ id: string; status: string; comment: string; created_at: Date }>(
      `SELECT id, status, left(payload->>'comment', 140) AS comment, created_at
         FROM feedback_outbox WHERE user_ref = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
      [user, LIST_LIMIT],
    );
    return json(200, {
      reports: rows.map((r) => ({ id: `FB-${r.id}`, status: r.status, comment: r.comment, createdAt: r.created_at.toISOString() })),
    });
  } catch (err) {
    console.error("feedback list: database read failed", err);
    return json(503, { error: "Reports are unavailable right now." });
  }
}
