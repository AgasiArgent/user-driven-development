import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const normTag = (tag) => (tag.startsWith("@") ? tag : `@${tag}`);

/** Playwright --grep pattern for a tag; `@udd-1` must not match `@udd-12`. */
export function tagRegex(tag) {
  return `${normTag(tag).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![0-9])`;
}

/** Every spec carrying the tag, one entry per spec (never merged by title): {key, title, status}. */
function collect(report, tag) {
  const titleRe = new RegExp(tagRegex(tag));
  const want = normTag(tag);
  const found = [];
  const walk = (suite, file) => {
    const f = suite.file ?? file;
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
      const key = spec.id ?? `${spec.file ?? f ?? ""}:${spec.line ?? ""}:${spec.title}`;
      found.push({ key, title: spec.title, status });
    }
    for (const s of suite.suites ?? []) walk(s, f);
  };
  for (const s of report?.suites ?? []) walk(s, s.title);
  return found;
}

const RED = new Set(["failed", "timedOut", "interrupted"]);
const verdict = (ok, reason, tests = []) => ({ ok, reason, tests });

/** Production run: exactly one tagged test must exist and be red (failed/timedOut/interrupted). */
export function baseVerdict(base, tag) {
  const b = collect(base, tag);
  if (b.length === 0) return verdict(false, "no-tagged-test");
  if (b.length > 1) return verdict(false, "multiple-tagged-tests");
  const [t] = b;
  if (t.status === "passed") return verdict(false, "passes-on-base");
  // skipped / unknown proves nothing
  if (!RED.has(t.status)) return verdict(false, "base-missing");
  return verdict(true, "ok", [t.title]);
}

/** Preview run: exactly one tagged test must exist and be green. */
export function headVerdict(head, tag) {
  const h = collect(head, tag);
  if (h.length === 0) return verdict(false, "no-tagged-test");
  if (h.length > 1) return verdict(false, "multiple-tagged-tests");
  if (h[0].status !== "passed") return verdict(false, "fails-on-head");
  return verdict(true, "ok", [h[0].title]);
}

/** Both runs of the same test: red on base, green on head. */
export function redFirstVerdict(base, head, tag) {
  const h = collect(head, tag);
  if (h.length === 0) return verdict(false, "no-tagged-test");
  const b = collect(base, tag);
  if (h.length > 1 || b.length > 1) return verdict(false, "multiple-tagged-tests");
  // Only an explicit failure on base is red; absent / skipped / empty base proves nothing.
  const bt = b.find((x) => x.key === h[0].key);
  if (!bt || (!RED.has(bt.status) && bt.status !== "passed")) return verdict(false, "base-missing");
  if (bt.status === "passed") return verdict(false, "passes-on-base");
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
