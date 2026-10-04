import type { Db } from "./db";
import { reportErrors } from "./validate";

// Intake for the feedback widget. Contract: contracts/feedback-report.schema.json.
// WARNING: this endpoint has no authentication and no rate limit. That is fine for a local
// demo and wrong for production: put it behind your app's auth and a rate limiter.

const MAX_BODY_BYTES = 3 * 1024 * 1024;
const LIST_LIMIT = 50;

const json = (status: number, body: unknown) => Response.json(body, { status });
const TOO_LARGE = () => json(413, { error: "Report is larger than 3 MB." });

/** Reads the body as text, or returns null as soon as it passes `max` bytes (no Content-Length needed). */
async function readLimited(req: Request, max: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** NUL and lone surrogates are valid JSON but Postgres jsonb rejects them. */
function cleanStrings(_key: string, value: unknown): unknown {
  return typeof value === "string"
    ? value.replace(/\u0000/g, "").replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD")
    : value;
}

export async function handleFeedbackPost(req: Request, db: Db): Promise<Response> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return TOO_LARGE();
  const raw = await readLimited(req, MAX_BODY_BYTES);
  if (raw === null) return TOO_LARGE();

  let body: unknown;
  try {
    body = JSON.parse(raw, cleanStrings);
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
    // SQLSTATE class 22 = the data itself was rejected: the client's fault, not an outage.
    if (String((err as { code?: string }).code ?? "").startsWith("22")) {
      return json(400, { error: "Report contains data the server cannot store." });
    }
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

/** The screenshot of one report, linked from the tracker issue. Same caveat: no auth in the demo. */
export async function handleScreenshotGet(ref: string, db: Db): Promise<Response> {
  const match = /^FB-(\d{1,18})$/.exec(ref);
  if (!match) return json(404, { error: "Not found." });
  const { rows } = await db.query<{ screenshot: Buffer | null }>("SELECT screenshot FROM feedback_outbox WHERE id = $1", [match[1]]);
  const png = rows[0]?.screenshot;
  if (!png) return json(404, { error: "Not found." });
  return new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "private, max-age=300" } });
}
