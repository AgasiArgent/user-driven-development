import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RepoFiles } from "./research.ts";

/** Tracked files of a git checkout. */
export function gitRepo(root: string): RepoFiles {
  return {
    list: async () => execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean),
    read: async (path) => readFile(join(root, path), "utf8").catch(() => ""),
  };
}
