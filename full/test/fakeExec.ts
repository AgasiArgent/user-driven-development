import type { Exec, ExecResult } from "../src/exec.ts";

type Rule = { match: (cmd: string, args: string[]) => boolean; result: ExecResult | ((cmd: string, args: string[]) => ExecResult) };

/** Records every command and answers with the first matching rule (default: exit 0, no output). */
export function fakeExec(rules: Rule[] = []) {
  const calls: { cmd: string; args: string[]; cwd?: string; env?: Record<string, string> }[] = [];
  const exec: Exec = async (cmd, args, opts = {}) => {
    calls.push({ cmd, args, cwd: opts.cwd, env: opts.env });
    const rule = rules.find((r) => r.match(cmd, args));
    if (!rule) return { code: 0, stdout: "", stderr: "" };
    return typeof rule.result === "function" ? rule.result(cmd, args) : rule.result;
  };
  return { exec, calls, line: (i: number) => [calls[i].cmd, ...calls[i].args].join(" ") };
}

export const on = (prefix: string, result: Rule["result"]): Rule => ({ match: (c, a) => [c, ...a].join(" ").startsWith(prefix), result });
export const ok = (stdout = ""): ExecResult => ({ code: 0, stdout, stderr: "" });
export const fail = (stderr = "failed"): ExecResult => ({ code: 1, stdout: "", stderr });
