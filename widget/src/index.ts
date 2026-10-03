import { installCapture } from "./capture";
import { mountWidget } from "./ui";

// Usage: <script src="widget.js" data-endpoint="/api/feedback" data-user="alice" defer></script>
const script = document.currentScript as HTMLScriptElement | null;
const endpoint = script?.dataset.endpoint;
const capture = installCapture(window);

function start(): void {
  if (!endpoint) {
    console.warn("[feedback widget] data-endpoint is missing on the script tag; the widget is disabled.");
    return;
  }
  mountWidget({ endpoint, user: script?.dataset.user || undefined, capture });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
