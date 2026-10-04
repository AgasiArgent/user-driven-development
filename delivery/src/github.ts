export interface NewIssue {
  title: string;
  body: string;
  labels: string[];
}

export interface IssueState {
  state: "open" | "closed";
  stateReason: string | null;
  labels: string[];
}

/** The part of an issue tracker that delivery needs. GitHub is one implementation. */
export interface IssueTracker {
  createIssue(issue: NewIssue): Promise<{ number: number }>;
  getIssue(number: number): Promise<IssueState>;
}

export interface GitHubOptions {
  token: string;
  /** "owner/repo" */
  repo: string;
  fetchFn?: typeof fetch;
}

export function createGitHubClient({ token, repo, fetchFn = fetch }: GitHubOptions): IssueTracker {
  const base = `https://api.github.com/repos/${repo}/issues`;
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "content-type": "application/json",
  };

  async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await fetchFn(url, { ...init, headers });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }

  return {
    async createIssue(issue) {
      const created = await call<{ number: number }>(base, { method: "POST", body: JSON.stringify(issue) });
      return { number: created.number };
    },
    async getIssue(number) {
      const i = await call<{ state: "open" | "closed"; state_reason: string | null; labels: { name: string }[] }>(`${base}/${number}`);
      return { state: i.state, stateReason: i.state_reason, labels: i.labels.map((l) => l.name) };
    },
  };
}
