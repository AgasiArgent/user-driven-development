import { fileURLToPath } from "node:url";
import type pg from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { dispatchOnce } from "../src/dispatcher.ts";
import { intakeOnce } from "../src/intake.ts";
import { loadRules } from "../src/noFly.ts";
import { gitRepo } from "../src/repo.ts";
import { MemoryTracker } from "../src/tracker/memory.ts";
import { verifyOnce } from "../src/verify.ts";
import { fakeExec, ok, on, pwFails, pwPasses } from "./fakeExec.ts";
import { freshTestDb } from "./testDb.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
let db: pg.Pool;
beforeAll(async () => {
  db = await freshTestDb();
});
afterAll(() => db.end());

it("carries one report from the queue to In Review, and the reporter sees each step", async () => {
  const payload = {
    comment: "The Book button is off the screen on my phone",
    createdAt: "2026-10-04T10:00:00.000Z",
    user: "bob",
    context: { url: "http://localhost:3100/rooms/1", viewport: { width: 375, height: 800 } },
    target: { selector: ".when > button", tagName: "button", text: "Book" },
  };
  await db.query("INSERT INTO feedback_outbox (payload, user_ref) VALUES ($1, 'bob')", [payload]);
  const status = async () => (await db.query("SELECT status FROM feedback_outbox WHERE id = 1")).rows[0].status;
  const tracker = new MemoryTracker();

  // 1–2. Research on the real repository, then an issue in Triage.
  await intakeOnce(db, tracker, gitRepo(root, loadRules(root).researchIgnore), { rules: loadRules(root) });
  const [issue] = [...tracker.issues.values()];
  expect(issue.state).toBe("Triage");
  expect(issue.body).toContain("demo/components/BookingForm.tsx");
  expect(await status()).toBe("delivered");

  // 3. A human names the scenario and approves.
  issue.body += "\nScenario: bug 3";
  await tracker.setState(issue.id, "Approved for fix");

  // 5–9. Red-first in production, the agent, checks, a draft PR.
  let prod = "broken";
  const f = fakeExec([
    on("npx playwright", () => (prod === "broken" ? pwFails() : pwPasses())),
    on("git rev-parse", ok("bbbbbbb000000000000000000000000000000000\n")),
    on("git status --porcelain", ok(" M demo/app/globals.css\n")),
    on("git diff --name-only", ok("demo/app/globals.css\n")),
    on("gh pr create", ok("https://github.com/acme/roomly/pull/3\n")),
    on("gh pr view", ok('{"state":"MERGED","mergeCommit":{"oid":"aaaaaaa"}}')),
    on("gh run list", ok('[{"status":"completed","conclusion":"success"}]')),
  ]);
  const agent = { start: vi.fn(async () => ({ taskId: "task_1" })), poll: vi.fn(async () => "ready" as const), apply: vi.fn(async () => {}) };
  const common = { db, tracker, exec: f.exec, repoDir: root, worktreeRoot: "/tmp/udd-wt", prodUrl: "https://roomly.example" };
  expect(await dispatchOnce({ ...common, agent, noFlyPaths: loadRules(root).paths, sleep: async () => {} })).toMatchObject({ prOpened: 1 });
  expect((await tracker.get(issue.id)).state).toBe("In Progress");
  expect(await status()).toBe("in_progress");

  // 7. Merged and deployed; the scenario now passes in production.
  prod = "fixed";
  const fetchFn = vi.fn(async () => Response.json({ sha: "bbbbbbb" }));
  expect(await verifyOnce({ ...common, fetchFn: fetchFn as unknown as typeof fetch })).toMatchObject({ verified: 1 });
  expect((await tracker.get(issue.id)).state).toBe("In Review");
  expect(await status()).toBe("fixed");
});
