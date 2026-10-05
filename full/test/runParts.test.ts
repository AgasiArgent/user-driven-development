import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCodexCloudAgent } from "../src/agent/codexCloud.ts";
import { runScenario, scenarioFrom } from "../src/scenario.ts";
import { claim, getRun, updateRun } from "../src/store.ts";
import { fakeExec, ok, on, pwBroken, pwFails, pwMissing, pwPasses } from "./fakeExec.ts";
import { freshTestDb } from "./testDb.ts";

let db: pg.Pool;
beforeAll(async () => {
  db = await freshTestDb();
});
afterAll(() => db.end());
beforeEach(() => db.query("TRUNCATE dispatch_runs"));

describe("store", () => {
  it("lets exactly one caller claim an issue, even when they race", async () => {
    const results = await Promise.all([claim(db, "i1", "ENG-1"), claim(db, "i1", "ENG-1"), claim(db, "i1", "ENG-1")]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await getRun(db, "i1")).toMatchObject({ issue_key: "ENG-1", status: "claimed", round: 0 });
  });

  it("updates selected fields", async () => {
    await claim(db, "i2", "ENG-2");
    await updateRun(db, "i2", { status: "coding", round: 1, task_id: "task_1" });
    expect(await getRun(db, "i2")).toMatchObject({ status: "coding", round: 1, task_id: "task_1" });
  });
});

describe("scenario", () => {
  it("reads the scenario name from the issue body", () => {
    expect(scenarioFrom("text\nScenario: bug 3\nmore")).toBe("bug 3");
    expect(scenarioFrom("no scenario here")).toBeNull();
  });

  it("runs the named test against the given URL, with the known-bug marker off and an isolated environment", async () => {
    const f = fakeExec([on("npx playwright", pwFails())]);
    expect(await runScenario(f.exec, { name: "bug 3", baseUrl: "https://prod.example", cwd: "/wt/demo" })).toBe("fails");
    expect(f.calls[0]).toMatchObject({ cmd: "npx", args: ["playwright", "test", "-g", "bug 3", "--reporter=json"], cwd: "/wt/demo", isolated: true });
    expect(f.calls[0].env).toMatchObject({ UDD_BASE_URL: "https://prod.example", EXPECT_FIXED: "1" });
  });

  it("reports passes when the test passes", async () => {
    expect(await runScenario(fakeExec([on("npx playwright", pwPasses())]).exec, { name: "bug 3", baseUrl: "u", cwd: "c" })).toBe("passes");
  });

  it("treats 'no tests found' as missing", async () => {
    expect(await runScenario(fakeExec([on("npx playwright", pwMissing())]).exec, { name: "nope", baseUrl: "u", cwd: "c" })).toBe("missing");
  });

  it("treats a run that could not test anything (no browser, site down, garbage output) as an error, not as a failing test", async () => {
    expect(await runScenario(fakeExec([on("npx playwright", pwBroken())]).exec, { name: "bug 3", baseUrl: "u", cwd: "c" })).toBe("error");
    expect(await runScenario(fakeExec([on("npx playwright", { code: 1, stdout: "Segmentation fault", stderr: "" })]).exec, { name: "bug 3", baseUrl: "u", cwd: "c" })).toBe("error");
  });
});

describe("Codex Cloud agent", () => {
  it("starts a task with the environment and the prompt, and reads the task id", async () => {
    const f = fakeExec([on("codex cloud exec", ok("Submitted task task_e_68f1c0ffee\nhttps://chatgpt.com/codex/tasks/task_e_68f1c0ffee"))]);
    const agent = createCodexCloudAgent({ exec: f.exec, envId: "env-123" });
    expect(await agent.start("Fix ENG-7")).toEqual({ taskId: "task_e_68f1c0ffee" });
    expect(f.calls[0].args).toEqual(["cloud", "exec", "--env", "env-123", "--branch", "main", "Fix ENG-7"]);
  });

  it("fails clearly when no task id can be read", async () => {
    const agent = createCodexCloudAgent({ exec: fakeExec([on("codex cloud exec", ok("something unexpected"))]).exec, envId: "e" });
    await expect(agent.start("x")).rejects.toThrow(/task id/);
  });

  it("maps status output to pending, ready or failed", async () => {
    const answers = ["Status: RUNNING", "Status: READY", "Status: ERROR"];
    let i = 0;
    const agent = createCodexCloudAgent({ exec: fakeExec([on("codex cloud status", () => ok(answers[i++]))]).exec, envId: "e" });
    expect(await agent.poll("t")).toBe("pending");
    expect(await agent.poll("t")).toBe("ready");
    expect(await agent.poll("t")).toBe("failed");
  });

  it("applies the diff in the given checkout", async () => {
    const f = fakeExec();
    const agent = createCodexCloudAgent({ exec: f.exec, envId: "e" });
    await agent.apply("task_1", "/tmp/wt");
    expect(f.calls[0]).toMatchObject({ cmd: "codex", args: ["cloud", "apply", "task_1"], cwd: "/tmp/wt" });
  });
});
