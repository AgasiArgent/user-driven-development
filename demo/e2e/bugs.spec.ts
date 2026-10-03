import { expect, test } from "@playwright/test";

// Each test describes the CORRECT behavior and fails today because of a seeded bug
// (docs/demo-bugs.md). Run with EXPECT_FIXED=1 to see the real failures.
const knownBug = (n: number) => test.fail(!process.env.EXPECT_FIXED, `seeded bug #${n}`);

test("bug 1: a second booking of the same room and time is rejected", async ({ request }) => {
  knownBug(1);
  const day = 1 + (Date.now() % 27);
  const slot = { roomId: 3, title: `Overlap check ${Date.now()}`, bookedBy: "bob", startsAt: `2031-02-${String(day).padStart(2, "0")}T10:00:00.000Z`, endsAt: `2031-02-${String(day).padStart(2, "0")}T11:00:00.000Z` };
  expect((await request.post("/api/bookings", { data: slot })).status()).toBe(201);
  expect((await request.post("/api/bookings", { data: { ...slot, title: "Second" } })).status()).toBe(409);
});

test.describe("bug 2", () => {
  test.use({ timezoneId: "America/New_York" });

  test("a late booking appears under the day it starts in the browser's time zone", async ({ page }) => {
    knownBug(2);
    await page.goto("/rooms/4");
    const title = `Late call ${Date.now()}`;
    const { dayKey, startsAt, endsAt } = await page.evaluate(() => {
      const now = new Date();
      const wed = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) + 2);
      const pad = (n: number) => String(n).padStart(2, "0");
      const key = `${wed.getFullYear()}-${pad(wed.getMonth() + 1)}-${pad(wed.getDate())}`;
      return { dayKey: key, startsAt: new Date(`${key}T21:00`).toISOString(), endsAt: new Date(`${key}T23:30`).toISOString() };
    });
    const res = await page.request.post("/api/bookings", { data: { roomId: 4, title, bookedBy: "carol", startsAt, endsAt } });
    expect(res.status()).toBe(201);
    await page.reload();
    await expect(page.locator(`[data-day="${dayKey}"]`)).toContainText(title);
  });
});

test.describe("bug 3", () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test("on a narrow screen the Book button is inside the screen", async ({ page }) => {
    knownBug(3);
    await page.goto("/rooms/1");
    const box = await page.getByRole("button", { name: "Book", exact: true }).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  });
});

test("bug 4: an end time before the start time gets a correct message", async ({ page }) => {
  knownBug(4);
  await page.goto("/rooms/2");
  await page.getByLabel("Title").fill("Backwards");
  await page.getByLabel("Start").fill("11:00");
  await page.getByLabel("End").fill("10:00");
  await page.getByRole("button", { name: "Book", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("End time must be after start time.");
});
