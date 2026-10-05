import type { Exec, ExecResult } from "../src/exec.ts";

type Rule = { match: (cmd: string, args: string[]) => boolean; result: ExecResult | ((cmd: string, args: string[]) => ExecResult) };

/** Records every command and answers with the first matching rule (default: exit 0, no output). */
export function fakeExec(rules: Rule[] = []) {
  const calls: { cmd: string; args: string[]; cwd?: string; env?: Record<string, string>; isolated?: boolean }[] = [];
  const exec: Exec = async (cmd, args, opts = {}) => {
    calls.push({ cmd, args, cwd: opts.cwd, env: opts.env, isolated: opts.isolated });
    const rule = rules.find((r) => r.match(cmd, args));
    if (!rule) return { code: 0, stdout: "", stderr: "" };
    return typeof rule.result === "function" ? rule.result(cmd, args) : rule.result;
  };
  return { exec, calls, line: (i: number) => [calls[i].cmd, ...calls[i].args].join(" ") };
}

export const on = (prefix: string, result: Rule["result"]): Rule => ({ match: (c, a) => [c, ...a].join(" ").startsWith(prefix), result });
export const ok = (stdout = ""): ExecResult => ({ code: 0, stdout, stderr: "" });
export const fail = (stderr = "failed"): ExecResult => ({ code: 1, stdout: "", stderr });

/** Output of `playwright test --reporter=json`: exit 1 when a test failed unexpectedly. */
export function pw(stats: { expected?: number; unexpected?: number }, errors: string[] = []): ExecResult {
  const json = JSON.stringify({ errors: errors.map((message) => ({ message })), stats: { expected: 0, unexpected: 0, skipped: 0, flaky: 0, ...stats } });
  return { code: (stats.unexpected ?? 0) > 0 || errors.length ? 1 : 0, stdout: json, stderr: "" };
}
export const pwFails = () => pw({ unexpected: 1 });
export const pwPasses = () => pw({ expected: 1 });
export const pwMissing = () => pw({}, ["Error: No tests found"]);
export const pwBroken = () => pw({}, ["Error: browserType.launch: Executable doesn't exist"]);
