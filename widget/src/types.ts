export interface FailedRequest {
  method: string;
  url: string;
  /** HTTP status, or 0 for a network error. */
  status: number;
}

export interface Capture {
  consoleErrors(): string[];
  failedRequests(): FailedRequest[];
}

export interface Target {
  selector: string;
  tagName: string;
  text?: string;
  rect?: { x: number; y: number; width: number; height: number };
}

export interface FeedbackReport {
  comment: string;
  createdAt: string;
  user?: string;
  target?: Target;
  screenshot?: string;
  context: {
    url: string;
    viewport?: { width: number; height: number };
    userAgent?: string;
    consoleErrors?: string[];
    failedRequests?: FailedRequest[];
  };
}
