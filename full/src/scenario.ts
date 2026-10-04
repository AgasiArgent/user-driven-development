import type { Exec } from "./exec.ts";

/**
 * Principle 5. The scenario is a Playwright test that describes the CORRECT behavior; the issue names
 * it in a line "Scenario: <test title or part of it>". A human adds that line when approving.
 */
export function scenarioFrom(body: string): string | null {
  const m = /^Scenario:\s*(.+?)\s*$/m.exec(body);
  return m ? m[1] : null;
}

export type ScenarioResult = "passes" | "fails" | "missing";

/** Runs the scenario against `baseUrl` (production, or a preview). EXPECT_FIXED=1 turns off test.fail markers. */
export async function runScenario(exec: Exec, opts: { name: string; baseUrl: string; cwd: string }): Promise<ScenarioResult> {
  const r = await exec("npx", ["playwright", "test", "-g", opts.name, "--reporter=line"], {
    cwd: opts.cwd,
    env: { UDD_BASE_URL: opts.baseUrl, EXPECT_FIXED: "1" },
  });
  if (/No tests found/i.test(r.stdout + r.stderr)) return "missing";
  return r.code === 0 ? "passes" : "fails";
}
