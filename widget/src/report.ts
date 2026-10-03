import { describeTarget } from "./target";
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
    ...(input.user ? { user: input.user } : {}),
    ...(input.target ? { target: describeTarget(input.target) } : {}),
    ...(input.screenshot ? { screenshot: input.screenshot } : {}),
    context: {
      url: win.location.href,
      viewport: { width: win.innerWidth, height: win.innerHeight },
      userAgent: win.navigator.userAgent.slice(0, 500),
      consoleErrors: input.capture.consoleErrors(),
      failedRequests: input.capture.failedRequests(),
    },
  };
}
