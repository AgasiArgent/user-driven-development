import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { findViolations } from "../../scripts/no-fly-check.mjs";
import type { RepoFiles } from "./research.ts";

/** Tracked files of a git checkout, without paths matching `ignore` globs (.udd/research-ignore.txt). */
export function gitRepo(root: string, ignore: string[] = []): RepoFiles {
  return {
    list: async () => {
      const files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
      const skip = new Set(findViolations(ignore, files));
      return files.filter((f) => !skip.has(f));
    },
    read: async (path) => readFile(join(root, path), "utf8").catch(() => ""),
  };
}
