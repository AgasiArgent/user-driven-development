import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

function collect(report, tag) {
  const found = new Map(); // title -> status of last result
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      const tags = (spec.tags ?? []).map((t) => (t.startsWith("@") ? t : `@${t}`));
      if (!(spec.title ?? "").includes(tag) && !tags.includes(tag)) continue;
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
  const tests = [];
  for (const [title, status] of h) {
    if (status !== "passed") return { ok: false, reason: "fails-on-head", tests: [] };
    if (b.get(title) === "passed") return { ok: false, reason: "passes-on-base", tests: [] };
    tests.push(title);
  }
  return { ok: true, reason: "ok", tests };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [baseFile, headFile, tag] = process.argv.slice(2);
  const v = redFirstVerdict(JSON.parse(readFileSync(baseFile, "utf8")), JSON.parse(readFileSync(headFile, "utf8")), tag);
  console.log(v.reason);
  process.exit(v.ok ? 0 : 1);
}
