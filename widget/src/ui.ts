import html2canvas from "html2canvas-pro";
import { applyMask } from "./mask";
import { buildReport } from "./report";
import { captureScreenshot } from "./screenshot";
import { createSubmitter } from "./submit";
import type { Capture } from "./types";

const SCREENSHOT_TIMEOUT_MS = 15_000;
const SCREENSHOT_MAX_CHARS = 2_800_000; // about 2 MB of PNG after base64
const PIN_ATTR = "data-udd-pinned";

const STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; font: 14px/1.4 system-ui, sans-serif; }
  .fab { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; border: 0; border-radius: 999px;
         padding: 10px 16px; background: #1f2937; color: #fff; cursor: pointer; box-shadow: 0 2px 8px #0004; }
  .hint { position: fixed; left: 50%; top: 12px; transform: translateX(-50%); z-index: 2147483646;
          background: #1f2937; color: #fff; padding: 6px 12px; border-radius: 6px; }
  .box { position: fixed; z-index: 2147483645; pointer-events: none; border: 2px solid #ef4444;
         background: #ef444422; border-radius: 3px; }
  .panel { position: fixed; right: 16px; bottom: 64px; z-index: 2147483646; width: min(360px, calc(100vw - 32px));
           background: #fff; color: #111; border-radius: 10px; padding: 12px; box-shadow: 0 4px 16px #0005; }
  textarea { width: 100%; min-height: 96px; padding: 8px; border: 1px solid #ccc; border-radius: 6px; resize: vertical; }
  .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
  button.secondary { background: #e5e7eb; color: #111; }
  .row button { border: 0; border-radius: 6px; padding: 8px 12px; cursor: pointer; background: #1f2937; color: #fff; }
  .row button:disabled { opacity: .6; cursor: default; }
  .msg { margin-top: 8px; }
  .msg.error { color: #b91c1c; }
`;

export interface WidgetOptions {
  endpoint: string;
  user?: string;
  capture: Capture;
}

/** Mounts the feedback button and its flow into the page, isolated in a shadow root. */
export function mountWidget(opts: WidgetOptions): HTMLElement {
  const host = document.createElement("udd-feedback");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${STYLE}</style><button class="fab" type="button">Feedback</button>`;
  document.body.appendChild(host);
  const fab = root.querySelector<HTMLButtonElement>(".fab")!;
  const submit = createSubmitter(window.fetch.bind(window));

  fab.addEventListener("click", () => startPinMode());

  function startPinMode(): void {
    fab.hidden = true;
    const hint = el("div", "hint", "Click the element the feedback is about · Esc to cancel");
    const box = el("div", "box");
    root.append(hint, box);

    const onMove = (e: MouseEvent) => {
      const t = pickable(e);
      if (!t) return;
      const r = t.getBoundingClientRect();
      Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    };
    const onClick = (e: MouseEvent) => {
      const t = pickable(e);
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      stop();
      openPanel(t);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        stop();
        fab.hidden = false;
      }
    };
    function stop(): void {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      hint.remove();
      box.remove();
    }
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
  }

  function pickable(e: MouseEvent): Element | null {
    const t = e.target as Element | null;
    return t && t !== host && !host.contains(t) ? t : null;
  }

  function openPanel(target: Element): void {
    const panel = el("div", "panel");
    panel.innerHTML = `
      <label>What is wrong here?<textarea maxlength="4000" required></textarea></label>
      <div class="row"><button type="button" class="secondary cancel">Cancel</button><button type="button" class="send">Send</button></div>
      <div class="msg" role="status"></div>`;
    root.appendChild(panel);
    const textarea = panel.querySelector("textarea")!;
    const send = panel.querySelector<HTMLButtonElement>(".send")!;
    const msg = panel.querySelector<HTMLDivElement>(".msg")!;
    textarea.focus();

    const close = () => {
      panel.remove();
      fab.hidden = false;
    };
    panel.querySelector(".cancel")!.addEventListener("click", close);
    send.addEventListener("click", async () => {
      if (!textarea.value.trim()) {
        show(msg, "Please describe the problem.", true);
        return;
      }
      send.disabled = true;
      show(msg, "Sending…", false);
      try {
        const screenshot = await screenshotOf(target); // the widget's own host is excluded from the image
        const report = buildReport({ comment: textarea.value, user: opts.user, target, screenshot, capture: opts.capture, win: window });
        const id = await submit(opts.endpoint, report);
        show(msg, `Thank you — your feedback is ${id}.`, false);
        panel.querySelector(".row")!.remove();
        setTimeout(close, 4000);
      } catch (err) {
        show(msg, err instanceof Error ? err.message : "Feedback was not sent. Please try again.", true);
        send.disabled = false;
      }
    });
  }

  function screenshotOf(target: Element): Promise<string | undefined> {
    target.setAttribute(PIN_ATTR, "");
    return captureScreenshot({
      timeoutMs: SCREENSHOT_TIMEOUT_MS,
      maxBytes: SCREENSHOT_MAX_CHARS,
      render: () =>
        html2canvas(document.body, {
          logging: false,
          ignoreElements: (node) => node === host,
          x: window.scrollX,
          y: window.scrollY,
          width: window.innerWidth,
          height: window.innerHeight,
          onclone: (doc) => {
            applyMask(doc);
            const pinned = doc.querySelector<HTMLElement>(`[${PIN_ATTR}]`);
            if (pinned) pinned.style.outline = "3px solid #ef4444";
          },
        }),
    }).finally(() => target.removeAttribute(PIN_ATTR));
  }

  return host;
}

function el(tag: string, className: string, text = ""): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function show(node: HTMLElement, text: string, isError: boolean): void {
  node.textContent = text;
  node.classList.toggle("error", isError);
}
