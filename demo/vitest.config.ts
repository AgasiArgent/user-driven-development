import { defineConfig } from "vitest/config";

// Unit and intake tests only; demo/e2e is run by Playwright.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
});
