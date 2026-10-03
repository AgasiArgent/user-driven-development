import { describe, expect, it, vi } from "vitest";
import { createSubmitter } from "../src/submit";

const report = { comment: "x", createdAt: "2026-10-03T00:00:00.000Z", context: { url: "/" } };

describe("createSubmitter", () => {
  it("returns the id from a 201 response", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ id: "FB-7", status: "received" }), { status: 201 }));
    const submit = createSubmitter(fetchFn as typeof fetch);
    await expect(submit("/api/feedback", report)).resolves.toBe("FB-7");
  });

  it("sends only one request while a submission is in flight", async () => {
    let release!: (r: Response) => void;
    const fetchFn = vi.fn(() => new Promise<Response>((r) => (release = r)));
    const submit = createSubmitter(fetchFn as unknown as typeof fetch);
    const first = submit("/api/feedback", report);
    const second = submit("/api/feedback", report);
    release(new Response(JSON.stringify({ id: "FB-1" }), { status: 201 }));
    await expect(first).resolves.toBe("FB-1");
    await expect(second).resolves.toBe("FB-1");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("throws the server's error text on a non-201 response", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ error: "comment is required" }), { status: 400 }));
    const submit = createSubmitter(fetchFn as typeof fetch);
    await expect(submit("/api/feedback", report)).rejects.toThrow("comment is required");
  });

  it("allows a new submission after the previous one finished", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ id: "FB-2" }), { status: 201 }));
    const submit = createSubmitter(fetchFn as typeof fetch);
    await submit("/api/feedback", report);
    await submit("/api/feedback", report);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe("createSubmitter — timeout", () => {
  it("gives up after 30 seconds and allows another try", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn((_url: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    );
    const submit = createSubmitter(fetchFn as unknown as typeof fetch);
    const pending = submit("/api/feedback", report);
    const assertion = expect(pending).rejects.toThrow(/did not answer/);
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    vi.useRealTimers();
  });
});
