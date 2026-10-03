import { afterEach, describe, expect, it, vi } from "vitest";
import { installCapture } from "../src/capture";

describe("installCapture", () => {
  let uninstall: (() => void) | undefined;
  afterEach(() => uninstall?.());

  it("keeps only the last 20 console errors, each cut to 500 characters", () => {
    const silent = vi.spyOn(console, "error").mockImplementation(() => {});
    const cap = installCapture(window);
    uninstall = cap.uninstall;
    for (let i = 0; i < 25; i++) console.error(`error ${i}`);
    console.error("y".repeat(600));
    const errors = cap.consoleErrors();
    expect(errors).toHaveLength(20);
    expect(errors[0]).toBe("error 6");
    expect(errors[19]).toHaveLength(500);
    silent.mockRestore();
  });

  it("records failed fetches without the query string", async () => {
    window.fetch = vi.fn(async () => new Response("no", { status: 500 })) as typeof fetch;
    const cap = installCapture(window);
    uninstall = cap.uninstall;
    await window.fetch("http://localhost/api/rooms?token=secret", { method: "POST" });
    expect(cap.failedRequests()).toEqual([
      { method: "POST", url: "http://localhost/api/rooms", status: 500 },
    ]);
  });

  it("records network errors as status 0 and rethrows them", async () => {
    window.fetch = vi.fn(async () => {
      throw new TypeError("network down");
    }) as typeof fetch;
    const cap = installCapture(window);
    uninstall = cap.uninstall;
    await expect(window.fetch("/api/x")).rejects.toThrow("network down");
    expect(cap.failedRequests()[0]).toMatchObject({ method: "GET", status: 0 });
  });

  it("does not record successful requests", async () => {
    window.fetch = vi.fn(async () => new Response("ok", { status: 200 })) as typeof fetch;
    const cap = installCapture(window);
    uninstall = cap.uninstall;
    await window.fetch("/api/ok");
    expect(cap.failedRequests()).toEqual([]);
  });
});

describe("installCapture — robustness", () => {
  it("never breaks the app's console.error, even for circular objects", () => {
    const original = vi.spyOn(console, "error").mockImplementation(() => {});
    const cap = installCapture(window);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => console.error("bad", circular, 10n)).not.toThrow();
    expect(original).toHaveBeenCalledTimes(1);
    expect(cap.consoleErrors()[0]).toMatch(/^bad /);
    cap.uninstall();
    original.mockRestore();
  });

  it("cuts long messages on a character boundary, never inside an emoji", () => {
    const silent = vi.spyOn(console, "error").mockImplementation(() => {});
    const cap = installCapture(window);
    console.error("a".repeat(499) + "😀😀");
    const msg = cap.consoleErrors()[0];
    expect([...msg]).toHaveLength(500);
    expect(msg.endsWith("😀")).toBe(true);
    cap.uninstall();
    silent.mockRestore();
  });
});
