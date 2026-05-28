import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import api, { type ActivityRecord, type PaginatedResponse } from "../api";

function statusBadge(status: string) {
  const map: Record<string, string> = {
    pending_review: "badge-pending",
    approved: "badge-approved",
    rejected: "badge-rejected",
    flagged_suspicious: "badge-flagged",
  };
  const labels: Record<string, string> = {
    pending_review: "Pending",
    approved: "Approved",
    rejected: "Rejected",
    flagged_suspicious: "Flagged",
  };
  return <span className={`badge ${map[status] ?? ""}`}>{labels[status] ?? status}</span>;
}

function scopeBadge(scope: number) {
  return <span className={`badge badge-scope${scope}`}>Scope {scope}</span>;
}

function sourceBadge(sourceType: string) {
  return <span className={`badge badge-${sourceType.toLowerCase()}`}>{sourceType}</span>;
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export default function ReviewPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [records, setRecords] = useState<ActivityRecord[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("approved");
  const [bulkLoading, setBulkLoading] = useState(false);
  const [message, setMessage] = useState("");

  const page = parseInt(searchParams.get("page") ?? "1");
  const status = searchParams.get("status") ?? "";
  const scope = searchParams.get("scope") ?? "";
  const sourceType = searchParams.get("source_type") ?? "";
  const search = searchParams.get("search") ?? "";

  const fetchRecords = () => {
    setLoading(true);
    const params: Record<string, string> = { page: String(page) };
    if (status) params.status = status;
    if (scope) params.scope = scope;
    if (sourceType) params.source_type = sourceType;
    if (search) params.search = search;
    api.get<PaginatedResponse<ActivityRecord>>("/records/", { params })
      .then(r => { setRecords(r.data.results); setCount(r.data.count); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchRecords(); }, [searchParams]);

  const setFilter = (key: string, val: string) => {
    const p = new URLSearchParams(searchParams);
    if (val) p.set(key, val); else p.delete(key);
    p.delete("page");
    setSearchParams(p);
    setSelected(new Set());
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === records.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(records.map(r => r.id)));
    }
  };

  const handleBulkAction = async () => {
    if (selected.size === 0) return;
    setBulkLoading(true);
    setMessage("");
    try {
      const r = await api.post("/records/bulk_review/", {
        ids: Array.from(selected),
        status: bulkStatus,
      });
      setMessage(`Updated ${r.data.updated} records`);
      setSelected(new Set());
      fetchRecords();
    } finally {
      setBulkLoading(false);
    }
  };

  const totalPages = Math.ceil(count / 50);

  return (
    <div>
      <div className="page-header">
        <h1>Review Queue</h1>
        <p>{count} records{status ? ` — ${status.replace(/_/g, " ")}` : ""}</p>
      </div>

      {message && <div className="alert alert-success">{message}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="filter-bar">
          <select value={status} onChange={e => setFilter("status", e.target.value)}>
            <option value="">All Statuses</option>
            <option value="pending_review">Pending Review</option>
            <option value="flagged_suspicious">Flagged</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <select value={scope} onChange={e => setFilter("scope", e.target.value)}>
            <option value="">All Scopes</option>
            <option value="1">Scope 1 — Fuel</option>
            <option value="2">Scope 2 — Electricity</option>
            <option value="3">Scope 3 — Travel</option>
          </select>
          <select value={sourceType} onChange={e => setFilter("source_type", e.target.value)}>
            <option value="">All Sources</option>
            <option value="SAP">SAP</option>
            <option value="UTILITY">Utility</option>
            <option value="TRAVEL">Travel</option>
          </select>
          <input
            placeholder="Search facility, description…"
            value={search}
            onChange={e => setFilter("search", e.target.value)}
            style={{ minWidth: 200 }}
          />
        </div>

        {selected.size > 0 && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--border)" }}>
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{selected.size} selected</span>
            <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value)} style={{ width: "auto", minWidth: 140 }}>
              <option value="approved">Approve</option>
              <option value="rejected">Reject</option>
              <option value="flagged_suspicious">Flag</option>
            </select>
            <button className="btn-primary btn-sm" onClick={handleBulkAction} disabled={bulkLoading}>
              {bulkLoading ? "Applying…" : "Apply to selected"}
            </button>
            <button className="btn-secondary btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        )}
      </div>

      <div className="card">
        {loading ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>
        ) : (
          <div className="overflow-auto">
            <table>
              <thead>
                <tr>
                  <th><input type="checkbox" checked={selected.size === records.length && records.length > 0} onChange={selectAll} /></th>
                  <th>Status</th>
                  <th>Scope</th>
                  <th>Category</th>
                  <th>Facility</th>
                  <th>Period</th>
                  <th>Quantity</th>
                  <th>Source</th>
                  <th>Issues</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.id}>
                    <td><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} /></td>
                    <td>{statusBadge(r.status)}</td>
                    <td>{scopeBadge(r.scope)}</td>
                    <td style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <span title={r.category_display} style={{ fontSize: 12 }}>{r.category_display}</span>
                    </td>
                    <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <span title={r.facility_name || r.facility_code}>{r.facility_name || r.facility_code}</span>
                    </td>
                    <td style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                      {fmtDate(r.period_start)}
                      {r.period_start !== r.period_end && <> – {fmtDate(r.period_end)}</>}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <strong>{parseFloat(r.normalized_quantity).toLocaleString("en", { maximumFractionDigits: 1 })}</strong>
                      <span style={{ color: "var(--text-muted)", marginLeft: 4, fontSize: 12 }}>{r.normalized_unit}</span>
                    </td>
                    <td>{sourceBadge(r.source_type)}</td>
                    <td>
                      {r.issue_count > 0 && (
                        <span style={{ color: "var(--orange)", fontSize: 12 }}>⚠ {r.issue_count}</span>
                      )}
                    </td>
                    <td>
                      <Link to={`/review/${r.id}`}>
                        <button className="btn-secondary btn-sm">Review</button>
                      </Link>
                    </td>
                  </tr>
                ))}
                {records.length === 0 && (
                  <tr><td colSpan={10} style={{ textAlign: "center", padding: 32, color: "var(--text-muted)" }}>No records found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="pagination">
            <span>{(page - 1) * 50 + 1}–{Math.min(page * 50, count)} of {count}</span>
            <button className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => setFilter("page", String(page - 1))}>← Prev</button>
            <button className="btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setFilter("page", String(page + 1))}>Next →</button>
          </div>
        )}
      </div>
    </div>
  );
}
