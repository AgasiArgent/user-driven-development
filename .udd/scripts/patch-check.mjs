// Static check of an agent's patch, WITHOUT running it: exactly one added line carries the tag,
// and at least one changed file is not a test file.
// Usage: node patch-check.mjs <patch-file> <tag> <comma-separated-globs> --files-z <file-list>
// <file-list>: NUL-separated `git -c core.quotePath=false diff --cached --name-only -z --no-renames` taken after applying the patch.
// Prints JSON {ok, reason, testFiles, appFiles}; exit 1 when not ok.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { findViolations } from "./no-fly-check.mjs";
import { tagRegex } from "./red-first.mjs";

/** @returns {{ok: boolean, reason: 'ambiguous-header'|'no-tagged-test'|'multiple-tagged-tests'|'no-app-change'|'ok', testFiles: string[], appFiles: string[]}} */
export function checkPatch({ files, diff, tag, testGlobs }) {
  const testFiles = findViolations(testGlobs, files);
  const appFiles = files.filter((f) => !testFiles.includes(f));
  const lines = String(diff).split("\n");
  // Fail closed: every `diff --git` header must be exactly `a/F b/F` for a file F of the list
  // (renames are off, so both sides are equal). Quoted or unaccounted headers cannot be trusted.
  const known = new Set(files.map((f) => `diff --git a/${f} b/${f}`));
  if (lines.some((l) => l.startsWith("diff --git ") && !known.has(l))) return { ok: false, reason: "ambiguous-header", testFiles, appFiles };
  const re = new RegExp(tagRegex(tag));
  const tagged = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++") && re.test(l.slice(1))).length;
  const reason = tagged === 0 ? "no-tagged-test" : tagged > 1 ? "multiple-tagged-tests" : appFiles.length === 0 ? "no-app-change" : "ok";
  return { ok: reason === "ok", reason, testFiles, appFiles };
}

const out = (r) => {
  console.log(JSON.stringify(r));
  process.exit(r.ok ? 0 : 1);
};
const fail = (reason) => out({ ok: false, reason, testFiles: [], appFiles: [] });

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const zi = args.indexOf("--files-z");
  if (zi < 0 || !args[zi + 1]) fail("files-list-required"); // diff headers are never parsed for names
  const [patch, tag, globs = ""] = args.filter((_, i) => i !== zi && i !== zi + 1);
  let diff, files;
  try {
    diff = readFileSync(patch, "utf8");
  } catch {
    fail("unreadable-patch"); // no evidence == failed closed
  }
  try {
    files = readFileSync(args[zi + 1], "utf8").split("\0").filter(Boolean);
  } catch {
    fail("files-list-unreadable");
  }
  out(checkPatch({ files, diff, tag: tag ?? "", testGlobs: globs.split(",").map((g) => g.trim()).filter(Boolean) }));
}
