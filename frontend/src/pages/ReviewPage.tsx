import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import api, { type ActivityRecord, type PaginatedResponse } from "../api";

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
const fmtCO2e = (v: string | null) => {
  if (!v) return <span className="text-muted text-xs">—</span>;
  const n = parseFloat(v);
  return <span className="co2e-value">{n >= 1000 ? `${(n/1000).toFixed(2)} t` : `${n.toFixed(1)} kg`}</span>;
};

function StatusBadge({ s }: { s: string }) {
  const map: Record<string, string> = {
    pending_review: "badge-pending", approved: "badge-approved",
    rejected: "badge-rejected", flagged_suspicious: "badge-flagged",
  };
  const labels: Record<string, string> = {
    pending_review: "Pending", approved: "Approved",
    rejected: "Rejected", flagged_suspicious: "Flagged",
  };
  return <span className={`badge ${map[s] ?? ""}`}>{labels[s] ?? s}</span>;
}

function Toast({ message, type, onClose }: { message: string; type: "success"|"error"; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, [onClose]);
  return <div className={`toast toast-${type}`} onClick={onClose}>{message}</div>;
}

export default function ReviewPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [records, setRecords] = useState<ActivityRecord[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("approved");
  const [bulkLoading, setBulkLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success"|"error" } | null>(null);

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

  const toggleSelect = (id: string) => setSelected(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const allSelected = selected.size === records.length && records.length > 0;
  const selectAll = () => setSelected(allSelected ? new Set() : new Set(records.map(r => r.id)));

  const handleBulkAction = async () => {
    if (!selected.size) return;
    setBulkLoading(true);
    try {
      const r = await api.post("/records/bulk_review/", { ids: Array.from(selected), status: bulkStatus });
      setToast({ msg: `Updated ${r.data.updated} records`, type: "success" });
      setSelected(new Set());
      fetchRecords();
    } catch {
      setToast({ msg: "Bulk update failed", type: "error" });
    } finally {
      setBulkLoading(false);
    }
  };

  const totalPages = Math.ceil(count / 50);
  const statusLabel = status ? status.replace(/_/g, " ") : "all";

  return (
    <div>
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div className="page-header flex justify-between items-center">
        <div>
          <h1>Review Queue</h1>
          <p>
            {count} {statusLabel} records
            {selected.size > 0 && <span style={{ marginLeft: 8, color: "var(--green-800)", fontWeight: 600 }}>· {selected.size} selected</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <a href={`/api/records/export/?status=${status || "approved"}`} download>
            <button className="btn-secondary btn-sm">↓ Export CSV</button>
          </a>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
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
          <div className="spacer" />
          {(status || scope || sourceType || search) && (
            <button className="btn-ghost btn-sm" onClick={() => { setSearchParams({}); setSelected(new Set()); }}>
              Clear filters
            </button>
          )}
        </div>

        {selected.size > 0 && (
          <div style={{
            display: "flex", gap: 8, alignItems: "center",
            padding: "10px 14px", background: "var(--green-50)",
            border: "1px solid var(--green-100)", borderRadius: 8, marginTop: 4,
          }}>
            <span style={{ fontSize: 13, color: "var(--green-800)", fontWeight: 600 }}>{selected.size} selected</span>
            <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value)} style={{ width: "auto", minWidth: 150 }}>
              <option value="approved">Mark as Approved</option>
              <option value="rejected">Mark as Rejected</option>
              <option value="flagged_suspicious">Mark as Flagged</option>
            </select>
            <button className="btn-primary btn-sm" onClick={handleBulkAction} disabled={bulkLoading}>
              {bulkLoading ? "Applying…" : "Apply"}
            </button>
            <button className="btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Clear selection</button>
          </div>
        )}
      </div>

      <div className="card">
        {loading ? (
          <div style={{ padding: 40, textAlign: "center" }}>
            <div className="spinner" style={{ margin: "0 auto 10px" }} />
            <div className="text-muted">Loading records…</div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input type="checkbox" checked={allSelected} onChange={selectAll} />
                  </th>
                  <th>Status</th>
                  <th>Scope</th>
                  <th>Category</th>
                  <th>Facility</th>
                  <th>Period</th>
                  <th>Quantity</th>
                  <th>~CO₂e</th>
                  <th>Source</th>
                  <th style={{ width: 36 }}>!</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.id} className={r.status === "flagged_suspicious" ? "tr-flagged" : ""}>
                    <td><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} /></td>
                    <td><StatusBadge s={r.status} /></td>
                    <td>
                      <span className={`badge badge-scope${r.scope}`} style={{ fontSize: 10 }}>S{r.scope}</span>
                    </td>
                    <td className="truncate" style={{ maxWidth: 140 }}>
                      <span title={r.category_display} className="text-sm">{r.category_display}</span>
                    </td>
                    <td className="truncate" style={{ maxWidth: 160 }}>
                      <span title={r.facility_name || r.facility_code} className="text-sm">
                        {r.facility_name || r.facility_code || <span className="text-muted">—</span>}
                      </span>
                    </td>
                    <td className="text-muted text-xs" style={{ whiteSpace: "nowrap" }}>
                      {fmtDate(r.period_start)}
                      {r.period_start !== r.period_end && <> → {fmtDate(r.period_end)}</>}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                        {parseFloat(r.normalized_quantity).toLocaleString("en", { maximumFractionDigits: 1 })}
                      </span>
                      <span className="text-muted text-xs" style={{ marginLeft: 4 }}>{r.normalized_unit}</span>
                    </td>
                    <td>{fmtCO2e(r.co2e_kg)}</td>
                    <td><span className={`badge badge-${r.source_type.toLowerCase()}`} style={{ fontSize: 10 }}>{r.source_type}</span></td>
                    <td>
                      {r.issue_count > 0 && (
                        <span title={`${r.issue_count} issues`} style={{ color: "var(--amber)", fontWeight: 700, fontSize: 13 }}>!</span>
                      )}
                    </td>
                    <td>
                      <Link to={`/review/${r.id}`}>
                        <button className="btn-secondary btn-xs">Review</button>
                      </Link>
                    </td>
                  </tr>
                ))}
                {records.length === 0 && (
                  <tr>
                    <td colSpan={11} style={{ textAlign: "center", padding: 48, color: "var(--gray-500)" }}>
                      <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
                      <div style={{ fontWeight: 600 }}>No records</div>
                      <div className="text-sm mt-1">Try adjusting your filters</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="pagination">
            <span>{(page-1)*50+1}–{Math.min(page*50, count)} of {count}</span>
            <button className="btn-secondary btn-sm" disabled={page <= 1}
              onClick={() => setFilter("page", String(page-1))}>← Prev</button>
            <button className="btn-secondary btn-sm" disabled={page >= totalPages}
              onClick={() => setFilter("page", String(page+1))}>Next →</button>
          </div>
        )}
      </div>
    </div>
  );
}
