import type { Exec } from "./exec.ts";

/**
 * Principle 5. The scenario is a Playwright test that describes the CORRECT behavior; the issue names
 * it in a line "Scenario: <test title or part of it>". A human adds that line when approving.
 */
export function scenarioFrom(body: string): string | null {
  const m = /^Scenario:\s*(.+?)\s*$/m.exec(body);
  return m ? m[1] : null;
}

/** "error" = nothing was actually tested (no browser, site down, unreadable output). It is never a red result. */
export type ScenarioResult = "passes" | "fails" | "missing" | "error";

interface Report {
  errors?: { message?: string }[];
  stats?: { expected?: number; unexpected?: number; flaky?: number };
}

/**
 * Runs the scenario against `baseUrl` (production) from the given checkout. EXPECT_FIXED=1 turns off
 * test.fail markers. Only a test that ran and failed counts as "fails".
 */
export async function runScenario(exec: Exec, opts: { name: string; baseUrl: string; cwd: string; env?: Record<string, string> }): Promise<ScenarioResult> {
  const r = await exec("npx", ["playwright", "test", "-g", opts.name, "--reporter=json"], {
    cwd: opts.cwd,
    isolated: true,
    env: { ...opts.env, UDD_BASE_URL: opts.baseUrl, EXPECT_FIXED: "1" },
  });
  let report: Report;
  try {
    report = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));
  } catch {
    return "error";
  }
  const { expected = 0, unexpected = 0, flaky = 0 } = report.stats ?? {};
  if (expected + unexpected + flaky === 0) {
    return report.errors?.some((e) => /No tests found/i.test(e.message ?? "")) ? "missing" : "error";
  }
  if (unexpected > 0) return "fails";
  return report.errors?.length ? "error" : "passes";
}
