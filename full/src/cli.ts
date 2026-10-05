// Usage: npm run loop -w full -- <intake|dispatch|verify|liveness> [--watch <seconds>] [--dry-run]
// See docs/full-level.md for the environment variables.
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pg from "pg";
import { createCodexCloudAgent } from "./agent/codexCloud.ts";
import { dispatchOnce } from "./dispatcher.ts";
import { realExec } from "./exec.ts";
import { intakeOnce } from "./intake.ts";
import { livenessAlerts } from "./liveness.ts";
import { createAnthropicModel } from "./model.ts";
import { checkNoFly, loadRules } from "./noFly.ts";
import { gitRepo } from "./repo.ts";
import { research, type Payload } from "./research.ts";
import { createLinearTracker } from "./tracker/linear.ts";
import { verifyOnce } from "./verify.ts";

const [command, ...rest] = process.argv.slice(2);
const watch = rest.includes("--watch") ? Number(rest[rest.indexOf("--watch") + 1]) : 0;
const dryRun = rest.includes("--dry-run");

const env = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") throw new Error(`Set ${name} (see docs/full-level.md).`);
  return value;
};

const repoDir = resolve(process.env.REPO_DIR ?? join(import.meta.dirname, "..", ".."));
const db = new pg.Pool({ connectionString: env("DATABASE_URL", "postgres://udd:udd@localhost:55432/udd"), max: 3 });
const worktreeRoot = process.env.WORKTREE_ROOT ?? join(tmpdir(), "udd-worktrees");

/** Code the agent wrote runs with only this environment: a throwaway database, never the app's. */
function checksEnv(): Record<string, string> {
  const url = env("UDD_CHECKS_DATABASE_URL");
  if (url === process.env.DATABASE_URL) throw new Error("UDD_CHECKS_DATABASE_URL must not be the application database: the tests truncate tables.");
  return { DATABASE_URL: url };
}

const tracker = () => createLinearTracker({ apiKey: env("LINEAR_API_KEY"), teamId: env("LINEAR_TEAM_ID") });
const model = () => (process.env.ANTHROPIC_API_KEY ? createAnthropicModel({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.UDD_MODEL ?? "claude-sonnet-5-5" }) : undefined);

async function previewIntake(): Promise<void> {
  const { rows } = await db.query<{ id: string; payload: Payload }>("SELECT id, payload FROM feedback_outbox WHERE status = 'received' ORDER BY id LIMIT 20");
  const rules = loadRules(repoDir);
  for (const r of rows) {
    const found = await research(r.payload, gitRepo(repoDir, loadRules(repoDir).researchIgnore));
    const noFly = checkNoFly(r.payload, found.codeRefs, rules);
    console.log(`FB-${r.id}: ${found.summary}\n  code: ${found.codeRefs.map((c) => `${c.file}:${c.line}`).join(", ") || "none"}\n  no-fly: ${noFly.blocked ? noFly.reasons.join("; ") : "no"}\n  fingerprint: ${found.fingerprint}`);
  }
  if (!rows.length) console.log("Nothing queued.");
}

async function once(): Promise<number> {
  switch (command) {
    case "intake":
      if (dryRun) return (await previewIntake(), 0);
      console.log(await intakeOnce(db, tracker(), gitRepo(repoDir, loadRules(repoDir).researchIgnore), { rules: loadRules(repoDir), model: model(), publicBaseUrl: process.env.PUBLIC_BASE_URL }));
      return 0;
    case "dispatch":
      console.log(
        await dispatchOnce({
          db,
          tracker: tracker(),
          agent: createCodexCloudAgent({ exec: realExec, envId: env("CODEX_ENV_ID") }),
          exec: realExec,
          repoDir,
          worktreeRoot,
          prodUrl: env("PROD_URL"),
          noFlyPaths: loadRules(repoDir).paths,
          checksEnv: checksEnv(),
        }),
      );
      return 0;
    case "verify":
      console.log(await verifyOnce({ db, tracker: tracker(), exec: realExec, repoDir, worktreeRoot, prodUrl: env("PROD_URL"), checksEnv: checksEnv() }));
      return 0;
    case "liveness": {
      const alerts = await livenessAlerts(db);
      console.log(alerts.length ? alerts.join("\n") : "The loop is moving.");
      return alerts.length ? 1 : 0;
    }
    default:
      console.error("Usage: npm run loop -w full -- <intake|dispatch|verify|liveness> [--watch <seconds>] [--dry-run]");
      return 2;
  }
}

let code = 0;
try {
  if (watch > 0) {
    for (;;) {
      await once().catch((err) => console.error(`${command} failed: ${err instanceof Error ? err.message : err}`));
      await new Promise((r) => setTimeout(r, watch * 1000));
    }
  } else code = await once();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  code = 1;
} finally {
  await db.end();
}
process.exit(code);
