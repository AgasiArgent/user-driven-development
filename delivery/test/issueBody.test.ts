import { describe, expect, it } from "vitest";
import { renderIssue, type Payload } from "../src/issueBody.ts";

const payload = (comment: string): Payload => ({ comment, createdAt: "2026-10-17T00:00:00Z", context: { url: "https://x.test/" } });

describe("renderIssue", () => {
  it("truncates a huge report so the body stays within 65000 characters", () => {
    const issue = renderIssue(1, payload("x".repeat(70_000)));
    expect(issue.body.length).toBeLessThanOrEqual(65_000);
    expect(issue.body).toContain("_(truncated)_");
    expect(issue.body).toContain("### Report");
    expect(issue.body).toContain("Add the label `approved`");
  });
  it("does not truncate a normal report", () => {
    expect(renderIssue(1, payload("short")).body).not.toContain("_(truncated)_");
  });
});
