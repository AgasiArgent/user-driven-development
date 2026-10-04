import type pg from "pg";
import type { Exec } from "./exec.ts";
import { runScenario, scenarioFrom } from "./scenario.ts";
import { runsWithStatus, updateRun, type Run } from "./store.ts";
import type { Tracker } from "./tracker/types.ts";

export interface VerifyDeps {
  db: pg.Pool;
  tracker: Tracker;
  exec: Exec;
  repoDir: string;
  prodUrl: string;
  fetchFn?: typeof fetch;
}

type Outcome = "verified" | "waiting" | "failed" | "closed";

/**
 * Principle 7: "done" means verified in production. For every opened PR: merged → its merge commit
 * is in what production runs → CI on main is green → the scenario passes in production.
 */
export async function verifyOnce(deps: VerifyDeps): Promise<Record<Outcome, number>> {
  const result: Record<Outcome, number> = { verified: 0, waiting: 0, failed: 0, closed: 0 };
  for (const run of await runsWithStatus(deps.db, "pr_opened")) result[await verifyRun(deps, run)]++;
  return result;
}

async function verifyRun(deps: VerifyDeps, run: Run): Promise<Outcome> {
  const pr = await deps.exec("gh", ["pr", "view", run.pr_url ?? "", "--json", "state,mergeCommit"], { cwd: deps.repoDir });
  if (pr.code !== 0) return "waiting";
  const { state, mergeCommit } = JSON.parse(pr.stdout) as { state: string; mergeCommit: { oid: string } | null };
  if (state === "OPEN") return "waiting";
  if (state !== "MERGED" || !mergeCommit) {
    await deps.tracker.comment(run.issue_id, `The PR was closed without merging: ${run.pr_url}. Back to Triage.`);
    await deps.tracker.setState(run.issue_id, "Triage");
    await deps.db.query("DELETE FROM dispatch_runs WHERE issue_id = $1", [run.issue_id]);
    return "closed";
  }

  const prodSha = await productionSha(deps);
  if (!prodSha) return "waiting";
  await deps.exec("git", ["fetch", "-q", "origin"], { cwd: deps.repoDir });
  const deployed = await deps.exec("git", ["merge-base", "--is-ancestor", mergeCommit.oid, prodSha], { cwd: deps.repoDir });
  if (deployed.code !== 0) return "waiting";

  const ci = await deps.exec("gh", ["run", "list", "--commit", prodSha, "--branch", "main", "--json", "status,conclusion"], { cwd: deps.repoDir });
  const runs = ci.code === 0 ? (JSON.parse(ci.stdout || "[]") as { status: string; conclusion: string }[]) : [];
  if (!runs.length || runs.some((r) => r.status !== "completed")) return "waiting";
  if (runs.some((r) => r.conclusion !== "success")) {
    return failed(deps, run, `CI on main is red for the deployed commit ${prodSha.slice(0, 7)}. A human needs to look before this goes to review.`);
  }

  const issue = await deps.tracker.get(run.issue_id);
  const scenario = scenarioFrom(issue.body);
  const check = scenario ? await runScenario(deps.exec, { name: scenario, baseUrl: deps.prodUrl, cwd: `${deps.repoDir}/demo` }) : "missing";
  if (check !== "passes") {
    return failed(deps, run, `The fix is deployed, but the scenario "${scenario}" still fails in production. A human needs to look.`);
  }
  await deps.tracker.setState(run.issue_id, "In Review");
  await deps.tracker.comment(run.issue_id, `Deployed and verified in production: the scenario "${scenario}" passes. Please check it and mark the issue Done.`);
  await updateRun(deps.db, run.issue_id, { status: "verified" });
  return "verified";
}

async function failed(deps: VerifyDeps, run: Run, message: string): Promise<"failed"> {
  await deps.tracker.comment(run.issue_id, message);
  await updateRun(deps.db, run.issue_id, { status: "verify_failed", last_error: message.slice(0, 500) });
  return "failed";
}

async function productionSha(deps: VerifyDeps): Promise<string | null> {
  try {
    const res = await (deps.fetchFn ?? fetch)(`${deps.prodUrl.replace(/\/$/, "")}/api/version`);
    if (!res.ok) return null;
    const { sha } = (await res.json()) as { sha?: string };
    return sha && /^[0-9a-f]{7,40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}
