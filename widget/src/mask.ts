/** Elements hidden on every screenshot. Add `data-feedback-mask` to anything that shows personal data. */
export const MASK_SELECTOR = "[data-feedback-mask], input[type=password]";

/** Paints masked elements solid black. Call it on the document clone that is rendered to the screenshot. */
export function applyMask(doc: Document): void {
  doc.querySelectorAll<HTMLElement>(MASK_SELECTOR).forEach((el) => {
    el.style.backgroundColor = "#000";
    el.style.color = "transparent";
    el.style.borderColor = "#000";
  });
}
