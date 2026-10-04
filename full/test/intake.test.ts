import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { intakeOnce } from "../src/intake.ts";
import { MemoryTracker } from "../src/tracker/memory.ts";
import { memoryRepo } from "./helpers.ts";
import { freshTestDb } from "./testDb.ts";

let db: pg.Pool;
beforeAll(async () => {
  db = await freshTestDb();
});
afterAll(() => db.end());
beforeEach(() => db.query("TRUNCATE feedback_outbox RESTART IDENTITY"));

const repo = memoryRepo({ "demo/components/BookingForm.tsx": '<div className="when"><button>Book</button></div>', "demo/lib/feedback.ts": "intake" });
const rules = { paths: ["demo/lib/feedback.ts"], keywords: ["payment"], researchIgnore: [] };

async function addReport(comment: string, extra: Record<string, unknown> = {}) {
  const payload = { comment, createdAt: "2026-10-04T10:00:00.000Z", context: { url: "http://localhost:3100/rooms/1" }, target: { selector: ".when > button", tagName: "button", text: "Book" }, user: "alice", ...extra };
  await db.query("INSERT INTO feedback_outbox (payload, user_ref) VALUES ($1, 'alice')", [payload]);
}
const rows = async () => (await db.query("SELECT id, status, issue_ref, attempts FROM feedback_outbox ORDER BY id")).rows;

describe("intakeOnce", () => {
  it("researches a report and files it in Triage with code references and a fingerprint", async () => {
    await addReport("The Book button is cut off");
    const tracker = new MemoryTracker();
    expect(await intakeOnce(db, tracker, repo, { rules })).toEqual({ created: 1, grouped: 0, failed: 0 });
    const issue = [...tracker.issues.values()][0];
    expect(issue.state).toBe("Triage");
    expect(issue.labels).toEqual(["feedback"]);
    expect(issue.body).toContain("### Research");
    expect(issue.body).toContain("demo/components/BookingForm.tsx:1");
    expect(issue.body).toMatch(/<!-- udd:fp=[0-9a-f]{16} -->/);
    expect(issue.body).toContain("Approved for fix");
    expect((await rows())[0]).toMatchObject({ status: "delivered", issue_ref: "MEM-1" });
  });

  it("adds a duplicate report to the open issue instead of filing a new one", async () => {
    await addReport("The Book button is cut off");
    await addReport("the book button is cut off!", { context: { url: "http://localhost:3100/rooms/4" }, user: "bob" });
    const tracker = new MemoryTracker();
    expect(await intakeOnce(db, tracker, repo, { rules })).toEqual({ created: 1, grouped: 1, failed: 0 });
    expect(tracker.issues.size).toBe(1);
    expect(tracker.comments.get("mem-1")?.[0]).toContain("FB-2");
    expect((await rows()).map((r) => r.issue_ref)).toEqual(["MEM-1", "MEM-1"]);
  });

  it("labels a report in a no-fly area so the dispatcher never takes it", async () => {
    await addReport("Payment total is wrong");
    const tracker = new MemoryTracker();
    await intakeOnce(db, tracker, repo, { rules });
    const issue = [...tracker.issues.values()][0];
    expect(issue.labels).toEqual(["feedback", "no-auto-fix"]);
    expect(issue.body).toContain('report mentions "payment"');
  });

  it("keeps the report queued when the tracker fails", async () => {
    await addReport("anything");
    const tracker = new MemoryTracker();
    tracker.create = async () => {
      throw new Error("Linear: rate limited");
    };
    expect(await intakeOnce(db, tracker, repo, { rules })).toEqual({ created: 0, grouped: 0, failed: 1 });
    expect((await rows())[0]).toMatchObject({ status: "received", attempts: 1 });
  });
});
