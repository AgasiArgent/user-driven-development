import type { Exec } from "../exec.ts";
import type { CodingAgent } from "./types.ts";

export interface CodexCloudOptions {
  exec: Exec;
  /** Codex Cloud environment id for the repository. */
  envId: string;
}

/**
 * Codex Cloud through the `codex` CLI: `cloud exec` starts a task, `cloud status` reports on it,
 * `cloud apply` writes its diff into a local checkout. The CLI's output format can change between
 * versions; the parsing below is deliberately loose and fails loudly when it finds nothing.
 */
export function createCodexCloudAgent({ exec, envId }: CodexCloudOptions): CodingAgent {
  return {
    async start(prompt) {
      const r = await exec("codex", ["cloud", "exec", "--env", envId, "--branch", "main", prompt]);
      if (r.code !== 0) throw new Error(`codex cloud exec failed: ${r.stderr.slice(0, 300)}`);
      const id = /\b(task_[A-Za-z0-9_]+)\b/.exec(r.stdout)?.[1] ?? /\/tasks\/([A-Za-z0-9_-]+)/.exec(r.stdout)?.[1];
      if (!id) throw new Error(`could not read a task id from: ${r.stdout.slice(0, 200)}`);
      return { taskId: id };
    },
    async poll(taskId) {
      const r = await exec("codex", ["cloud", "status", taskId]);
      const out = r.stdout.toUpperCase();
      if (/\b(READY|COMPLETED|SUCCEEDED)\b/.test(out)) return "ready";
      if (r.code !== 0 || /\b(ERROR|FAILED|CANCELLED|CANCELED)\b/.test(out)) return "failed";
      return "pending";
    },
    async apply(taskId, dir) {
      const r = await exec("codex", ["cloud", "apply", taskId], { cwd: dir });
      if (r.code !== 0) throw new Error(`codex cloud apply failed: ${r.stderr.slice(0, 300)}`);
    },
  };
}
