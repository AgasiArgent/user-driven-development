import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

export function shouldRun(routine, openItems) {
  return !openItems.some((i) => i.labels.includes(`routine:${routine}`));
}

export function filterKnown(findings, known) {
  const keys = new Set(known.map((k) => k.key));
  return findings.filter((f) => !keys.has(f.key));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const cmd = process.argv[2] ?? "should-run";
  console.log(JSON.stringify(cmd === "filter" ? filterKnown(input.findings, input.known) : shouldRun(input.routine, input.openItems)));
}
