// Static check of an agent's patch, WITHOUT running it: exactly one added line carries the tag,
// and at least one changed file is not a test file.
// Usage: node patch-check.mjs <patch-file> <tag> <comma-separated-globs>
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { findViolations } from "./no-fly-check.mjs";
import { tagRegex } from "./red-first.mjs";

/** @returns {{ok: boolean, reason: 'no-tagged-test'|'multiple-tagged-tests'|'no-app-change'|'ok', testFiles: string[], appFiles: string[]}} */
export function checkPatch({ files, diff, tag, testGlobs }) {
  const testFiles = findViolations(testGlobs, files);
  const appFiles = files.filter((f) => !testFiles.includes(f));
  const re = new RegExp(tagRegex(tag));
  const tagged = String(diff)
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++") && re.test(l.slice(1))).length;
  const reason = tagged === 0 ? "no-tagged-test" : tagged > 1 ? "multiple-tagged-tests" : appFiles.length === 0 ? "no-app-change" : "ok";
  return { ok: reason === "ok", reason, testFiles, appFiles };
}

/** Paths from `diff --git a/X b/Y` headers (the new path Y; for X === Y the split is exact even with spaces). */
export function filesFromDiff(diff) {
  const files = [];
  for (const line of String(diff).split("\n")) {
    if (!line.startsWith("diff --git a/")) continue;
    const rest = line.slice("diff --git a/".length);
    const mid = rest.length >> 1;
    files.push(rest.slice(0, mid) === rest.slice(mid + 3) && rest.slice(mid, mid + 3) === " b/" ? rest.slice(0, mid) : rest.slice(rest.lastIndexOf(" b/") + 3));
  }
  return [...new Set(files)];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [patch, tag, globs = ""] = process.argv.slice(2);
  let diff;
  try {
    diff = readFileSync(patch, "utf8");
  } catch {
    console.log("unreadable-patch"); // no evidence == failed closed
    process.exit(1);
  }
  const r = checkPatch({ files: filesFromDiff(diff), diff, tag: tag ?? "", testGlobs: globs.split(",").filter(Boolean) });
  console.log(r.reason);
  process.exit(r.ok ? 0 : 1);
}
