import { execFile } from "node:child_process";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  /**
   * For code the agent wrote (install, tests, scenarios): start from an almost empty environment,
   * so the server's DATABASE_URL, API keys and tokens never reach it. Only `env` is added.
   */
  isolated?: boolean;
  timeoutMs?: number;
}

/** Runs a command without a shell; never throws, returns the exit code. Injected so tests can fake it. */
export type Exec = (cmd: string, args: string[], opts?: ExecOptions) => Promise<ExecResult>;

const BASE_ENV = ["PATH", "HOME", "LANG", "TMPDIR", "PLAYWRIGHT_BROWSERS_PATH"];

function environment(opts: ExecOptions): NodeJS.ProcessEnv {
  if (!opts.isolated) return { ...process.env, ...opts.env };
  const base = Object.fromEntries(BASE_ENV.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
  return { ...base, CI: "1", ...opts.env };
}

export const realExec: Exec = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd: opts.cwd, env: environment(opts), timeout: opts.timeoutMs ?? 30 * 60_000, maxBuffer: 20 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
