import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { gitRepo } from "../src/repo.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));

describe("gitRepo", () => {
  it("lists tracked files and leaves out ignored folders", async () => {
    const files = await gitRepo(root, ["full/**", "delivery/**"]).list();
    expect(files).toContain("demo/components/BookingForm.tsx");
    expect(files.some((f) => f.startsWith("full/") || f.startsWith("delivery/"))).toBe(false);
  });
});
