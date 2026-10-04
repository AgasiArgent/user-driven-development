import type { Issue, NewIssue, State, Tracker } from "./types.ts";

export interface LinearOptions {
  /** A Linear API key (sent as is) or an OAuth token prefixed with "Bearer ". */
  apiKey: string;
  teamId: string;
  fetchFn?: typeof fetch;
}

const ISSUE_FIELDS = "id identifier title description state { name } labels { nodes { name } }";

interface IssueNode {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state: { name: string };
  labels: { nodes: { name: string }[] };
}

const toIssue = (n: IssueNode): Issue => ({
  id: n.id,
  key: n.identifier,
  title: n.title,
  body: n.description ?? "",
  state: n.state.name as State,
  labels: n.labels.nodes.map((l) => l.name),
});

/** Linear GraphQL implementation of the tracker. State and label names must exist in the team. */
export function createLinearTracker({ apiKey, teamId, fetchFn = fetch }: LinearOptions): Tracker {
  let states: Map<string, string> | undefined;
  let labels: Map<string, string> | undefined;

  async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await fetchFn("https://api.linear.app/graphql", {
      method: "POST",
      headers: { authorization: apiKey, "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message: string }[] };
    if (!res.ok || json.errors?.length || !json.data) {
      throw new Error(`Linear: ${json.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`}`);
    }
    return json.data;
  }

  async function stateId(name: State): Promise<string> {
    states ??= new Map(
      (await gql<{ workflowStates: { nodes: { id: string; name: string }[] } }>(
        "query States($teamId: ID!) { workflowStates(filter: { team: { id: { eq: $teamId } } }) { nodes { id name } } }",
        { teamId },
      )).workflowStates.nodes.map((s) => [s.name, s.id]),
    );
    const id = states.get(name);
    if (!id) throw new Error(`Linear: state "${name}" does not exist in the team`);
    return id;
  }

  async function labelIds(names: string[]): Promise<string[]> {
    labels ??= new Map(
      (await gql<{ issueLabels: { nodes: { id: string; name: string }[] } }>(
        "query Labels($teamId: ID!) { issueLabels(filter: { team: { id: { eq: $teamId } } }) { nodes { id name } } }",
        { teamId },
      )).issueLabels.nodes.map((l) => [l.name, l.id]),
    );
    return names.map((n) => {
      const id = labels!.get(n);
      if (!id) throw new Error(`Linear: label "${n}" does not exist in the team`);
      return id;
    });
  }

  return {
    async create({ title, body, labels: names }: NewIssue) {
      const input = { teamId, title, description: body, stateId: await stateId("Triage"), labelIds: await labelIds(names) };
      const data = await gql<{ issueCreate: { issue: IssueNode } }>(
        `mutation Create($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { ${ISSUE_FIELDS} } } }`,
        { input },
      );
      return toIssue(data.issueCreate.issue);
    },
    async get(id) {
      return toIssue((await gql<{ issue: IssueNode }>(`query Get($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`, { id })).issue);
    },
    async listByState(state) {
      const data = await gql<{ issues: { nodes: IssueNode[] } }>(
        `query ByState($teamId: ID!, $state: String!) { issues(first: 50, filter: { team: { id: { eq: $teamId } }, state: { name: { eq: $state } } }) { nodes { ${ISSUE_FIELDS} } } }`,
        { teamId, state },
      );
      return data.issues.nodes.map(toIssue);
    },
    async setState(id, state) {
      const sid = await stateId(state);
      await gql("mutation Move($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }", { id, stateId: sid });
    },
    async comment(id, text) {
      await gql("mutation Comment($input: CommentCreateInput!) { commentCreate(input: $input) { success } }", { input: { issueId: id, body: text } });
    },
    async findOpenByMarker(marker) {
      const data = await gql<{ issues: { nodes: IssueNode[] } }>(
        `query ByMarker($teamId: ID!, $marker: String!) { issues(first: 1, filter: { team: { id: { eq: $teamId } }, description: { contains: $marker }, state: { type: { nin: ["completed", "canceled"] } } }) { nodes { ${ISSUE_FIELDS} } } }`,
        { teamId, marker },
      );
      return data.issues.nodes[0] ? toIssue(data.issues.nodes[0]) : null;
    },
  };
}
