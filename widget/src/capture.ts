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
    return u.origin + u.pathname;
  } catch {
    return url.split("?")[0];
  }
}

function text(value: unknown): string {
  if (value instanceof Error) return value.message;
  return typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
}

/**
 * Starts recording console errors and failed HTTP requests on `win`.
 * Install it as early as possible: only what happens after this call is recorded.
 */
export function installCapture(win: Window & typeof globalThis): Capture & { uninstall(): void } {
  const errors: string[] = [];
  const requests: FailedRequest[] = [];
  const base = win.location.href;
  const record = (message: string) => push(errors, message.slice(0, MAX_TEXT));

  const originalError = win.console.error;
  win.console.error = (...args: unknown[]) => {
    record(args.map(text).join(" "));
    originalError.apply(win.console, args);
  };

  const onError = (e: ErrorEvent) => record(e.message || text(e.error));
  const onRejection = (e: PromiseRejectionEvent) => record(`Unhandled rejection: ${text(e.reason)}`);
  win.addEventListener("error", onError);
  win.addEventListener("unhandledrejection", onRejection);

  const originalFetch = win.fetch;
  win.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const url = stripQuery(input instanceof Request ? input.url : String(input), base);
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
    this.__udd = [method.toUpperCase(), stripQuery(String(url), base)];
    return (xhrOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
  };
  win.XMLHttpRequest.prototype.send = function (this: XMLHttpRequest & { __udd?: [string, string] }, body?: Document | XMLHttpRequestBodyInit | null) {
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
