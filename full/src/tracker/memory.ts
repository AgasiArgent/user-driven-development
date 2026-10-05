import type { Issue, NewIssue, State, Tracker } from "./types.ts";

/** In-memory tracker for tests. It forgets everything when the process ends. */
export class MemoryTracker implements Tracker {
  issues = new Map<string, Issue>();
  comments = new Map<string, string[]>();
  private next = 1;

  async create(input: NewIssue): Promise<Issue> {
    const n = this.next++;
    const issue: Issue = { id: `mem-${n}`, key: `MEM-${n}`, state: "Triage", ...input, labels: [...input.labels] };
    this.issues.set(issue.id, issue);
    return { ...issue };
  }

  async get(id: string): Promise<Issue> {
    const issue = this.issues.get(id);
    if (!issue) throw new Error(`No issue ${id}`);
    return { ...issue, labels: [...issue.labels] };
  }

  async listByState(state: State): Promise<Issue[]> {
    return [...this.issues.values()].filter((i) => i.state === state).map((i) => ({ ...i }));
  }

  async setState(id: string, state: State): Promise<void> {
    (await this.mustGet(id)).state = state;
  }

  async comment(id: string, text: string): Promise<void> {
    await this.mustGet(id);
    this.comments.set(id, [...(this.comments.get(id) ?? []), text]);
  }

  async findOpenByMarker(marker: string): Promise<Issue | null> {
    const hit = [...this.issues.values()].find((i) => i.state !== "Done" && i.state !== "Canceled" && i.body.includes(marker));
    return hit ? { ...hit } : null;
  }

  private async mustGet(id: string): Promise<Issue> {
    const issue = this.issues.get(id);
    if (!issue) throw new Error(`No issue ${id}`);
    return issue;
  }
}
