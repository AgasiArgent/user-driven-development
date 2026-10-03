import type { FeedbackReport } from "./types";

/**
 * Returns a submit function that sends one report at a time: a second call while a
 * request is in flight gets the same result instead of sending a duplicate.
 */
export function createSubmitter(fetchFn: typeof fetch) {
  let inFlight: Promise<string> | undefined;

  async function send(endpoint: string, report: FeedbackReport): Promise<string> {
    const response = await fetchFn(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
    });
    const body = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
    if (response.status !== 201 || !body.id) {
      throw new Error(body.error ?? `Feedback was not sent (HTTP ${response.status}). Please try again.`);
    }
    return body.id;
  }

  return function submit(endpoint: string, report: FeedbackReport): Promise<string> {
    inFlight ??= send(endpoint, report).finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };
}
