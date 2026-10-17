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
// http(s):// , www. , scheme-relative //host (any case); stops at whitespace, <>, [] and trailing punctuation
const URL_RE = /(?:https?:\/\/|www\.|(?<![\w:/.-])\/\/(?=[A-Za-z0-9]))[^\s<>[\]]*[^\s<>[\].,;:!?)'"]/gi;
const IMAGE_MARK = "\u0000";
const REDACT_MARK = "\u0001";

/**
 * Backslash-escape every Markdown metacharacter (links, images, reference definitions, backticks) so agent text
 * can never open or close a code span or fence; the only code spans in the output are the ones we add around URLs.
 */
const escapeMarkdown = (t) => t.replace(/\\/g, "\\\\").replace(/!(?=\[)/g, "\\!").replace(/[[\]()`]/g, "\\$&");

/**
 * Agent output is untrusted: no HTML, no bot-waking mentions (also inside code fences),
 * nothing auto-fetched (images), nothing one-click (links), no secrets.
 */
export function sanitizeAgentText(text) {
  let s = String(text)
    .replace(/[\u0000\u0001]/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, IMAGE_MARK)
    .replace(/(?:<|&lt;)img\b[\s\S]*?(?:>|&gt;)/gi, IMAGE_MARK);
  for (const re of TOKENS) s = s.replace(re, REDACT_MARK);
  s = s.replace(KEYED, `$1${REDACT_MARK}`);
  let out = "";
  let last = 0;
  for (const m of s.matchAll(URL_RE)) {
    out += escapeMarkdown(s.slice(last, m.index)) + `\`${m[0].replaceAll("`", "")}\``;
    last = m.index + m[0].length;
  }
  out += escapeMarkdown(s.slice(last));
  return out
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/@/g, "@\u200b")
    .replaceAll(IMAGE_MARK, "[image removed]")
    .replaceAll(REDACT_MARK, "[redacted]");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.stdout.write(sanitizeAgentText(readFileSync(0, "utf8")));
}
