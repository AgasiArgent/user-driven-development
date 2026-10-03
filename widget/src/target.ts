import { finder } from "@medv/finder";
import type { Target } from "./types";

const MAX_TEXT = 200;

/** Describes the element the user pinned, in a form an agent can use to find it in code and in the page. */
export function describeTarget(el: Element): Target {
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  const r = el.getBoundingClientRect();
  return {
    selector: finder(el, { root: el.ownerDocument.body }),
    tagName: el.tagName.toLowerCase(),
    ...(text ? { text } : {}),
    rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
  };
}
