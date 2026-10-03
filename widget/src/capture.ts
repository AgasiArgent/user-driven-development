import { cut } from "./text";
import type { Capture, FailedRequest } from "./types";

const LIMIT = 20;
const MAX_TEXT = 500;

function push<T>(buffer: T[], item: T): void {
  buffer.push(item);
  if (buffer.length > LIMIT) buffer.shift();
}

function stripQuery(url: string, base: string): string {
  try {
    const u = new URL(url, base);
    return cut(u.origin + u.pathname, 2000);
  } catch {
    return cut(url.split(/[?#]/)[0], 2000);
  }
}

function text(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value); // circular objects, BigInt
  }
}

/**
 * Starts recording console errors and failed HTTP requests on `win`.
 * Install it as early as possible: only what happens after this call is recorded.
 */
export function installCapture(win: Window & typeof globalThis): Capture & { uninstall(): void } {
  const errors: string[] = [];
  const requests: FailedRequest[] = [];
  const record = (message: string) => push(errors, cut(message, MAX_TEXT));

  const originalError = win.console.error;
  win.console.error = (...args: unknown[]) => {
    try {
      record(args.map(text).join(" "));
    } finally {
      originalError.apply(win.console, args);
    }
  };

  const onError = (e: ErrorEvent) => record(e.message || text(e.error));
  const onRejection = (e: PromiseRejectionEvent) => record(`Unhandled rejection: ${text(e.reason)}`);
  win.addEventListener("error", onError);
  win.addEventListener("unhandledrejection", onRejection);

  const originalFetch = win.fetch;
  win.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = cut((init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase(), 10);
    const url = stripQuery(input instanceof Request ? input.url : String(input), win.location.href);
    try {
      const response = await originalFetch.call(win, input, init);
      if (response.status >= 400) push(requests, { method, url, status: response.status });
      return response;
    } catch (err) {
      push(requests, { method, url, status: 0 });
      throw err;
    }
  };

  const xhrOpen = win.XMLHttpRequest.prototype.open;
  const xhrSend = win.XMLHttpRequest.prototype.send;
  win.XMLHttpRequest.prototype.open = function (this: XMLHttpRequest & { __udd?: [string, string] }, method: string, url: string | URL, ...rest: unknown[]) {
    this.__udd = [cut(method.toUpperCase(), 10), stripQuery(String(url), win.location.href)];
    return (xhrOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
  };
  win.XMLHttpRequest.prototype.send = function (this: XMLHttpRequest & { __udd?: [string, string]; __uddListening?: boolean }, body?: Document | XMLHttpRequestBodyInit | null) {
    if (this.__uddListening) return xhrSend.call(this, body);
    this.__uddListening = true; // one listener per object, even when it is reused
    this.addEventListener("loadend", () => {
      if (this.__udd && (this.status === 0 || this.status >= 400)) {
        push(requests, { method: this.__udd[0], url: this.__udd[1], status: this.status });
      }
    });
    return xhrSend.call(this, body);
  };

  return {
    consoleErrors: () => [...errors],
    failedRequests: () => requests.map((r) => ({ ...r })),
    uninstall() {
      win.console.error = originalError;
      win.removeEventListener("error", onError);
      win.removeEventListener("unhandledrejection", onRejection);
      win.fetch = originalFetch;
      win.XMLHttpRequest.prototype.open = xhrOpen;
      win.XMLHttpRequest.prototype.send = xhrSend;
    },
  };
}
