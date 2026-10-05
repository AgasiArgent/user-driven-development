# Contributing

Thanks for looking. This project is a generalized version of a loop that runs in one real system, so the most useful contributions are reports from other systems.

**Most welcome**

- *"I tried it in my app and X broke."* Open an issue with what you ran, what you expected and what happened.
- Adapters: another tracker (Jira, GitHub Projects, Plane), another coding agent, another way to run the red-first scenario.
- Fixes to the docs where something is unclear or wrong.

**Before a pull request**

1. `docker compose up -d db`, then `npm ci`.
2. `npm run test:unit && npm run test:scripts` must pass; for the demo, `npm run build -w demo && npm run e2e -w demo`.
3. Keep files under about 300 lines and add a test that fails without your change.

The four bugs in the demo app are there on purpose (see [docs/demo-bugs.md](docs/demo-bugs.md)) — please don't fix them in this repository; they are what the loop is tested on.
