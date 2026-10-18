import type { NewIssue } from "./github.ts";

/** Shape of feedback_outbox.payload (contracts/feedback-report.schema.json without the screenshot). */
export interface Payload {
  comment: string;
  createdAt: string;
  /** Ignored for the issue body: a raw user identifier (email) must never reach a possibly public repo. */
  user?: string;
  /** Opaque reporter id computed by the app, e.g. HMAC-SHA256(userId, server secret) cut to 12 hex chars. */
  reporterId?: string;
  target?: { selector: string; tagName: string; text?: string };
  context: {
    url: string;
    viewport?: { width: number; height: number };
    userAgent?: string;
    consoleErrors?: string[];
    failedRequests?: { method: string; url: string; status: number }[];
  };
}

/**
 * Report text is untrusted. In the issue it must not render HTML, ping people, or contain a
 * mention that starts a bot — so `<`, `>`, `&` are escaped and `@` gets a zero-width space.
 */
export function neutralise(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/@/g, "@​");
}

const quote = (text: string) => neutralise(text).split("\n").map((l) => `> ${l}`).join("\n");

/** GitHub rejects issue bodies over 65536 characters. */
export const MAX_BODY = 65_000;
const TRUNCATED = "\n> _(truncated)_";
const SLOT = "\u0000QUOTE\u0000";
// Inside a code span Markdown shows HTML literally, so only backticks, newlines and mentions are handled.
const code = (text: string) => "`" + text.replace(/`/g, "'").replace(/\s*\n\s*/g, " ").replace(/@/g, "@\u200b") + "`";

const BASIC_FOOTER = "Add the label `approved` to let the coding agent work on this. Close it as *not planned* to reject it.";

const OPAQUE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The reporter as shown in an issue: the opaque id when it is well-formed, never an email or a name. */
export function reporterLabel(p: { reporterId?: unknown }): string {
  return typeof p.reporterId === "string" && OPAQUE_ID.test(p.reporterId) ? p.reporterId : "unknown";
}

/** At most 80 characters; cut at a word boundary unless there is no space in the last 20 characters. */
export function shortTitle(line: string): string {
  const chars = Array.from(line);
  if (chars.length <= 80) return line;
  const head = chars.slice(0, 79);
  const space = head.lastIndexOf(" ");
  const cut = space >= 79 - 20 ? head.slice(0, space) : head;
  return cut.join("").trimEnd() + "…";
}

export function renderIssue(id: number, p: Payload, publicBaseUrl?: string, footer = BASIC_FOOTER): NewIssue {
  const firstLine = p.comment.split("\n")[0].trim();
  // Titles are shown as plain text: only mentions need neutralising.
  const short = shortTitle(firstLine);
  const title = `[FB-${id}] ${short.replace(/@/g, "@\u200b")}`;
  const lines = [
    "### Report",
    SLOT,
    "",
    `- **Reporter:** ${reporterLabel(p) === "unknown" ? "unknown" : code(reporterLabel(p))}`,
    `- **Page:** ${code(p.context.url)}`,
  ];
  if (p.target) {
    lines.push(`- **Element:** ${code(p.target.selector)} (${code(p.target.tagName)})${p.target.text ? ` — text ${code(p.target.text)}` : ""}`);
  }
  if (p.context.viewport) lines.push(`- **Window:** ${p.context.viewport.width}×${p.context.viewport.height}`);
  if (p.context.userAgent) lines.push(`- **Browser:** ${code(p.context.userAgent)}`);
  lines.push(publicBaseUrl ? `- **Screenshot:** ${publicBaseUrl.replace(/\/$/, "")}/api/feedback/FB-${id}/screenshot` : "- **Screenshot:** stored in the app");
  if (p.context.consoleErrors?.length) {
    lines.push("", "### Console errors", ...p.context.consoleErrors.map((e) => `- ${code(e)}`));
  }
  if (p.context.failedRequests?.length) {
    lines.push("", "### Failed requests", ...p.context.failedRequests.map((r) => `- ${code(`${r.method} ${r.url} → ${r.status || "network error"}`)}`));
  }
  lines.push("", "---", footer);
  // Only the quoted report is cut; the structured sections and footer stay whole.
  const rest = lines.join("\n");
  const room = MAX_BODY - (rest.length - SLOT.length);
  let q = quote(p.comment);
  if (q.length > room) q = q.slice(0, room - TRUNCATED.length).replace(/[\ud800-\udbff]$/, "") + TRUNCATED;
  return { title, body: rest.replace(SLOT, () => q), labels: ["feedback"] };
}
