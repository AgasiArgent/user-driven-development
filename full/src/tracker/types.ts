/** Workflow states of the full loop (docs/full-level.md). Create them in your tracker team. */
export type State = "Triage" | "Approved for fix" | "In Progress" | "In Review" | "Done" | "Canceled";

export interface Issue {
  id: string;
  /** Human-readable key, e.g. ENG-7. */
  key: string;
  title: string;
  body: string;
  state: State;
  labels: string[];
}

export interface NewIssue {
  title: string;
  body: string;
  labels: string[];
}

/** What the loop needs from an issue tracker. Linear is one implementation; MemoryTracker is another. */
export interface Tracker {
  /** Creates the issue in Triage. */
  create(issue: NewIssue): Promise<Issue>;
  get(id: string): Promise<Issue>;
  listByState(state: State): Promise<Issue[]>;
  setState(id: string, state: State): Promise<void>;
  comment(id: string, text: string): Promise<void>;
  /** An issue that is not Done or Canceled and whose body contains `marker`, or null. */
  findOpenByMarker(marker: string): Promise<Issue | null>;
}
