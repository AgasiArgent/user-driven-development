export const LABELS = ["feedback", "researched", "approved", "in-progress", "fix-ready", "shipped", "verified", "needs-human"];

export const LABEL_COLORS = {
  feedback: "ededed",
  researched: "c5def5",
  approved: "0e8a16",
  "in-progress": "fbca04",
  "fix-ready": "1d76db",
  shipped: "5319e7",
  verified: "0e8a16",
  "needs-human": "d93f0b",
  routine: "bfdadc",
  "routine:dead-code": "bfdadc",
  "routine:duplicates": "bfdadc",
  "routine:security": "bfdadc",
  security: "b60205",
};

const RULES = [
  ["verified", "Verified in production"],
  ["needs-human", "Waiting for the developer"],
  ["shipped", "Shipped"],
  ["fix-ready", "Fix ready"],
  ["in-progress", "In progress"],
  ["approved", "Approved"],
  ["researched", "Looked into"],
];

export function statusFromIssue({ labels = [], state, stateReason = null }) {
  if (state === "closed" && stateReason === "not_planned") return { key: "declined", text: "Declined" };
  for (const [key, text] of RULES) if (labels.includes(key)) return { key, text };
  if (state === "closed" && stateReason === "completed") return { key: "shipped", text: "Shipped" };
  return { key: "received", text: "Received" };
}
