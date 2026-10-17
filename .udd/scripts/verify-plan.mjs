import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

export function planVerification(issues) {
  return issues
    .filter((i) => i.labels.includes("shipped") && !i.labels.includes("verified") && !i.labels.includes("needs-human"))
    .map((i) => i.number)
    .sort((a, b) => a - b);
}

export function verificationOutcome(passed) {
  return passed
    ? { add: ["verified"], remove: ["shipped"], close: true }
    : { add: ["needs-human"], remove: ["shipped"], close: false };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const cmd = process.argv[2] ?? "plan";
  console.log(JSON.stringify(cmd === "outcome" ? verificationOutcome(Boolean(input.passed)) : planVerification(input)));
}
