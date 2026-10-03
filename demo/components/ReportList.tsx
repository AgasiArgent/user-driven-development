"use client";

import { useEffect, useState } from "react";

interface Report {
  id: string;
  status: string;
  comment: string;
  createdAt: string;
}

export function ReportList({ user }: { user: string }) {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/feedback?user=${encodeURIComponent(user)}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Could not load reports.");
        setReports(body.reports);
      })
      .catch((e: Error) => setError(e.message));
  }, [user]);

  if (error) return <p className="error">{error}</p>;
  if (!reports) return <p className="muted">Loading…</p>;
  if (!reports.length) return <p className="muted">No feedback yet.</p>;
  return (
    <table className="reports">
      <thead>
        <tr><th>ID</th><th>Status</th><th>Comment</th><th>Sent</th></tr>
      </thead>
      <tbody>
        {reports.map((r) => (
          <tr key={r.id}>
            <td>{r.id}</td>
            <td><span className="status">{r.status}</span></td>
            <td>{r.comment}</td>
            <td>{new Date(r.createdAt).toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
