import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { type DashboardStats } from "../api";

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function batchStatusBadge(s: string) {
  const cls = s === "completed" ? "badge-approved" : s === "failed" ? "badge-rejected" : "badge-warning";
  return <span className={`badge ${cls}`}>{s.replace(/_/g, " ")}</span>;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<DashboardStats>("/dashboard/").then(r => setStats(r.data)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading-screen">Loading dashboard…</div>;
  if (!stats) return <div className="alert alert-error">Failed to load dashboard</div>;

  const scopeLabels: Record<string, string> = {
    scope_1: "Scope 1 — Direct",
    scope_2: "Scope 2 — Electricity",
    scope_3: "Scope 3 — Travel",
  };
  const sourceLabels: Record<string, string> = {
    SAP: "SAP (Fuel)",
    UTILITY: "Utility",
    TRAVEL: "Travel",
  };

  return (
    <div>
      <div className="page-header flex justify-between items-center">
        <div>
          <h1>Dashboard</h1>
          <p>Activity data overview for Q1 2024</p>
        </div>
        <Link to="/review?status=pending_review">
          <button className="btn-primary">
            Review pending ({stats.pending_review})
          </button>
        </Link>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="number">{stats.total_records}</div>
          <div className="label">Total Records</div>
        </div>
        <div className="stat-card">
          <div className="number" style={{ color: "var(--orange)" }}>{stats.pending_review}</div>
          <div className="label">Pending Review</div>
        </div>
        <div className="stat-card">
          <div className="number" style={{ color: "var(--green)" }}>{stats.approved}</div>
          <div className="label">Approved</div>
        </div>
        <div className="stat-card">
          <div className="number" style={{ color: "var(--blue)" }}>{stats.flagged}</div>
          <div className="label">Flagged</div>
        </div>
        <div className="stat-card">
          <div className="number" style={{ color: "var(--red)" }}>{stats.rejected}</div>
          <div className="label">Rejected</div>
        </div>
      </div>

      <div className="two-col" style={{ marginBottom: 24 }}>
        <div className="card">
          <h3 style={{ marginBottom: 16, fontSize: 15, fontWeight: 600 }}>By Scope</h3>
          {Object.entries(stats.scope_breakdown).map(([key, count]) => (
            <div key={key} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
              <span className={`badge badge-${key.replace("_", "")}`}>{scopeLabels[key] ?? key}</span>
              <strong>{count}</strong>
            </div>
          ))}
        </div>
        <div className="card">
          <h3 style={{ marginBottom: 16, fontSize: 15, fontWeight: 600 }}>By Source</h3>
          {Object.entries(stats.source_breakdown).map(([key, count]) => (
            <div key={key} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
              <span className={`badge badge-${key.toLowerCase()}`}>{sourceLabels[key] ?? key}</span>
              <strong>{count}</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 16, fontSize: 15, fontWeight: 600 }}>Recent Ingestion Batches</h3>
        <div className="overflow-auto">
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>Source</th>
                <th>Uploaded</th>
                <th>Status</th>
                <th>Records</th>
                <th>Errors</th>
                <th>Warnings</th>
              </tr>
            </thead>
            <tbody>
              {stats.recent_batches.map(b => (
                <tr key={b.id}>
                  <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {b.original_filename}
                  </td>
                  <td><span className={`badge badge-${b.source_type.toLowerCase()}`}>{b.source_type}</span></td>
                  <td className="text-muted">{fmtDate(b.uploaded_at)}</td>
                  <td>{batchStatusBadge(b.status)}</td>
                  <td>{b.accepted_count}</td>
                  <td style={{ color: b.rejected_count > 0 ? "var(--red)" : undefined }}>{b.rejected_count}</td>
                  <td style={{ color: b.warning_count > 0 ? "var(--orange)" : undefined }}>{b.warning_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
