import { describe, expect, it } from "vitest";
import { validateReport } from "./validate";

const valid = {
  comment: "The booking button does nothing",
  createdAt: "2026-10-03T12:00:00.000Z",
  context: { url: "http://localhost:3100/rooms/1" },
};

describe("feedback report schema", () => {
  it("accepts a minimal valid report", () => {
    expect(validateReport(valid)).toEqual([]);
  });

  it("rejects a report without a comment", () => {
    const { comment, ...rest } = valid;
    expect(validateReport(rest)).not.toEqual([]);
  });

  it("rejects unknown top-level fields", () => {
    expect(validateReport({ ...valid, extra: 1 })).not.toEqual([]);
  });

  it("rejects a comment longer than 4000 characters", () => {
    expect(validateReport({ ...valid, comment: "x".repeat(4001) })).not.toEqual([]);
  });
});
