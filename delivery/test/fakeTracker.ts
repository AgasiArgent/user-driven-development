import type { IssueState, IssueTracker, NewIssue } from "../src/github.ts";

/** In-memory stand-in for GitHub Issues. */
export class FakeTracker implements IssueTracker {
  issues = new Map<number, NewIssue & IssueState>();
  failNext = 0;
  private next = 1;

  async createIssue(issue: NewIssue): Promise<{ number: number }> {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("GitHub answered 502");
    }
    const number = this.next++;
    this.issues.set(number, { ...issue, state: "open", stateReason: null });
    return { number };
  }

  async getIssue(number: number): Promise<IssueState> {
    const i = this.issues.get(number);
    if (!i) throw new Error(`no issue ${number}`);
    return { state: i.state, stateReason: i.stateReason, labels: i.labels };
  }
}
