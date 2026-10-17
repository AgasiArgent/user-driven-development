import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

/** Agent output is untrusted: no HTML, no bot-waking mentions (also inside code fences). */
export function sanitizeAgentText(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/@/g, "@​");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.stdout.write(sanitizeAgentText(readFileSync(0, "utf8")));
}
