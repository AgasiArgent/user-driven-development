import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const normTag = (tag) => (tag.startsWith("@") ? tag : `@${tag}`);

/** Playwright --grep pattern for a tag; `@udd-1` must not match `@udd-12`. */
export function tagRegex(tag) {
  return `${normTag(tag).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![0-9])`;
}

function collect(report, tag) {
  const titleRe = new RegExp(tagRegex(tag));
  const want = normTag(tag);
  const found = new Map(); // title -> status of last result
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      const tags = (spec.tags ?? []).map(normTag);
      if (!titleRe.test(spec.title ?? "") && !tags.includes(want)) continue;
      const tests = spec.tests ?? [];
      let status = "passed";
      for (const t of tests) {
        const r = t.results ?? [];
        const last = r.length ? r[r.length - 1].status : "skipped";
        if (last !== "passed") status = last;
      }
      if (!tests.length) status = "skipped";
      found.set(spec.title, status);
    }
    for (const s of suite.suites ?? []) walk(s);
  };
  for (const s of report?.suites ?? []) walk(s);
  return found;
}

const RED = new Set(["failed", "timedOut", "interrupted"]);
const verdict = (ok, reason, tests = []) => ({ ok, reason, tests });

/** Production run: every tagged test must exist and be red (failed/timedOut/interrupted). */
export function baseVerdict(base, tag) {
  const b = collect(base, tag);
  if (b.size === 0) return verdict(false, "no-tagged-test");
  const statuses = [...b.values()];
  if (statuses.includes("passed")) return verdict(false, "passes-on-base");
  // skipped / unknown proves nothing
  if (statuses.some((st) => !RED.has(st))) return verdict(false, "base-missing");
  return verdict(true, "ok", [...b.keys()]);
}

/** Preview run: every tagged test must exist and be green. */
export function headVerdict(head, tag) {
  const h = collect(head, tag);
  if (h.size === 0) return verdict(false, "no-tagged-test");
  if ([...h.values()].some((st) => st !== "passed")) return verdict(false, "fails-on-head");
  return verdict(true, "ok", [...h.keys()]);
}

/** Both runs of the same tests: red on base, green on head. */
export function redFirstVerdict(base, head, tag) {
  const h = collect(head, tag);
  if (h.size === 0) return verdict(false, "no-tagged-test");
  const b = collect(base, tag);
  // Only an explicit failure on base is red; absent / skipped / empty base proves nothing.
  if ([...h.keys()].some((title) => !RED.has(b.get(title)) && b.get(title) !== "passed")) return verdict(false, "base-missing");
  if ([...h.keys()].some((title) => b.get(title) === "passed")) return verdict(false, "passes-on-base");
  const hv = headVerdict(head, tag);
  return hv.ok ? hv : verdict(false, hv.reason);
}

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null; // unreadable report == no evidence
  }
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [a, b, c] = process.argv.slice(2);
  if (a === "regex") {
    console.log(tagRegex(b ?? ""));
    process.exit(0);
  }
  const v =
    a === "base" ? baseVerdict(readJson(b), c) : a === "head" ? headVerdict(readJson(b), c) : redFirstVerdict(readJson(a), readJson(b), c);
  console.log(v.reason);
  process.exit(v.ok ? 0 : 1);
}
