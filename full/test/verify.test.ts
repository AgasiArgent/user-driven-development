import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { livenessAlerts } from "../src/liveness.ts";
import { claim, getRun, updateRun } from "../src/store.ts";
import { MemoryTracker } from "../src/tracker/memory.ts";
import { verifyOnce, type VerifyDeps } from "../src/verify.ts";
import { fail, fakeExec, ok, on } from "./fakeExec.ts";
import { freshTestDb } from "./testDb.ts";

let db: pg.Pool;
beforeAll(async () => {
  db = await freshTestDb();
});
afterAll(() => db.end());
beforeEach(() => db.query("TRUNCATE dispatch_runs; TRUNCATE feedback_outbox RESTART IDENTITY"));

interface World {
  pr?: string;
  deployed?: boolean;
  ci?: string;
  scenario?: "passes" | "fails";
  version?: string | null;
}

async function setup(w: World = {}) {
  const { pr = '{"state":"MERGED","mergeCommit":{"oid":"abc123"}}', deployed = true, ci = '[{"status":"completed","conclusion":"success"}]', scenario = "passes", version = "def4567" } = w;
  const tracker = new MemoryTracker();
  const issue = await tracker.create({ title: "[FB-1] cut off", body: "x\nScenario: bug 3", labels: ["feedback"] });
  await tracker.setState(issue.id, "In Progress");
  await claim(db, issue.id, issue.key);
  await updateRun(db, issue.id, { status: "pr_opened", pr_url: "https://github.com/acme/roomly/pull/12" });
  const f = fakeExec([
    on("gh pr view", ok(pr)),
    on("git merge-base --is-ancestor", deployed ? ok() : { code: 1, stdout: "", stderr: "" }),
    on("gh run list", ok(ci)),
    on("npx playwright", scenario === "passes" ? ok("1 passed") : fail("1 failed")),
  ]);
  const fetchFn = vi.fn(async () => (version === null ? new Response("down", { status: 502 }) : Response.json({ sha: version })));
  const deps: VerifyDeps = { db, tracker, exec: f.exec, repoDir: "/repo", prodUrl: "https://roomly.example", fetchFn: fetchFn as unknown as typeof fetch };
  return { tracker, issue, deps, f };
}

describe("verifyOnce", () => {
  it("moves the issue to In Review only after merge, deploy, green CI and a passing scenario in production", async () => {
    const { tracker, issue, deps, f } = await setup();
    expect(await verifyOnce(deps)).toMatchObject({ verified: 1 });
    expect((await tracker.get(issue.id)).state).toBe("In Review");
    expect((await getRun(db, issue.id))?.status).toBe("verified");
    const pw = f.calls.find((c) => c.cmd === "npx")!;
    expect(pw.env).toMatchObject({ UDD_BASE_URL: "https://roomly.example", EXPECT_FIXED: "1" });
  });

  it("waits while the PR is still open", async () => {
    const { tracker, issue, deps } = await setup({ pr: '{"state":"OPEN","mergeCommit":null}' });
    expect(await verifyOnce(deps)).toMatchObject({ waiting: 1 });
    expect((await tracker.get(issue.id)).state).toBe("In Progress");
  });

  it("waits while production runs an older commit", async () => {
    const { deps } = await setup({ deployed: false });
    expect(await verifyOnce(deps)).toMatchObject({ waiting: 1 });
  });

  it("waits when production does not report its version", async () => {
    const { deps } = await setup({ version: null });
    expect(await verifyOnce(deps)).toMatchObject({ waiting: 1 });
  });

  it("waits while CI on main is still running, and hands over when it is red", async () => {
    const running = await setup({ ci: '[{"status":"in_progress","conclusion":""}]' });
    expect(await verifyOnce(running.deps)).toMatchObject({ waiting: 1 });
    await db.query("TRUNCATE dispatch_runs");
    const red = await setup({ ci: '[{"status":"completed","conclusion":"failure"}]' });
    expect(await verifyOnce(red.deps)).toMatchObject({ failed: 1 });
    expect(red.tracker.comments.get(red.issue.id)?.at(-1)).toMatch(/CI/);
  });

  it("keeps the issue out of In Review when the scenario still fails in production", async () => {
    const { tracker, issue, deps } = await setup({ scenario: "fails" });
    expect(await verifyOnce(deps)).toMatchObject({ failed: 1 });
    expect((await tracker.get(issue.id)).state).toBe("In Progress");
    expect(tracker.comments.get(issue.id)?.at(-1)).toMatch(/still fails/);
    expect((await getRun(db, issue.id))?.status).toBe("verify_failed");
  });

  it("hands back an issue whose PR was closed without merging", async () => {
    const { tracker, issue, deps } = await setup({ pr: '{"state":"CLOSED","mergeCommit":null}' });
    await verifyOnce(deps);
    expect((await tracker.get(issue.id)).state).toBe("Triage");
    expect(await getRun(db, issue.id)).toBeUndefined();
  });
});

describe("livenessAlerts", () => {
  const now = new Date("2026-10-04T12:00:00Z");

  it("is quiet when the loop is moving", async () => {
    await db.query("INSERT INTO feedback_outbox (payload, created_at) VALUES ('{}', $1)", [new Date(now.getTime() - 60_000)]);
    expect(await livenessAlerts(db, now)).toEqual([]);
  });

  it("reports a report stuck in the queue, failed deliveries, and an agent run without a result", async () => {
    await db.query("INSERT INTO feedback_outbox (payload, created_at) VALUES ('{}', $1)", [new Date(now.getTime() - 40 * 60_000)]);
    await db.query("INSERT INTO feedback_outbox (payload, status) VALUES ('{}', 'delivery_failed')");
    await db.query("INSERT INTO dispatch_runs (issue_id, issue_key, status, updated_at) VALUES ('i9', 'ENG-9', 'coding', $1)", [new Date(now.getTime() - 25 * 3600_000)]);
    const alerts = await livenessAlerts(db, now);
    expect(alerts).toHaveLength(3);
    expect(alerts.join("\n")).toMatch(/waiting for 40 min/);
    expect(alerts.join("\n")).toMatch(/1 report/);
    expect(alerts.join("\n")).toMatch(/ENG-9/);
  });
});
