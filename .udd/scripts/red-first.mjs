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

export function redFirstVerdict(base, head, tag) {
  const h = collect(head, tag);
  if (h.size === 0) return { ok: false, reason: "no-tagged-test", tests: [] };
  const b = collect(base, tag);
  const RED = new Set(["failed", "timedOut", "interrupted"]);
  // Only an explicit failure on base is red; absent / skipped / empty base proves nothing.
  if ([...h.keys()].some((title) => !RED.has(b.get(title)) && b.get(title) !== "passed")) {
    return { ok: false, reason: "base-missing", tests: [] };
  }
  if ([...h.keys()].some((title) => b.get(title) === "passed")) return { ok: false, reason: "passes-on-base", tests: [] };
  if ([...h.values()].some((status) => status !== "passed")) return { ok: false, reason: "fails-on-head", tests: [] };
  return { ok: true, reason: "ok", tests: [...h.keys()] };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [baseFile, headFile, tag] = process.argv.slice(2);
  const v = redFirstVerdict(JSON.parse(readFileSync(baseFile, "utf8")), JSON.parse(readFileSync(headFile, "utf8")), tag);
  console.log(v.reason);
  process.exit(v.ok ? 0 : 1);
}
