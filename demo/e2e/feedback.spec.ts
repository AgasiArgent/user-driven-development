import { expect, test } from "@playwright/test";
import { query } from "./db";

test("a pinned report is saved once, with a screenshot, and shows up in My feedback", async ({ page }) => {
  const comment = `Book button does nothing ${Date.now()}`;
  await page.goto("/rooms/1");

  await page.getByRole("button", { name: "Feedback" }).click();
  await page.getByRole("button", { name: "Book", exact: true }).click(); // pins the element, does not submit the form
  await page.getByLabel("What is wrong here?").fill(comment);

  // Two clicks in the same tick: the widget must send one request.
  await page.locator("udd-feedback").evaluate((host) => {
    const send = host.shadowRoot!.querySelector<HTMLButtonElement>(".send")!;
    send.click();
    send.click();
  });

  const status = page.getByRole("status").filter({ hasText: "your feedback is" });
  await expect(status).toContainText(/FB-\d+/, { timeout: 30_000 });
  const id = (await status.textContent())!.match(/FB-\d+/)![0];

  const rows = await query<{ id: string; has_screenshot: boolean; selector: string }>(
    "SELECT id, screenshot IS NOT NULL AS has_screenshot, payload->'target'->>'selector' AS selector FROM feedback_outbox WHERE payload->>'comment' = $1",
    [comment],
  );
  expect(rows).toHaveLength(1);
  expect(`FB-${rows[0].id}`).toBe(id);
  expect(rows[0].has_screenshot).toBe(true);
  // The stored selector is a document CSS selector (it does not look inside the widget's shadow root).
  expect(await page.evaluate((sel) => document.querySelector(sel)?.textContent, rows[0].selector)).toBe("Book");

  await page.goto("/reports");
  await expect(page.getByRole("row", { name: new RegExp(id) })).toContainText("received");
});

test("page styles cannot reach the widget, and the widget's styles stay inside it", async ({ page }) => {
  await page.goto("/rooms/1");
  expect(await page.locator("udd-feedback").evaluate((host) => host.shadowRoot !== null)).toBe(true);
  await page.addStyleTag({ content: "button { background: rgb(255, 0, 0) !important; }" });
  const bg = (name: string) => page.getByRole("button", { name, exact: true }).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await bg("Feedback")).toBe("rgb(31, 41, 55)"); // the widget keeps its own look
  expect(await bg("Book")).toBe("rgb(255, 0, 0)"); // the hostile rule does apply to the page
});
