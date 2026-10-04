/** The coding agent behind the dispatcher. It only produces a change; git, checks and the PR are the dispatcher's. */
export interface CodingAgent {
  start(prompt: string): Promise<{ taskId: string }>;
  poll(taskId: string): Promise<"pending" | "ready" | "failed">;
  /** Applies the task's change to the checkout at `dir`. */
  apply(taskId: string, dir: string): Promise<void>;
}
