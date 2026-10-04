import { execFile } from "node:child_process";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a command without a shell; never throws, returns the exit code. Injected so tests can fake it. */
export type Exec = (cmd: string, args: string[], opts?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number }) => Promise<ExecResult>;

export const realExec: Exec = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd: opts.cwd, env: { ...process.env, ...opts.env }, timeout: opts.timeoutMs ?? 30 * 60_000, maxBuffer: 20 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
