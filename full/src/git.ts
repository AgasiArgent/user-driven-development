import type { Exec } from "./exec.ts";

async function run(exec: Exec, args: string[], cwd: string): Promise<string> {
  const r = await exec("git", args, { cwd });
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.slice(0, 300)}`);
  return r.stdout;
}

/**
 * A fresh checkout in its own folder: on `branch` from origin/main, or detached at `ref`.
 * A folder left over from a crashed run is removed first.
 */
export async function addWorktree(exec: Exec, repoDir: string, dir: string, target: { branch: string } | { ref: string }): Promise<void> {
  await removeWorktree(exec, repoDir, dir);
  await run(exec, ["fetch", "-q", "origin"], repoDir);
  const args = "branch" in target ? ["-B", target.branch, dir, "origin/main"] : ["--detach", dir, target.ref];
  await run(exec, ["worktree", "add", "-f", ...args], repoDir);
}

export async function removeWorktree(exec: Exec, repoDir: string, dir: string): Promise<void> {
  await exec("git", ["worktree", "remove", "--force", dir], { cwd: repoDir });
  await exec("git", ["worktree", "prune"], { cwd: repoDir });
}

/** Full commit id for a (possibly short) one, or null when it is not in the clone. */
export async function fullSha(exec: Exec, repoDir: string, sha: string): Promise<string | null> {
  const r = await exec("git", ["rev-parse", "--verify", "--quiet", `${sha}^{commit}`], { cwd: repoDir });
  return r.code === 0 ? r.stdout.trim() || sha : null;
}

/** Changed files, with rename detection off: a moved file shows its old path too. */
export async function changedFiles(exec: Exec, dir: string): Promise<string[]> {
  if (!(await run(exec, ["status", "--porcelain"], dir)).trim()) return [];
  await run(exec, ["add", "-A"], dir);
  return (await run(exec, ["diff", "--name-only", "--cached", "--no-renames"], dir)).split("\n").map((l) => l.trim()).filter(Boolean);
}

export async function resetWorktree(exec: Exec, dir: string): Promise<void> {
  await run(exec, ["reset", "-q", "--hard"], dir);
  await run(exec, ["clean", "-qfd"], dir);
}

/** The branch belongs to the dispatcher, so a re-run may replace it. */
export async function commitAndPush(exec: Exec, dir: string, branch: string, message: string): Promise<void> {
  await run(exec, ["add", "-A"], dir);
  await run(exec, ["-c", "user.name=udd-bot", "-c", "user.email=udd-bot@users.noreply.github.com", "commit", "-q", "-m", message], dir);
  await run(exec, ["push", "-q", "--force", "-u", "origin", branch], dir);
}
