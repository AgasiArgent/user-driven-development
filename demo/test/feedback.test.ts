import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { handleFeedbackGet, handleFeedbackPost } from "../lib/feedback";

const url = process.env.DATABASE_URL ?? "postgres://udd:udd@localhost:55432/udd";
const pool = new pg.Pool({ connectionString: url, max: 2 });
afterAll(() => pool.end());
beforeEach(() => pool.query("TRUNCATE feedback_outbox RESTART IDENTITY"));

const report = (extra: Record<string, unknown> = {}) => ({
  comment: "The Book button does nothing",
  createdAt: "2026-10-03T12:00:00.000Z",
  context: { url: "http://localhost:3100/rooms/1" },
  ...extra,
});
const post = (body: string) => new Request("http://x/api/feedback", { method: "POST", body, headers: { "content-type": "application/json" } });

describe("POST /api/feedback", () => {
  it("stores the report in the outbox and returns its id", async () => {
    const png = "data:image/png;base64," + Buffer.from("fake png").toString("base64");
    const res = await handleFeedbackPost(post(JSON.stringify(report({ user: "alice", screenshot: png }))), pool);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "FB-1", status: "received" });
    const row = (await pool.query("SELECT status, user_ref, payload, screenshot FROM feedback_outbox")).rows[0];
    expect(row.status).toBe("received");
    expect(row.user_ref).toBe("alice");
    expect(row.payload.comment).toBe("The Book button does nothing");
    expect(row.payload).not.toHaveProperty("screenshot");
    expect(Buffer.from(row.screenshot).toString()).toBe("fake png");
  });

  it("rejects a report without a comment with 400", async () => {
    const { comment, ...rest } = report();
    const res = await handleFeedbackPost(post(JSON.stringify(rest)), pool);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/comment/);
    expect((await pool.query("SELECT count(*)::int AS n FROM feedback_outbox")).rows[0].n).toBe(0);
  });

  it("rejects malformed JSON with 400", async () => {
    expect((await handleFeedbackPost(post("{not json"), pool)).status).toBe(400);
  });

  it("rejects a body over 3 MB with 413", async () => {
    const res = await handleFeedbackPost(post(JSON.stringify(report({ comment: "x".repeat(3_200_000) }))), pool);
    expect(res.status).toBe(413);
  });

  it("answers 503 when the database is unavailable", async () => {
    const dead = new pg.Pool({ connectionString: "postgres://udd:udd@localhost:1/udd", connectionTimeoutMillis: 500 });
    const res = await handleFeedbackPost(post(JSON.stringify(report())), dead);
    expect(res.status).toBe(503);
    await dead.end();
  });
});

describe("GET /api/feedback", () => {
  it("returns only the given user's reports, newest first, without screenshot or context", async () => {
    await handleFeedbackPost(post(JSON.stringify(report({ user: "alice", comment: "first" }))), pool);
    await handleFeedbackPost(post(JSON.stringify(report({ user: "bob", comment: "other" }))), pool);
    await handleFeedbackPost(post(JSON.stringify(report({ user: "alice", comment: "second" }))), pool);
    const res = await handleFeedbackGet(new Request("http://x/api/feedback?user=alice"), pool);
    const body = await res.json();
    expect(body.reports.map((r: { comment: string }) => r.comment)).toEqual(["second", "first"]);
    expect(body.reports[0]).toEqual({ id: "FB-3", status: "received", comment: "second", createdAt: expect.any(String) });
  });

  it("requires the user parameter", async () => {
    expect((await handleFeedbackGet(new Request("http://x/api/feedback"), pool)).status).toBe(400);
  });
});
