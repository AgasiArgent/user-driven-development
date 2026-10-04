import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findViolations, parsePatterns } from "../../scripts/no-fly-check.mjs";
import type { CodeRef, Payload } from "./research.ts";

export interface NoFlyRules {
  /** Globs from .udd/no-fly.txt. */
  paths: string[];
  /** From .udd/no-fly-keywords.txt: a report word starting with one of these is a no-fly area. */
  keywords: string[];
}

export function loadRules(repoRoot: string): NoFlyRules {
  const read = (f: string) => {
    try {
      return parsePatterns(readFileSync(join(repoRoot, ".udd", f), "utf8"));
    } catch {
      return [];
    }
  };
  return { paths: read("no-fly.txt"), keywords: read("no-fly-keywords.txt").map((k) => k.toLowerCase()) };
}

/** Principle 4: decided in code at research time, before any agent sees the issue. */
export function checkNoFly(p: Payload, codeRefs: CodeRef[], rules: NoFlyRules): { blocked: boolean; reasons: string[] } {
  const reasons = findViolations(rules.paths, codeRefs.map((r) => r.file)).map((f) => `code in no-fly path: ${f}`);
  const words = p.comment.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  for (const k of rules.keywords) if (words.some((w) => w.startsWith(k))) reasons.push(`report mentions "${k}"`);
  return { blocked: reasons.length > 0, reasons };
}
