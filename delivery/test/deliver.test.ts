import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deliverOnce, syncStatuses } from "../src/deliver.ts";
import { FakeTracker } from "./fakeTracker.ts";
import { freshTestDb } from "./testDb.ts";

let db: pg.Pool;
beforeAll(async () => {
  db = await freshTestDb();
});
afterAll(() => db.end());
beforeEach(() => db.query("TRUNCATE feedback_outbox RESTART IDENTITY"));

const opts = { repo: "acme/roomly", publicBaseUrl: "https://roomly.example.com" };

async function addReport(comment: string, extra: Record<string, unknown> = {}) {
  const payload = { comment, createdAt: "2026-10-04T10:00:00.000Z", context: { url: "https://roomly.example.com/rooms/1" }, user: "alice", ...extra };
  await db.query("INSERT INTO feedback_outbox (payload, user_ref, screenshot) VALUES ($1, 'alice', $2)", [payload, Buffer.from("png")]);
}
const row = async (id = 1) => (await db.query("SELECT * FROM feedback_outbox WHERE id = $1", [id])).rows[0];

describe("deliverOnce", () => {
  it("turns a received report into an issue and records where it went", async () => {
    await addReport("The Book button does nothing\nsecond line");
    const tracker = new FakeTracker();
    expect(await deliverOnce(db, tracker, opts)).toEqual({ delivered: 1, failed: 0 });
    const issue = tracker.issues.get(1)!;
    expect(issue.title).toBe("[FB-1] The Book button does nothing");
    expect(issue.labels).toEqual(["feedback"]);
    expect(issue.body).toContain("> The Book button does nothing\n> second line");
    expect(issue.body).toContain("https://roomly.example.com/api/feedback/FB-1/screenshot");
    expect(issue.body).toContain("Add the label `approved`");
    const r = await row();
    expect(r.status).toBe("delivered");
    expect(r.issue_ref).toBe("acme/roomly#1");
    expect(r.delivered_at).not.toBeNull();
  });

  it("does not create a second issue on the next pass", async () => {
    await addReport("once");
    const tracker = new FakeTracker();
    await deliverOnce(db, tracker, opts);
    await deliverOnce(db, tracker, opts);
    expect(tracker.issues.size).toBe(1);
  });

  it("delivers each report once when two passes run at the same time", async () => {
    for (let i = 0; i < 6; i++) await addReport(`report ${i}`);
    const tracker = new FakeTracker();
    await Promise.all([deliverOnce(db, tracker, opts), deliverOnce(db, tracker, opts)]);
    expect(tracker.issues.size).toBe(6);
  });

  it("keeps the report queued when GitHub fails, and gives up after five attempts", async () => {
    await addReport("flaky");
    const tracker = new FakeTracker();
    tracker.failNext = 5;
    expect(await deliverOnce(db, tracker, opts)).toEqual({ delivered: 0, failed: 1 });
    let r = await row();
    expect(r.status).toBe("received");
    expect(r.attempts).toBe(1);
    expect(r.last_error).toContain("502");
    for (let i = 0; i < 4; i++) await deliverOnce(db, tracker, opts);
    r = await row();
    expect(r.status).toBe("delivery_failed");
    expect(tracker.issues.size).toBe(0);
  });

  it("neutralises mentions and HTML from the report text", async () => {
    await addReport("@octocat please <img src=x onerror=alert(1)> fix", { target: { selector: "button", tagName: "button", text: "@team" } });
    const tracker = new FakeTracker();
    await deliverOnce(db, tracker, opts);
    const body = tracker.issues.get(1)!.body;
    expect(body).not.toMatch(/(^|[^​])@octocat/);
    expect(body).not.toMatch(/(^|[^​])@team/);
    expect(body).not.toContain("<img");
    expect(body).toContain("&lt;img");
  });

  it("omits the screenshot link when no public URL is configured", async () => {
    await addReport("no link");
    const tracker = new FakeTracker();
    await deliverOnce(db, tracker, { repo: "acme/roomly" });
    expect(tracker.issues.get(1)!.body).toContain("**Screenshot:** stored in the app");
  });
});

describe("syncStatuses", () => {
  async function delivered(n: number) {
    await addReport(`r${n}`);
  }

  it("follows the issue: approved label, agent PR label, closed as done or not planned", async () => {
    const tracker = new FakeTracker();
    for (let i = 1; i <= 4; i++) await delivered(i);
    await deliverOnce(db, tracker, opts);
    tracker.issues.get(1)!.labels = ["feedback", "approved"];
    tracker.issues.get(2)!.labels = ["feedback", "approved", "agent-pr"];
    Object.assign(tracker.issues.get(3)!, { state: "closed", stateReason: "completed" });
    Object.assign(tracker.issues.get(4)!, { state: "closed", stateReason: "not_planned" });
    await syncStatuses(db, tracker, opts);
    const statuses = (await db.query("SELECT status FROM feedback_outbox ORDER BY id")).rows.map((r) => r.status);
    expect(statuses).toEqual(["approved", "in_progress", "done", "rejected"]);
  });

  it("ignores issues that belong to another repository", async () => {
    await delivered(1);
    const tracker = new FakeTracker();
    await deliverOnce(db, tracker, opts);
    await db.query("UPDATE feedback_outbox SET issue_ref = 'other/repo#1'");
    tracker.issues.get(1)!.labels = ["feedback", "approved"];
    await syncStatuses(db, tracker, opts);
    expect((await row()).status).toBe("delivered");
  });
});

describe("issue body", () => {
  it("keeps CSS selectors literal inside code spans", async () => {
    await addReport("cut off", { target: { selector: ".when > button", tagName: "button", text: "Book" } });
    const tracker = new FakeTracker();
    await deliverOnce(db, tracker, opts);
    expect(tracker.issues.get(1)!.body).toContain("`.when > button`");
  });
});

describe("issue title", () => {
  it("is plain text: comparison signs stay readable, mentions are still neutralised", async () => {
    await addReport("Total < 0 after @bob edits");
    const tracker = new FakeTracker();
    await deliverOnce(db, tracker, opts);
    expect(tracker.issues.get(1)!.title).toBe("[FB-1] Total < 0 after @​bob edits");
  });
});

describe("crash safety", () => {
  it("commits each delivered report on its own, so a crash mid-batch does not undo earlier rows", async () => {
    await addReport("first");
    await addReport("second");
    const tracker = new FakeTracker();
    let calls = 0;
    let secondStarted!: () => void;
    let killSecond!: (e: Error) => void;
    const started = new Promise<void>((r) => (secondStarted = r));
    const realCreate = tracker.createIssue.bind(tracker);
    tracker.createIssue = (issue) => {
      calls++;
      if (calls === 2) {
        secondStarted();
        return new Promise((_, reject) => (killSecond = reject)); // hangs, like a process about to be killed
      }
      return realCreate(issue);
    };
    const pass = deliverOnce(db, tracker, opts).catch(() => {});
    await started;
    expect((await row(1)).status).toBe("delivered");
    killSecond(new Error("killed"));
    await pass;
  });

  it("keeps syncing other issues when one of them cannot be read", async () => {
    await addReport("a");
    await addReport("b");
    const tracker = new FakeTracker();
    await deliverOnce(db, tracker, opts);
    tracker.issues.delete(1);
    tracker.issues.get(2)!.labels = ["feedback", "approved"];
    await syncStatuses(db, tracker, opts);
    expect((await row(2)).status).toBe("approved");
  });
});

