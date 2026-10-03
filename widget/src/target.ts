import { finder } from "@medv/finder";
import { MASK_SELECTOR } from "./mask";
import { cut } from "./text";
import type { Target } from "./types";

const MAX_TEXT = 200;

/** Visible text of an element without masked parts; empty when the element itself is masked. */
function unmaskedText(el: Element): string {
  if (el.closest(MASK_SELECTOR)) return "";
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll(MASK_SELECTOR).forEach((m) => m.remove());
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Describes the element the user pinned, in a form an agent can use to find it in code and in the page. */
export function describeTarget(el: Element): Target {
  const text = cut(unmaskedText(el), MAX_TEXT);
  const r = el.getBoundingClientRect();
  return {
    selector: cut(finder(el, { root: el.ownerDocument.body }), 2000),
    tagName: el.tagName.toLowerCase(),
    ...(text ? { text } : {}),
    rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
  };
}
