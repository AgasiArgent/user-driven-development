import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const TOKENS = [
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /sk-ant-[A-Za-z0-9_-]{10,}/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /xox[abpr]-[A-Za-z0-9-]{10,}/g,
  /eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g,
];
const KEYED = /(?<![A-Za-z])((?:token|key|secret|password)s?[\s:="']+)[A-Za-z0-9+/_=-]{40,}/gi;
const URL_OR_CODE_SPAN = /(`[^`\n]*`)|https?:\/\/[^\s`<>]*[^\s`<>.,;:!?)\]'"]/g;

/**
 * Agent output is untrusted: no HTML, no bot-waking mentions (also inside code fences),
 * nothing auto-fetched (images), nothing one-click (links), no secrets.
 */
export function sanitizeAgentText(text) {
  let s = String(text)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "[image removed]")
    .replace(/(?:<|&lt;)img\b[\s\S]*?(?:>|&gt;)/gi, "[image removed]");
  for (const re of TOKENS) s = s.replace(re, "[redacted]");
  s = s.replace(KEYED, "$1[redacted]");
  s = s.replace(/\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g, "$1 (`$2`)");
  s = s.replace(URL_OR_CODE_SPAN, (m, span) => (span ? m : `\`${m}\``));
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/@/g, "@​");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.stdout.write(sanitizeAgentText(readFileSync(0, "utf8")));
}
