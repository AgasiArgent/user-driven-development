import { describeTarget } from "./target";
import { cut } from "./text";
import type { Capture, FeedbackReport } from "./types";

export interface ReportInput {
  comment: string;
  user?: string;
  target?: Element;
  screenshot?: string;
  capture: Capture;
  win: Window;
}

/** Assembles the request body defined in contracts/feedback-report.schema.json. */
export function buildReport(input: ReportInput): FeedbackReport {
  const { win } = input;
  return {
    comment: input.comment.trim(),
    createdAt: new Date().toISOString(),
    ...(input.user ? { user: cut(input.user, 200) } : {}),
    ...(input.target ? { target: describeTarget(input.target) } : {}),
    ...(input.screenshot ? { screenshot: input.screenshot } : {}),
    context: {
      // Query string and fragment can carry tokens; the path is enough to find the page.
      url: cut(win.location.origin + win.location.pathname, 2000),
      viewport: { width: win.innerWidth, height: win.innerHeight },
      userAgent: cut(win.navigator.userAgent, 500),
      consoleErrors: input.capture.consoleErrors(),
      failedRequests: input.capture.failedRequests(),
    },
  };
}
