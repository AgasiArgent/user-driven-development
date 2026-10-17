#!/usr/bin/env node
// Fails (exit 1) if any changed file matches a pattern in .udd/no-fly.txt.
// Usage: git diff --name-only -z origin/main...HEAD | node scripts/no-fly-check.mjs -z [patterns-file]
//        (newline mode without -z is kept for backwards compatibility)
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
  return new RegExp(`^${re}$`, "s"); // "s": paths may contain newlines
}

export function findViolations(patterns, files) {
  const res = patterns.map(toRegExp);
  return files.filter((f) => res.some((r) => r.test(f)));
}

/** Splits stdin into paths. NUL mode (-z) is exact; newline mode cannot represent newlines in names. */
export function parseFileList(text, nul) {
  const files = text.split(nul ? "\0" : "\n").map((l) => (nul ? l : l.trim())).filter(Boolean);
  const quoted = files.find((f) => f.startsWith('"'));
  if (quoted) throw new Error(`git-quoted path ${quoted}: use "git diff --name-only -z" with the -z flag`);
  return files;
}

function main(argv) {
  const nul = argv.includes("-z");
  const listPath = argv.find((a) => a !== "-z") ?? ".udd/no-fly.txt";
  let patterns;
  try {
    patterns = parsePatterns(readFileSync(listPath, "utf8"));
  } catch (e) {
    throw new Error(`cannot read pattern list ${listPath}: ${e.message}`);
  }
  if (!patterns.length) throw new Error(`pattern list ${listPath} has no patterns`);
  const files = parseFileList(readFileSync(0, "utf8"), nul);
  const bad = findViolations(patterns, files);
  if (bad.length) {
    console.log(`These files are in no-fly zones (${listPath}) and need a human:`);
    for (const f of bad) console.log(`- ${f}`);
    process.exit(1);
  }
  console.log(`no-fly check: ${files.length} changed file(s), none in no-fly zones`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`no-fly check FAILED CLOSED: ${e.message}`);
    process.exit(2);
  }
}
