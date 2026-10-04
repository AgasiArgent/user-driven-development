import { describe, expect, it, vi } from "vitest";
import { createGitHubClient } from "../src/github.ts";

describe("createGitHubClient", () => {
  it("creates an issue with the REST API and returns its number", async () => {
    const fetchFn = vi.fn(async () => Response.json({ number: 42 }, { status: 201 }));
    const gh = createGitHubClient({ token: "t0ken", repo: "acme/roomly", fetchFn });
    expect(await gh.createIssue({ title: "T", body: "B", labels: ["feedback"] })).toEqual({ number: 42 });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/acme/roomly/issues");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer t0ken");
    expect(JSON.parse(init.body as string)).toEqual({ title: "T", body: "B", labels: ["feedback"] });
  });

  it("reads state, reason and label names", async () => {
    const fetchFn = vi.fn(async () => Response.json({ state: "closed", state_reason: "completed", labels: [{ name: "feedback" }, { name: "approved" }] }));
    const gh = createGitHubClient({ token: "t", repo: "acme/roomly", fetchFn });
    expect(await gh.getIssue(7)).toEqual({ state: "closed", stateReason: "completed", labels: ["feedback", "approved"] });
  });

  it("throws with the status code on an error response", async () => {
    const fetchFn = vi.fn(async () => new Response("rate limited", { status: 403 }));
    const gh = createGitHubClient({ token: "t", repo: "acme/roomly", fetchFn });
    await expect(gh.createIssue({ title: "T", body: "B", labels: [] })).rejects.toThrow(/403/);
  });
});
