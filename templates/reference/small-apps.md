# Small apps: no database, no storage, one user

Read this when question 2 or question 4 gave one of these answers.

## No database

- Skip section 4a (the table, row level security and the two-user check) and the retry check. The row
  does not exist, so a failure of GitHub means a lost report: answer 502, not 201.
- The id in the `201` answer is the **issue number**, known only after GitHub answers. Do not build a
  title like `[FB-<id>]` before the issue exists; use `[feedback] <first words of the text>`, cut at a word boundary.
- "My feedback" reads the issues, not a table. Match a report to its issue by a **stored id**, never by parsing the
  body (an exact-line match on "Reporter" showed an empty page in one app). With no row to hold the id, put the
  opaque reporter id in the issue body, as a line the intake writes and the page reads back, and filter by it.
  Only the newest 100 `feedback` issues are scanned; say so to the owner.

## No storage for screenshots

Screenshots are not kept. The intake drops the field and the issue says `Screenshot: not stored`. Tell the
owner that the research agent works from the selector, the element text, console errors and failed requests.

## Screenshots with storage

Store them privately, behind login. The issue shows a link only if the app serves the file at an
authenticated route (the owner opens it signed in). Writing with the user's session instead of a
server-side service key means the issue says "stored in the app" with no link, and the research agent sees no
screenshot: choose the service key if the owner wants links, and say which design you took.

## One user: the test user is the only real user

The test account then holds real data, and the Preview deployment runs the agent's code. Do not enable the
loop until all three hold:
1. Preview must use separate credentials: its own session secret and its own login password, never the
   production values (`SETUP.md` section 8b).
2. The account named in `UDD_TEST_USER_*` exists on production and is a test-only login. If the app has one user
   only, add a second, empty, non-admin user (or a seeded one) for tests, and keep the owner's login out of GitHub secrets.
3. The owner decides between those options; ask, and do not enable the loop meanwhile.
