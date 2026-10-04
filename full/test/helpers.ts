import type { RepoFiles } from "../src/research.ts";

export function memoryRepo(files: Record<string, string>): RepoFiles {
  return {
    list: async () => Object.keys(files),
    read: async (path) => files[path] ?? "",
  };
}
