import { describe, expect, it, vi } from "vitest";
import { createAnthropicModel } from "../src/model.ts";

describe("Anthropic model adapter", () => {
  const input = { comment: "Book button cut off", url: "http://x/rooms/1", codeRefs: [{ file: "a.tsx", line: 2, snippet: "<button>Book</button>" }] };

  it("sends the report as untrusted data and parses the JSON answer", async () => {
    const fetchFn = vi.fn(async () => Response.json({ content: [{ type: "text", text: '{"kind":"bug","summary":"Overflow","uncertainty":"Not reproduced"}' }] }));
    const model = createAnthropicModel({ apiKey: "k", model: "claude-sonnet-5-5", fetchFn: fetchFn as unknown as typeof fetch });
    expect(await model.analyse(input)).toEqual({ kind: "bug", summary: "Overflow", uncertainty: "Not reproduced" });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("k");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.system).toMatch(/untrusted/i);
    expect(body.messages[0].content).toContain("Book button cut off");
  });

  it("rejects an answer that is not the expected JSON", async () => {
    const fetchFn = vi.fn(async () => Response.json({ content: [{ type: "text", text: "Sure! It is a bug." }] }));
    const model = createAnthropicModel({ apiKey: "k", model: "m", fetchFn: fetchFn as unknown as typeof fetch });
    await expect(model.analyse(input)).rejects.toThrow(/not valid JSON/);
  });

  it("throws on an HTTP error", async () => {
    const fetchFn = vi.fn(async () => new Response("overloaded", { status: 529 }));
    const model = createAnthropicModel({ apiKey: "k", model: "m", fetchFn: fetchFn as unknown as typeof fetch });
    await expect(model.analyse(input)).rejects.toThrow(/529/);
  });
});
