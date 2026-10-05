import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CodingAgent } from "../src/agent/types.ts";
import { dispatchOnce, type DispatchDeps } from "../src/dispatcher.ts";
import { getRun } from "../src/store.ts";
import { MemoryTracker } from "../src/tracker/memory.ts";
import { fail, fakeExec, ok, on, pwBroken, pwFails, pwMissing, pwPasses } from "./fakeExec.ts";
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
  scenario?: "fails" | "passes" | "missing" | "error";
  changed?: string;
  checks?: "pass" | "fail";
}

function setup(script: Script = {}, agent = new ScriptedAgent()) {
  const { scenario = "fails", changed = "demo/components/BookingForm.tsx", checks = "pass" } = script;
  const f = fakeExec([
    on("npx playwright", () => ({ fails: pwFails, passes: pwPasses, missing: pwMissing, error: pwBroken })[scenario]()),
    on("git status --porcelain", ok(changed ? ` M ${changed}\n` : "")),
    on("git diff --name-only", ok(changed ? `${changed}\n` : "")),
    on("npm ci", ok()),
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
    checksEnv: { DATABASE_URL: "postgres://throwaway/checks" },
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

  it("runs install and checks in an isolated environment with the throwaway database, never the app's", async () => {
    const { f, tracker, deps } = setup();
    await approved(tracker);
    await dispatchOnce(deps);
    const agentCode = f.calls.filter((c) => c.cmd === "npm" || c.cmd === "npx");
    expect(agentCode.length).toBeGreaterThanOrEqual(3);
    for (const c of agentCode) expect(c.isolated).toBe(true);
    for (const c of agentCode.filter((c) => c.cmd === "npm")) expect(c.env?.DATABASE_URL).toBe("postgres://throwaway/checks");
  });

  it("runs the red-first scenario from a fresh checkout of main, not from a stale clone", async () => {
    const { f, tracker, deps } = setup();
    await approved(tracker);
    await dispatchOnce(deps);
    const lines = f.calls.map((_, i) => f.line(i));
    const add = lines.findIndex((l) => l.startsWith("git worktree add"));
    const red = f.calls.findIndex((c) => c.cmd === "npx");
    expect(add).toBeGreaterThanOrEqual(0);
    expect(red).toBeGreaterThan(add);
    expect(f.calls[red].cwd).toBe("/tmp/udd-wt/MEM-1/demo");
    expect(lines.findIndex((l) => l.startsWith("git worktree remove"))).toBeLessThan(add); // clears a leftover first
  });

  it("does not dispatch when the scenario could not run at all", async () => {
    const { tracker, agent, deps } = setup({ scenario: "error" });
    const issue = await approved(tracker);
    await dispatchOnce(deps);
    expect(agent.prompts).toHaveLength(0);
    expect(tracker.comments.get(issue.id)?.[0]).toMatch(/could not run/);
  });

  it("lists changed files without rename detection, so a moved no-fly file is still seen", async () => {
    const { f, tracker, deps } = setup();
    await approved(tracker);
    await dispatchOnce(deps);
    const diff = f.calls.find((c) => c.cmd === "git" && c.args[0] === "diff")!;
    expect(diff.args).toContain("--no-renames");
  });

  it("force-pushes its own branch, so a re-approval after a closed PR can push again", async () => {
    const { f, tracker, deps } = setup();
    await approved(tracker);
    await dispatchOnce(deps);
    expect(f.calls.find((c) => c.cmd === "git" && c.args[0] === "push")!.args).toContain("--force");
  });

  it("releases the claim when something fails before the agent starts, and keeps going with the next issue", async () => {
    const { tracker, agent, deps } = setup();
    const first = await approved(tracker);
    await approved(tracker);
    const realSetState = tracker.setState.bind(tracker);
    let broken = true;
    tracker.setState = async (id, state) => {
      if (broken && id === first.id) {
        broken = false;
        throw new Error("Linear: 503");
      }
      return realSetState(id, state);
    };
    const result = await dispatchOnce(deps);
    expect(await getRun(db, first.id)).toBeUndefined();
    expect(agent.prompts).toHaveLength(1);
    expect(result.prOpened).toBe(1);
  });
});
