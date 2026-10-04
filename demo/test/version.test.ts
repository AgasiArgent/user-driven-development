import { describe, expect, it } from "vitest";
import { versionResponse } from "../lib/version";

describe("GET /api/version", () => {
  it("reports the deployed commit from GIT_SHA", async () => {
    expect(await versionResponse({ GIT_SHA: "0123abc" }).json()).toEqual({ sha: "0123abc" });
  });

  it("reports null when the build did not set it", async () => {
    expect(await versionResponse({}).json()).toEqual({ sha: null });
  });
});
