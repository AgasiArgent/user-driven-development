# Seeded bugs in the demo

The demo application (Roomly, meeting room booking) ships with four deliberate bugs, so the feedback loop has something real to fix. Each one is visible in the browser and each has a Playwright test in `demo/e2e/bugs.spec.ts` that describes the correct behavior and is marked `test.fail()` — it fails today. These are ready-made red-first scenarios for parts 2 and 3.

> An agent can read this file. For an honest run of the loop, delete it in your fork before you send feedback.

| # | What a user sees | Correct behavior |
|---|---|---|
| 1 | Two bookings of the same room at the same time are both saved. | The second booking is rejected with a message that the room is taken. |
| 2 | In a time zone behind UTC, a late booking (for example 21:00–23:30) appears under the next day. | Bookings appear under the day they start in the browser's time zone. |
| 3 | On a screen narrower than 400 px, the **Book** button is off the right edge and cannot be pressed. | The booking form fits the screen and the button can be pressed. |
| 4 | Booking with an end time before the start time shows "End time must be after end time". | The message says "End time must be after start time". |

Bugs stay in this repository on purpose. Fixes made by the loop land in your fork.
