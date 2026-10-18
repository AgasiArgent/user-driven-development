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
  it("never puts the user's email in the issue; shows the opaque reporter id", () => {
    const issue = renderIssue(1, { ...payload("hi"), user: "jane@example.com", reporterId: "a1b2c3d4e5f6" });
    expect(issue.title + issue.body).not.toMatch(/jane|example\.com/);
    expect(issue.body).toContain("**Reporter:** `a1b2c3d4e5f6`");
  });
  it("shows unknown when there is no reporter id, and rejects an id that looks like an email", () => {
    expect(renderIssue(1, { ...payload("hi"), user: "jane@example.com" }).body).toContain("**Reporter:** unknown");
    const bad = renderIssue(1, { ...payload("hi"), reporterId: "jane@example.com" });
    expect(bad.body).not.toContain("jane");
    expect(bad.body).toContain("**Reporter:** unknown");
  });
  it("cuts a long title at a word boundary within 80 characters", () => {
    const t = renderIssue(7, payload("The total looks wrong. I set the last item to 3 but the total only counts one of it.")).title;
    expect(t).toBe("[FB-7] The total looks wrong. I set the last item to 3 but the total only counts one…");
    expect(t.slice("[FB-7] ".length).length).toBeLessThanOrEqual(80);
  });
  it("cuts a long title hard when there is no space near the end", () => {
    const t = renderIssue(7, payload("x".repeat(200))).title.slice("[FB-7] ".length);
    expect(Array.from(t).length).toBe(80);
    expect(t.endsWith("…")).toBe(true);
  });
  it("keeps a short title untouched", () => {
    expect(renderIssue(7, payload("Short one")).title).toBe("[FB-7] Short one");
  });
});
