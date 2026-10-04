import { defineConfig, devices } from "@playwright/test";

// UDD_BASE_URL points the tests at another deployment (the dispatcher uses it for production checks).
// Without it, Playwright starts the demo locally.
const external = process.env.UDD_BASE_URL;

export default defineConfig({
  testDir: "e2e",
  workers: 2,
  retries: 0,
  timeout: 60_000,
  use: { baseURL: external ?? "http://localhost:3100", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: external
    ? undefined
    : {
        command: "npm run start",
        url: "http://localhost:3100",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: { DATABASE_URL: process.env.DATABASE_URL ?? "postgres://udd:udd@localhost:55432/udd" },
      },
});
