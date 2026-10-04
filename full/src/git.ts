import type { Exec } from "./exec.ts";

async function run(exec: Exec, args: string[], cwd: string): Promise<string> {
  const r = await exec("git", args, { cwd });
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.slice(0, 300)}`);
  return r.stdout;
}

/** A fresh checkout of origin/main on `branch`, in its own folder. */
export async function addWorktree(exec: Exec, repoDir: string, dir: string, branch: string): Promise<void> {
  await run(exec, ["fetch", "-q", "origin"], repoDir);
  await run(exec, ["worktree", "add", "-f", "-B", branch, dir, "origin/main"], repoDir);
}

export async function removeWorktree(exec: Exec, repoDir: string, dir: string): Promise<void> {
  await exec("git", ["worktree", "remove", "--force", dir], { cwd: repoDir });
}

export async function changedFiles(exec: Exec, dir: string): Promise<string[]> {
  if (!(await run(exec, ["status", "--porcelain"], dir)).trim()) return [];
  await run(exec, ["add", "-A"], dir);
  return (await run(exec, ["diff", "--name-only", "--cached"], dir)).split("\n").map((l) => l.trim()).filter(Boolean);
}

export async function resetWorktree(exec: Exec, dir: string): Promise<void> {
  await run(exec, ["reset", "-q", "--hard"], dir);
  await run(exec, ["clean", "-qfd"], dir);
}

export async function commitAndPush(exec: Exec, dir: string, branch: string, message: string): Promise<void> {
  await run(exec, ["add", "-A"], dir);
  await run(exec, ["-c", "user.name=udd-bot", "-c", "user.email=udd-bot@users.noreply.github.com", "commit", "-q", "-m", message], dir);
  await run(exec, ["push", "-q", "-u", "origin", branch], dir);
}
