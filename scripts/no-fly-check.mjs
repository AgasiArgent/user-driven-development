#!/usr/bin/env node
// Fails (exit 1) if any changed file matches a pattern in .udd/no-fly.txt.
// Usage: git diff --name-only origin/main...HEAD | node scripts/no-fly-check.mjs [patterns-file]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Non-empty, non-comment lines of the patterns file. */
export function parsePatterns(text) {
  return text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
}

// Glob to RegExp: a leading "**" folder part matches any folders or none, "**" matches anything,
// "*" and "?" stay within one path segment.
function toRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (glob.startsWith("**/", i)) {
      re += "(?:.*/)?";
      i += 2;
    } else if (glob.startsWith("**", i)) {
      re += ".*";
      i += 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export function findViolations(patterns, files) {
  const res = patterns.map(toRegExp);
  return files.filter((f) => res.some((r) => r.test(f)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const patterns = parsePatterns(readFileSync(process.argv[2] ?? ".udd/no-fly.txt", "utf8"));
  const files = readFileSync(0, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  const bad = findViolations(patterns, files);
  if (bad.length) {
    console.log("These files are in no-fly zones (.udd/no-fly.txt) and need a human:");
    for (const f of bad) console.log(`- ${f}`);
    process.exit(1);
  }
  console.log(`no-fly check: ${files.length} changed file(s), none in no-fly zones`);
}
