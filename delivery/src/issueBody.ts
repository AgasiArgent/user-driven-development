import type { NewIssue } from "./github.ts";

/** Shape of feedback_outbox.payload (contracts/feedback-report.schema.json without the screenshot). */
export interface Payload {
  comment: string;
  createdAt: string;
  user?: string;
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
// Inside a code span Markdown shows HTML literally, so only backticks, newlines and mentions are handled.
const code = (text: string) => "`" + text.replace(/`/g, "'").replace(/\s*\n\s*/g, " ").replace(/@/g, "@\u200b") + "`";

export function renderIssue(id: number, p: Payload, publicBaseUrl?: string): NewIssue {
  const firstLine = p.comment.split("\n")[0].trim();
  // Titles are shown as plain text: only mentions need neutralising.
  const short = Array.from(firstLine).length > 80 ? Array.from(firstLine).slice(0, 79).join("") + "…" : firstLine;
  const title = `[FB-${id}] ${short.replace(/@/g, "@\u200b")}`;
  const lines = [
    "### Report",
    quote(p.comment),
    "",
    `- **Reporter:** ${p.user ? code(p.user) : "unknown"}`,
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
  lines.push("", "---", "Add the label `approved` to let the coding agent work on this. Close it as *not planned* to reject it.");
  return { title, body: lines.join("\n"), labels: ["feedback"] };
}
