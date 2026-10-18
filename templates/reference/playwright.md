# Playwright and lint notes for SETUP.md

## Global setup sketch (`e2e/global-setup.ts`)

Adapt the login to the app (a form, or a POST to the app's login route). It signs in the test
account once and saves the session. With no credentials it writes an empty state and warns, so the
smoke test still runs signed out.

```ts
import { chromium, type FullConfig } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL as string;
  const { UDD_TEST_USER_EMAIL: email, UDD_TEST_USER_PASSWORD: password } = process.env;
  mkdirSync("e2e/.auth", { recursive: true });
  if (!email || !password) { console.warn("UDD_TEST_USER_* not set"); writeFileSync("e2e/.auth/state.json", "{}"); return; }
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL });
  // Against a Vercel preview, route the bypass header here too (same code as e2e/fixtures.ts).
  const page = await ctx.newPage();
  await page.goto("/login"); // adapt: path and field labels
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await ctx.storageState({ path: "e2e/.auth/state.json" });
  await browser.close();
}
```

Also: set `testDir: "./e2e"` in `playwright.config.ts` (otherwise Playwright scans the whole repo, including
`.udd/`), add `e2e/.auth/` to `.gitignore`, and use the app's own dev port as the fallback `baseURL`
(Vite: 5173, Next.js: 3000).

## Why the fixture parameter is not called `use`

In `e2e/fixtures.ts` the second argument of a fixture is named `provide`. The name `use` makes the
app's own `react-hooks/rules-of-hooks` lint rule fail, and `npm run lint` breaks.

## ESLint (and oxlint) ignores

The app's linter also scans files the kit adds. Add `public/widget.js` (a minified bundle, hundreds of
warnings) and `.udd/` to its ignore list: `globalIgnores([...])` in flat ESLint config, `ignorePatterns`
in oxlint. Check: `npm run lint` gives the same result as before the setup.
