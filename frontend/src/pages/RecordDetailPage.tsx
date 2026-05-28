import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api, { type ActivityRecord } from "../api";

function fmtDateTime(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function statusBadge(status: string) {
  const map: Record<string, [string, string]> = {
    pending_review: ["badge-pending", "Pending Review"],
    approved: ["badge-approved", "Approved"],
    rejected: ["badge-rejected", "Rejected"],
    flagged_suspicious: ["badge-flagged", "Flagged — Suspicious"],
  };
  const [cls, label] = map[status] ?? ["", status];
  return <span className={`badge ${cls}`}>{label}</span>;
}

const ACTION_LABELS: Record<string, string> = {
  ingested: "Ingested",
  approved: "Approved",
  rejected: "Rejected",
  flagged: "Flagged as Suspicious",
  edited: "Edited",
  note_added: "Note Added",
};

export default function RecordDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [record, setRecord] = useState<ActivityRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewStatus, setReviewStatus] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<ActivityRecord>(`/records/${id}/`)
      .then(r => { setRecord(r.data); setReviewStatus(r.data.status); setNotes(r.data.review_notes); })
      .finally(() => setLoading(false));
  }, [id]);

  const handleReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!record) return;
    setSubmitting(true);
    setError("");
    try {
      const r = await api.post<ActivityRecord>(`/records/${id}/review/`, { status: reviewStatus, notes });
      setRecord(r.data);
    } catch {
      setError("Failed to save review");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="loading-screen">Loading…</div>;
  if (!record) return <div className="alert alert-error">Record not found</div>;

  return (
    <div>
      <div className="page-header flex justify-between items-center" style={{ marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
            <Link to="/review">← Back to Review Queue</Link>
          </div>
          <h1 style={{ fontSize: 18 }}>{record.category_display}</h1>
          <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
            {statusBadge(record.status)}
            <span className={`badge badge-scope${record.scope}`}>Scope {record.scope}</span>
            <span className={`badge badge-${record.source_type?.toLowerCase()}`}>{record.source_type}</span>
          </div>
        </div>
      </div>

      <div className="two-col">
        {/* Left: Data details */}
        <div>
          <div className="card mb-4">
            <h3 style={{ marginBottom: 12, fontSize: 14, fontWeight: 600 }}>Activity Data</h3>
            <table className="source-row-table">
              <tbody>
                <tr><td>Category</td><td>{record.category_display}</td></tr>
                <tr><td>Period</td><td>{record.period_start} → {record.period_end}</td></tr>
                <tr><td>Facility</td><td>{record.facility_name || record.facility_code || "—"}</td></tr>
                <tr><td>Facility Code</td><td>{record.facility_code || "—"}</td></tr>
                <tr><td>Country</td><td>{record.country_code || "—"}</td></tr>
                <tr><td>Raw Quantity</td><td><strong>{parseFloat(record.raw_quantity).toLocaleString()}</strong> {record.raw_unit}</td></tr>
                <tr><td>Normalized</td><td><strong>{parseFloat(record.normalized_quantity).toLocaleString("en", { maximumFractionDigits: 2 })}</strong> {record.normalized_unit}</td></tr>
                <tr><td>Supplier/Vendor</td><td>{record.supplier_vendor || "—"}</td></tr>
                <tr><td>Description</td><td>{record.description || "—"}</td></tr>
                <tr><td>Source File</td><td style={{ fontSize: 11 }}>{record.batch_filename}</td></tr>
                <tr><td>Row Number</td><td>{(record as ActivityRecord & { source_row_number?: number }).source_row_number}</td></tr>
              </tbody>
            </table>
          </div>

          {record.issues && record.issues.length > 0 && (
            <div className="card mb-4">
              <h3 style={{ marginBottom: 12, fontSize: 14, fontWeight: 600 }}>Validation Issues</h3>
              {record.issues.map(issue => (
                <div key={issue.id} className={`alert alert-${issue.severity}`} style={{ marginBottom: 6, fontSize: 12 }}>
                  <strong>{issue.code}</strong>: {issue.message}
                </div>
              ))}
            </div>
          )}

          {record.source_row && Object.keys(record.source_row).length > 0 && (
            <div className="card">
              <h3 style={{ marginBottom: 12, fontSize: 14, fontWeight: 600 }}>Source Row (raw)</h3>
              <div className="overflow-auto">
                <table className="source-row-table">
                  <tbody>
                    {Object.entries(record.source_row).map(([k, v]) => (
                      <tr key={k}><td>{k}</td><td>{v}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Right: Review + audit */}
        <div>
          <div className="card mb-4">
            <h3 style={{ marginBottom: 12, fontSize: 14, fontWeight: 600 }}>Review Decision</h3>
            {error && <div className="alert alert-error">{error}</div>}
            <form onSubmit={handleReview}>
              <div className="form-group">
                <label>Decision</label>
                <select value={reviewStatus} onChange={e => setReviewStatus(e.target.value)}>
                  <option value="pending_review">Pending Review</option>
                  <option value="approved">Approve — Data is correct</option>
                  <option value="rejected">Reject — Data is invalid</option>
                  <option value="flagged_suspicious">Flag — Needs investigation</option>
                </select>
              </div>
              <div className="form-group">
                <label>Notes (required for reject/flag)</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Explain your decision for the audit trail…"
                />
              </div>
              <button className="btn-primary" style={{ width: "100%" }} disabled={submitting}>
                {submitting ? "Saving…" : "Save Decision"}
              </button>
            </form>

            {record.reviewed_by_username && (
              <div style={{ marginTop: 12, padding: 10, background: "var(--gray-light)", borderRadius: 6, fontSize: 12 }}>
                Last reviewed by <strong>{record.reviewed_by_username}</strong> on {fmtDateTime(record.reviewed_at)}
                {record.review_notes && <div style={{ marginTop: 4, color: "var(--text-muted)" }}>"{record.review_notes}"</div>}
              </div>
            )}
          </div>

          {record.audit_log && record.audit_log.length > 0 && (
            <div className="card">
              <h3 style={{ marginBottom: 12, fontSize: 14, fontWeight: 600 }}>Audit Trail</h3>
              <ul className="audit-timeline">
                {record.audit_log.map(entry => (
                  <li key={entry.id}>
                    <div className="time">{fmtDateTime(entry.performed_at)}</div>
                    <div>
                      <strong>{ACTION_LABELS[entry.action] ?? entry.action}</strong>
                      {entry.performed_by_username && <span style={{ color: "var(--text-muted)" }}> by {entry.performed_by_username}</span>}
                      {entry.notes && <div style={{ color: "var(--text-muted)", marginTop: 2 }}>"{entry.notes}"</div>}
                      {"status" in entry.old_values && (
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          {String(entry.old_values["status"]).replace(/_/g, " ")} → {String(entry.new_values["status"] ?? "").replace(/_/g, " ")}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
