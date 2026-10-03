import { describe, expect, it } from "vitest";
import { buildReport } from "../src/report";
import { validateReport } from "./validate";

describe("buildReport", () => {
  it("produces a report that passes the shared JSON Schema", () => {
    document.body.innerHTML = `<button id="b">Book</button>`;
    const report = buildReport({
      comment: "  Nothing happens  ",
      user: "alice",
      target: document.getElementById("b")!,
      screenshot: "data:image/png;base64,AAAA",
      capture: { consoleErrors: () => ["boom"], failedRequests: () => [{ method: "GET", url: "/x", status: 404 }] },
      win: window,
    });
    expect(report.comment).toBe("Nothing happens");
    expect(validateReport(report)).toEqual([]);
  });

  it("omits optional fields that are missing", () => {
    const report = buildReport({
      comment: "hi",
      capture: { consoleErrors: () => [], failedRequests: () => [] },
      win: window,
    });
    expect(report).not.toHaveProperty("screenshot");
    expect(report).not.toHaveProperty("target");
    expect(report).not.toHaveProperty("user");
    expect(validateReport(report)).toEqual([]);
  });
});

describe("buildReport — limits and privacy", () => {
  const capture = { consoleErrors: () => [], failedRequests: () => [] };

  it("drops the query string and fragment from the page URL", () => {
    window.history.replaceState(null, "", "/reset?token=abc#access_token=xyz");
    const report = buildReport({ comment: "x", capture, win: window });
    expect(report.context.url).toBe(`${window.location.origin}/reset`);
    window.history.replaceState(null, "", "/");
  });

  it("keeps an over-long user id and page URL within the schema", () => {
    window.history.replaceState(null, "", "/" + "p".repeat(2500));
    const report = buildReport({ comment: "x", user: "u".repeat(300), capture, win: window });
    expect(validateReport(report)).toEqual([]);
    window.history.replaceState(null, "", "/");
  });
});
