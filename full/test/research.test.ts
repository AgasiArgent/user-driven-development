import { describe, expect, it, vi } from "vitest";
import { fingerprint, findCodeRefs, research } from "../src/research.ts";
import { checkNoFly } from "../src/noFly.ts";
import { memoryRepo } from "./helpers.ts";

const repo = memoryRepo({
  "demo/components/BookingForm.tsx": 'export function BookingForm() {\n  return <div className="when"><button>Book</button></div>;\n}',
  "demo/app/rooms/[id]/page.tsx": "// rooms page\nexport default function RoomPage() {}",
  "demo/lib/feedback.ts": "export function handleFeedbackPost() {}",
  "README.md": "Book a room",
  "node_modules/x/index.js": "Book",
});
const payload = {
  comment: "The Book button is cut off",
  createdAt: "2026-10-04T10:00:00.000Z",
  context: { url: "http://localhost:3100/rooms/1?x=1" },
  target: { selector: ".when > button", tagName: "button", text: "Book" },
};

describe("findCodeRefs", () => {
  it("ranks source files by the element text, selector classes and URL path, skipping docs and dependencies", async () => {
    const refs = await findCodeRefs(payload, repo);
    expect(refs[0]).toEqual({ file: "demo/components/BookingForm.tsx", line: 2, snippet: expect.stringContaining("Book") });
    expect(refs.map((r) => r.file)).toContain("demo/app/rooms/[id]/page.tsx");
    expect(refs.map((r) => r.file)).not.toContain("README.md");
    expect(refs.map((r) => r.file)).not.toContain("node_modules/x/index.js");
  });
});

describe("fingerprint", () => {
  it("is the same for the same element and page with different ids, case and punctuation", () => {
    const a = fingerprint(payload);
    const b = fingerprint({ ...payload, comment: "the BOOK button is cut off!!", context: { url: "http://localhost:3100/rooms/7" } });
    expect(a).toBe(b);
  });

  it("differs for another element", () => {
    expect(fingerprint(payload)).not.toBe(fingerprint({ ...payload, target: { selector: "h1", tagName: "h1", text: "Aurora" } }));
  });
});

describe("research", () => {
  it("says plainly that it is unsure when no model is configured", async () => {
    const r = await research(payload, repo);
    expect(r.kind).toBe("unknown");
    expect(r.uncertainty).toMatch(/no model/i);
    expect(r.codeRefs.length).toBeGreaterThan(0);
  });

  it("uses the model's classification when one is given", async () => {
    const model = { analyse: vi.fn(async () => ({ kind: "bug" as const, summary: "Button overflows on narrow screens", uncertainty: "Not reproduced" })) };
    const r = await research(payload, repo, model);
    expect(r).toMatchObject({ kind: "bug", summary: "Button overflows on narrow screens", uncertainty: "Not reproduced" });
    expect(model.analyse).toHaveBeenCalledWith(expect.objectContaining({ comment: payload.comment, codeRefs: r.codeRefs }));
  });

  it("falls back and records the failure when the model call fails", async () => {
    const model = { analyse: vi.fn(async () => { throw new Error("overloaded"); }) };
    const r = await research(payload, repo, model);
    expect(r.kind).toBe("unknown");
    expect(r.uncertainty).toContain("overloaded");
  });
});

describe("checkNoFly", () => {
  const rules = { paths: ["demo/lib/feedback.ts", "contracts/**"], keywords: ["payment", "permission"] };

  it("blocks when a code reference is in a no-fly path", () => {
    expect(checkNoFly(payload, [{ file: "demo/lib/feedback.ts", line: 1, snippet: "" }], rules)).toEqual({ blocked: true, reasons: ["code in no-fly path: demo/lib/feedback.ts"] });
  });

  it("blocks when a word in the report starts with a no-fly keyword (a false alarm is cheaper than a miss)", () => {
    expect(checkNoFly({ ...payload, comment: "Payment fails" }, [], rules).reasons).toEqual(['report mentions "payment"']);
    expect(checkNoFly({ ...payload, comment: "Permissions page is slow" }, [], rules).blocked).toBe(true);
    expect(checkNoFly({ ...payload, comment: "Prepayment banner overlaps" }, [], rules).blocked).toBe(false);
  });

  it("passes an ordinary report", () => {
    expect(checkNoFly(payload, [{ file: "demo/components/BookingForm.tsx", line: 2, snippet: "" }], rules)).toEqual({ blocked: false, reasons: [] });
  });
});
