import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CodingAgent } from "../src/agent/types.ts";
import { dispatchOnce, type DispatchDeps } from "../src/dispatcher.ts";
import { getRun } from "../src/store.ts";
import { MemoryTracker } from "../src/tracker/memory.ts";
import { fail, fakeExec, ok, on } from "./fakeExec.ts";
import { freshTestDb } from "./testDb.ts";

let db: pg.Pool;
beforeAll(async () => {
  db = await freshTestDb();
});
afterAll(() => db.end());
beforeEach(() => db.query("TRUNCATE dispatch_runs"));

class ScriptedAgent implements CodingAgent {
  prompts: string[] = [];
  constructor(private outcome: "ready" | "failed" = "ready") {}
  async start(prompt: string) {
    this.prompts.push(prompt);
    return { taskId: `task_${this.prompts.length}` };
  }
  async poll() {
    return this.outcome;
  }
  async apply() {}
}

interface Script {
  scenario?: "fails" | "passes" | "missing";
  changed?: string;
  checks?: "pass" | "fail";
}

function setup(script: Script = {}, agent = new ScriptedAgent()) {
  const { scenario = "fails", changed = "demo/components/BookingForm.tsx", checks = "pass" } = script;
  const f = fakeExec([
    on("npx playwright", () => (scenario === "missing" ? { code: 1, stdout: "Error: No tests found", stderr: "" } : scenario === "fails" ? fail("1 failed") : ok("1 passed"))),
    on("git status --porcelain", ok(changed ? ` M ${changed}\n` : "")),
    on("git diff --name-only", ok(changed ? `${changed}\n` : "")),
    on("npm run test:unit", () => (checks === "pass" ? ok("all passed") : fail("FAIL demo/test/bookings.test.ts: expected 409, got 201"))),
    on("gh pr create", ok("https://github.com/acme/roomly/pull/12\n")),
  ]);
  const tracker = new MemoryTracker();
  const deps: DispatchDeps = {
    db,
    tracker,
    agent,
    exec: f.exec,
    repoDir: "/repo",
    worktreeRoot: "/tmp/udd-wt",
    prodUrl: "https://roomly.example",
    noFlyPaths: [".github/**", "demo/lib/feedback.ts"],
    sleep: async () => {},
    maxPolls: 3,
  };
  return { f, tracker, agent, deps };
}

async function approved(tracker: MemoryTracker, body = "Book button is cut off\nScenario: bug 3", labels = ["feedback"]) {
  const issue = await tracker.create({ title: "[FB-1] Book button is cut off", body, labels });
  await tracker.setState(issue.id, "Approved for fix");
  return issue;
}

describe("dispatchOnce", () => {
  it("runs the whole path once: failing scenario → agent → checks → draft PR → In Progress", async () => {
    const { f, tracker, agent, deps } = setup();
    const issue = await approved(tracker);
    expect(await dispatchOnce(deps)).toMatchObject({ prOpened: 1 });
    expect(agent.prompts).toHaveLength(1);
    expect(agent.prompts[0]).toContain("UNTRUSTED");
    expect(agent.prompts[0]).toContain("bug 3");
    expect((await tracker.get(issue.id)).state).toBe("In Progress");
    expect(tracker.comments.get(issue.id)?.at(-1)).toContain("https://github.com/acme/roomly/pull/12");
    expect(await getRun(db, issue.id)).toMatchObject({ status: "pr_opened", round: 1, branch: "udd/MEM-1" });
    const lines = f.calls.map((_, i) => f.line(i));
    expect(lines.some((l) => l.startsWith("gh pr create --draft"))).toBe(true);
    expect(lines.some((l) => l.startsWith("git worktree remove"))).toBe(true);
  });

  it("never starts a second agent for the same issue", async () => {
    const { tracker, agent, deps } = setup();
    const issue = await approved(tracker);
    await dispatchOnce(deps);
    await tracker.setState(issue.id, "Approved for fix"); // someone parks it in the approval status again
    await dispatchOnce(deps);
    expect(agent.prompts).toHaveLength(1);
  });

  it("does not touch issues labelled no-auto-fix", async () => {
    const { tracker, agent, deps } = setup();
    const issue = await approved(tracker, "Payment wrong\nScenario: x", ["feedback", "no-auto-fix"]);
    await dispatchOnce(deps);
    expect(agent.prompts).toHaveLength(0);
    expect((await tracker.get(issue.id)).state).toBe("Triage");
    expect(tracker.comments.get(issue.id)?.[0]).toMatch(/no-fly/i);
  });

  it("sends an issue without a scenario back to Triage and explains what is missing", async () => {
    const { tracker, agent, deps } = setup();
    const issue = await approved(tracker, "Book button is cut off");
    await dispatchOnce(deps);
    expect(agent.prompts).toHaveLength(0);
    expect((await tracker.get(issue.id)).state).toBe("Triage");
    expect(tracker.comments.get(issue.id)?.[0]).toContain("Scenario:");
  });

  it("stops when the scenario already passes in production (it does not reproduce the problem)", async () => {
    const { tracker, agent, deps } = setup({ scenario: "passes" });
    const issue = await approved(tracker);
    await dispatchOnce(deps);
    expect(agent.prompts).toHaveLength(0);
    expect(tracker.comments.get(issue.id)?.[0]).toMatch(/already passes/);
  });

  it("stops when the named scenario does not exist", async () => {
    const { tracker, agent, deps } = setup({ scenario: "missing" });
    const issue = await approved(tracker);
    await dispatchOnce(deps);
    expect(agent.prompts).toHaveLength(0);
    expect(tracker.comments.get(issue.id)?.[0]).toMatch(/not found/);
  });

  it("gives the agent three rounds with the failure output, then hands the issue to a human", async () => {
    const { f, tracker, agent, deps } = setup({ checks: "fail" });
    const issue = await approved(tracker);
    expect(await dispatchOnce(deps)).toMatchObject({ needsHuman: 1, prOpened: 0 });
    expect(agent.prompts).toHaveLength(3);
    expect(agent.prompts[1]).toContain("expected 409, got 201");
    expect((await tracker.get(issue.id)).state).toBe("Triage");
    expect(tracker.comments.get(issue.id)?.at(-1)).toMatch(/needs a human/i);
    expect(f.calls.some((c) => c.cmd === "gh")).toBe(false);
  });

  it("opens no PR when the agent changed a no-fly path, and does not retry", async () => {
    const { tracker, agent, deps } = setup({ changed: "demo/lib/feedback.ts" });
    const issue = await approved(tracker);
    await dispatchOnce(deps);
    expect(agent.prompts).toHaveLength(1);
    expect(tracker.comments.get(issue.id)?.at(-1)).toContain("demo/lib/feedback.ts");
    expect((await tracker.get(issue.id)).state).toBe("Triage");
  });

  it("lets a human approve again after a hand-back, and then starts fresh", async () => {
    const { tracker, agent, deps } = setup({ checks: "fail" });
    const issue = await approved(tracker);
    await dispatchOnce(deps);
    await tracker.setState(issue.id, "Approved for fix");
    await dispatchOnce(deps);
    expect(agent.prompts).toHaveLength(6);
  });

  it("counts an agent task that failed in the cloud as a failed round", async () => {
    const { tracker, agent, deps } = setup({}, new ScriptedAgent("failed"));
    await approved(tracker);
    expect(await dispatchOnce(deps)).toMatchObject({ needsHuman: 1 });
    expect(agent.prompts).toHaveLength(3);
  });
});
