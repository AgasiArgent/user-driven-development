import { describe, expect, it, vi } from "vitest";
import { createLinearTracker } from "../src/tracker/linear.ts";
import { MemoryTracker } from "../src/tracker/memory.ts";

describe("MemoryTracker", () => {
  it("creates issues in Triage and moves them between states", async () => {
    const t = new MemoryTracker();
    const a = await t.create({ title: "A", body: "x", labels: ["feedback"] });
    expect(a).toMatchObject({ key: "MEM-1", state: "Triage", labels: ["feedback"] });
    await t.setState(a.id, "Approved for fix");
    expect((await t.listByState("Approved for fix")).map((i) => i.id)).toEqual([a.id]);
    await t.comment(a.id, "hello");
    expect(t.comments.get(a.id)).toEqual(["hello"]);
  });

  it("finds an open issue by a marker in its body, but not a finished one", async () => {
    const t = new MemoryTracker();
    const a = await t.create({ title: "A", body: "<!-- udd:fp=abc -->", labels: [] });
    expect((await t.findOpenByMarker("udd:fp=abc"))?.id).toBe(a.id);
    await t.setState(a.id, "Done");
    expect(await t.findOpenByMarker("udd:fp=abc")).toBeNull();
  });
});

describe("Linear tracker", () => {
  const states = { data: { workflowStates: { nodes: [{ id: "s-triage", name: "Triage" }, { id: "s-approved", name: "Approved for fix" }, { id: "s-review", name: "In Review" }] } } };
  const labels = { data: { issueLabels: { nodes: [{ id: "l-feedback", name: "feedback" }, { id: "l-nofly", name: "no-auto-fix" }] } } };
  const node = { id: "i1", identifier: "ENG-7", title: "T", description: "B", state: { name: "Triage" }, labels: { nodes: [{ name: "feedback" }] } };

  function fakeLinear() {
    return vi.fn(async (_url: string, init: RequestInit) => {
      const { query } = JSON.parse(init.body as string) as { query: string };
      if (query.includes("workflowStates")) return Response.json(states);
      if (query.includes("issueLabels")) return Response.json(labels);
      if (query.includes("issueCreate")) return Response.json({ data: { issueCreate: { success: true, issue: node } } });
      if (query.includes("issueUpdate")) return Response.json({ data: { issueUpdate: { success: true } } });
      if (query.includes("commentCreate")) return Response.json({ data: { commentCreate: { success: true } } });
      if (query.includes("issues(")) return Response.json({ data: { issues: { nodes: [node] } } });
      return Response.json({ errors: [{ message: "unexpected query" }] });
    });
  }
  const body = (fetchFn: ReturnType<typeof fakeLinear>, i: number) => JSON.parse((fetchFn.mock.calls[i][1] as RequestInit).body as string);

  it("creates an issue in the team's Triage state with label ids, using the API key as is", async () => {
    const fetchFn = fakeLinear();
    const t = createLinearTracker({ apiKey: "lin_api_x", teamId: "team-1", fetchFn: fetchFn as unknown as typeof fetch });
    const issue = await t.create({ title: "T", body: "B", labels: ["feedback"] });
    expect(issue).toMatchObject({ id: "i1", key: "ENG-7", state: "Triage", labels: ["feedback"] });
    const create = fetchFn.mock.calls.map((_, i) => body(fetchFn, i)).find((b) => b.query.includes("issueCreate"));
    expect(create.variables.input).toEqual({ teamId: "team-1", title: "T", description: "B", stateId: "s-triage", labelIds: ["l-feedback"] });
    expect((fetchFn.mock.calls[0][1] as RequestInit).headers).toMatchObject({ authorization: "lin_api_x" });
  });

  it("looks up workflow states once and reuses them", async () => {
    const fetchFn = fakeLinear();
    const t = createLinearTracker({ apiKey: "k", teamId: "team-1", fetchFn: fetchFn as unknown as typeof fetch });
    await t.setState("i1", "Approved for fix");
    await t.setState("i1", "In Review");
    const lookups = fetchFn.mock.calls.filter((_, i) => body(fetchFn, i).query.includes("workflowStates"));
    expect(lookups).toHaveLength(1);
    const updates = fetchFn.mock.calls.map((_, i) => body(fetchFn, i)).filter((b) => b.query.includes("issueUpdate"));
    expect(updates.map((u) => u.variables)).toEqual([{ id: "i1", stateId: "s-approved" }, { id: "i1", stateId: "s-review" }]);
  });

  it("fails clearly when a state or label does not exist in the team", async () => {
    const t = createLinearTracker({ apiKey: "k", teamId: "team-1", fetchFn: fakeLinear() as unknown as typeof fetch });
    await expect(t.setState("i1", "Canceled")).rejects.toThrow(/state "Canceled"/);
    await expect(t.create({ title: "T", body: "B", labels: ["missing"] })).rejects.toThrow(/label "missing"/);
  });

  it("turns GraphQL errors into exceptions", async () => {
    const fetchFn = vi.fn(async () => Response.json({ errors: [{ message: "Authentication required" }] }));
    const t = createLinearTracker({ apiKey: "bad", teamId: "team-1", fetchFn: fetchFn as unknown as typeof fetch });
    await expect(t.listByState("Triage")).rejects.toThrow(/Authentication required/);
  });
});
