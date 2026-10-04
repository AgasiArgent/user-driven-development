import { createHash } from "node:crypto";
import type { Payload } from "../../delivery/src/issueBody.ts";

export type { Payload };

export interface CodeRef {
  file: string;
  line: number;
  snippet: string;
}

export interface Analysis {
  kind: "bug" | "feature" | "question" | "unknown";
  summary: string;
  uncertainty: string;
}

export interface Research extends Analysis {
  codeRefs: CodeRef[];
  fingerprint: string;
}

/** Optional language model step. Any provider fits behind this interface. */
export interface Model {
  analyse(input: { comment: string; url: string; target?: Payload["target"]; codeRefs: CodeRef[] }): Promise<Analysis>;
}

/** Read access to the application's source files. */
export interface RepoFiles {
  list(): Promise<string[]>;
  read(path: string): Promise<string>;
}

const SOURCE = /\.(tsx?|jsx?|mjs|css|html|vue|svelte|py|rb|go)$/;
const SKIP = /(^|\/)(node_modules|dist|\.next|build|coverage|test-results)\//;
const MAX_REFS = 5;

/** Words worth searching for: the element's text, class and id names from its selector, URL path segments. */
function searchTerms(p: Payload): string[] {
  const terms = new Set<string>();
  const text = p.target?.text?.trim();
  if (text && text.length >= 3) terms.add(text.slice(0, 60));
  for (const m of p.target?.selector.matchAll(/[.#]([A-Za-z][\w-]{2,})/g) ?? []) terms.add(m[1]);
  try {
    for (const seg of new URL(p.context.url).pathname.split("/")) if (seg.length >= 3 && !/^\d+$/.test(seg)) terms.add(seg);
  } catch {
    /* not a URL: no path terms */
  }
  return [...terms];
}

/** Source files that mention the most search terms, with the first matching line. */
export async function findCodeRefs(p: Payload, repo: RepoFiles): Promise<CodeRef[]> {
  const terms = searchTerms(p);
  if (!terms.length) return [];
  const scored: (CodeRef & { score: number })[] = [];
  for (const file of await repo.list()) {
    if (!SOURCE.test(file) || SKIP.test(file)) continue;
    const content = await repo.read(file);
    const hits = terms.filter((t) => content.includes(t) || file.includes(t));
    if (!hits.length) continue;
    const lines = content.split("\n");
    // The line that matches the most terms points at the element better than the first mention.
    let index = -1;
    let best = 0;
    lines.forEach((l, i) => {
      const n = hits.filter((t) => l.includes(t)).length;
      if (n > best) [best, index] = [n, i];
    });
    scored.push({ file, line: index + 1 || 1, snippet: (lines[index] ?? "").trim().slice(0, 160), score: hits.length });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .slice(0, MAX_REFS)
    .map(({ score: _score, ...ref }) => ref);
}

/** Same page pattern + same element + same first words ⇒ same fingerprint ⇒ treated as a duplicate. */
export function fingerprint(p: Payload): string {
  let path = p.context.url;
  try {
    path = new URL(p.context.url).pathname;
  } catch {
    /* keep as is */
  }
  const words = p.comment.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean).slice(0, 6).join(" ");
  const key = [path.replace(/\/\d+(?=\/|$)/g, "/:id"), p.target?.selector ?? "", words].join("|");
  return createHash("sha1").update(key).digest("hex").slice(0, 16);
}

export async function research(p: Payload, repo: RepoFiles, model?: Model): Promise<Research> {
  const codeRefs = await findCodeRefs(p, repo);
  const base = { codeRefs, fingerprint: fingerprint(p) };
  if (!model) {
    return { ...base, kind: "unknown", summary: p.comment.split("\n")[0].slice(0, 200), uncertainty: "No model configured: classification and summary were not attempted." };
  }
  try {
    return { ...base, ...(await model.analyse({ comment: p.comment, url: p.context.url, target: p.target, codeRefs })) };
  } catch (err) {
    return { ...base, kind: "unknown", summary: p.comment.split("\n")[0].slice(0, 200), uncertainty: `Model call failed (${err instanceof Error ? err.message : err}); no classification.` };
  }
}
