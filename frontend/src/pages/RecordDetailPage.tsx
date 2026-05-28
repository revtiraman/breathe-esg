import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api, { type ActivityRecord } from "../api";

const fmt = (s: string | null) => {
  if (!s) return "—";
  return new Date(s).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

const fmtCO2e = (v: string | null) => {
  if (!v) return null;
  const n = parseFloat(v);
  return n >= 1000 ? `${(n/1000).toFixed(3)} tCO₂e` : `${n.toFixed(2)} kgCO₂e`;
};

const STATUS_MAP: Record<string, { cls: string; label: string }> = {
  pending_review:    { cls: "badge-pending", label: "Pending Review" },
  approved:          { cls: "badge-approved", label: "Approved" },
  rejected:          { cls: "badge-rejected", label: "Rejected" },
  flagged_suspicious:{ cls: "badge-flagged", label: "Flagged — Suspicious" },
};

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  ingested: { label: "Ingested", color: "var(--gray-500)" },
  approved: { label: "Approved", color: "var(--green-800)" },
  rejected: { label: "Rejected", color: "var(--red)" },
  flagged:  { label: "Flagged", color: "var(--blue-700)" },
  edited:   { label: "Edited", color: "var(--amber)" },
  note_added:{ label: "Note Added", color: "var(--gray-500)" },
};

function InfoRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <tr>
      <td style={{ color: "var(--gray-500)", fontWeight: 500, fontSize: 12, padding: "7px 0", width: "42%", verticalAlign: "top" }}>
        {label}
      </td>
      <td style={{ fontSize: 13, padding: "7px 0 7px 12px", fontFamily: mono ? "ui-monospace,monospace" : undefined }}>
        {value || <span className="text-muted">—</span>}
      </td>
    </tr>
  );
}

export default function RecordDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [record, setRecord] = useState<ActivityRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewStatus, setReviewStatus] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<ActivityRecord>(`/records/${id}/`)
      .then(r => {
        setRecord(r.data);
        setReviewStatus(r.data.status);
        setNotes(r.data.review_notes);
      })
      .finally(() => setLoading(false));
  }, [id]);

  const handleReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!record) return;
    setSubmitting(true); setError(""); setSaved(false);
    try {
      const r = await api.post<ActivityRecord>(`/records/${id}/review/`, { status: reviewStatus, notes });
      setRecord(r.data);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Failed to save. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return (
    <div className="loading-screen"><div className="spinner" /><span>Loading record…</span></div>
  );
  if (!record) return <div className="alert alert-error">Record not found.</div>;

  const s = STATUS_MAP[record.status] ?? { cls: "", label: record.status };
  const co2eDisplay = fmtCO2e(record.co2e_kg);
  const hasIssues = record.issues && record.issues.length > 0;

  return (
    <div>
      {/* Back + title */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, marginBottom: 8 }}>
          <Link to="/review" style={{ color: "var(--gray-500)" }}>← Review Queue</Link>
          <span className="text-muted"> / </span>
          <span className="text-muted text-xs font-mono">{record.id.slice(0, 8)}…</span>
        </div>
        <div className="flex justify-between items-start">
          <div>
            <h1 style={{ fontSize: 20 }}>{record.category_display}</h1>
            <div className="flex gap-2 mt-2 items-center" style={{ flexWrap: "wrap" }}>
              <span className={`badge ${s.cls}`}>{s.label}</span>
              <span className={`badge badge-scope${record.scope}`}>Scope {record.scope}</span>
              <span className={`badge badge-${record.source_type?.toLowerCase()}`}>{record.source_type}</span>
              {record.is_edited && <span className="badge badge-warning">Edited</span>}
              {record.issue_count > 0 && (
                <span className="badge badge-warning">{record.issue_count} issue{record.issue_count !== 1 ? "s" : ""}</span>
              )}
            </div>
          </div>
          {co2eDisplay && (
            <div style={{
              textAlign: "right", background: "var(--green-50)",
              border: "1px solid var(--green-100)", borderRadius: 10,
              padding: "10px 18px",
            }}>
              <div style={{ fontSize: 11, color: "var(--green-800)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".4px" }}>
                Estimated CO₂e
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "var(--green-800)", marginTop: 2 }}>
                {co2eDisplay}
              </div>
              {record.co2e_factor && (
                <div className="ef-pill" style={{ marginTop: 6, fontSize: 10 }}>
                  {record.co2e_factor} {record.co2e_factor_unit}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="two-col">
        {/* ── Left column ── */}
        <div>
          {/* Activity data */}
          <div className="card mb-4">
            <div className="card-header"><div className="card-title">Activity Data</div></div>
            <table style={{ width: "100%" }}>
              <tbody>
                <InfoRow label="Category" value={record.category_display} />
                <InfoRow label="Period" value={`${record.period_start} → ${record.period_end}`} />
                <InfoRow label="Facility" value={record.facility_name || record.facility_code} />
                <InfoRow label="Facility Code" value={record.facility_code} mono />
                <InfoRow label="Country" value={record.country_code} />
                <InfoRow label="Raw Quantity" value={
                  <span><strong>{parseFloat(record.raw_quantity).toLocaleString()}</strong> {record.raw_unit}</span>
                } />
                <InfoRow label="Normalized" value={
                  <span>
                    <strong>{parseFloat(record.normalized_quantity).toLocaleString("en", { maximumFractionDigits: 2 })}</strong>{" "}
                    {record.normalized_unit}
                  </span>
                } />
                <InfoRow label="Supplier/Vendor" value={record.supplier_vendor} />
                <InfoRow label="Description" value={record.description} />
              </tbody>
            </table>
          </div>

          {/* CO2e calculation box */}
          {record.co2e_kg && (
            <div className="card mb-4" style={{ borderLeft: "3px solid var(--green-600)" }}>
              <div className="card-title mb-2">CO₂e Estimate (DEFRA 2023)</div>
              <div style={{
                display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12,
                background: "var(--green-50)", borderRadius: 8, padding: 14,
              }}>
                <div>
                  <div style={{ fontSize: 11, color: "var(--gray-500)", marginBottom: 3 }}>ACTIVITY QUANTITY</div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>
                    {parseFloat(record.normalized_quantity).toLocaleString("en", { maximumFractionDigits: 1 })} {record.normalized_unit}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "var(--gray-500)", marginBottom: 3 }}>EMISSION FACTOR</div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>
                    {record.co2e_factor} <span style={{ fontSize: 12, fontWeight: 400 }}>{record.co2e_factor_unit}</span>
                  </div>
                </div>
              </div>
              <div style={{ textAlign: "center", padding: "10px 0" }}>
                <div style={{ fontSize: 11, color: "var(--gray-500)", marginBottom: 4 }}>ESTIMATED CO₂e</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: "var(--green-800)" }}>
                  {co2eDisplay}
                </div>
              </div>
              <div style={{ fontSize: 11, color: "var(--gray-500)", borderTop: "1px solid var(--gray-300)", paddingTop: 10, marginTop: 10, lineHeight: 1.5 }}>
                {record.co2e_factor_source}
              </div>
              <div className="alert alert-warning" style={{ marginTop: 10, marginBottom: 0, fontSize: 11 }}>
                Approximate only — validate against client-specific grid mix and fuel certificates before audit submission.
              </div>
            </div>
          )}

          {/* Validation issues */}
          {hasIssues && (
            <div className="card mb-4">
              <div className="card-title mb-2">Validation Issues</div>
              {record.issues!.map(issue => (
                <div key={issue.id} className={`alert alert-${issue.severity}`} style={{ marginBottom: 6, fontSize: 12 }}>
                  <strong>{issue.code}</strong>: {issue.message}
                  {issue.source_row_number && <span className="text-xs" style={{ marginLeft: 6 }}>(row {issue.source_row_number})</span>}
                </div>
              ))}
            </div>
          )}

          {/* Source row */}
          {record.source_row && Object.keys(record.source_row).length > 0 && (
            <div className="card">
              <div className="card-title mb-2">Raw Source Row</div>
              <div className="table-wrap">
                <table>
                  <tbody>
                    {Object.entries(record.source_row).map(([k, v]) => (
                      <tr key={k}>
                        <td style={{ color: "var(--gray-500)", fontSize: 11, padding: "5px 12px", width: "40%", fontWeight: 500 }}>{k}</td>
                        <td style={{ fontSize: 12, padding: "5px 12px", fontFamily: "ui-monospace,monospace", wordBreak: "break-all" }}>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-xs text-muted mt-2">
                Row {record.source_row_number} of {record.batch_filename}
              </div>
            </div>
          )}
        </div>

        {/* ── Right column ── */}
        <div>
          {/* Review form */}
          <div className="card mb-4">
            <div className="card-title mb-3">Analyst Decision</div>

            {error && <div className="alert alert-error">{error}</div>}
            {saved && <div className="alert alert-success">Decision saved successfully.</div>}

            <form onSubmit={handleReview}>
              <div className="form-group">
                <label>Decision</label>
                {["approved","rejected","flagged_suspicious","pending_review"].map(opt => {
                  const m = STATUS_MAP[opt];
                  return (
                    <label key={opt} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "9px 12px", borderRadius: 7, marginBottom: 5, cursor: "pointer",
                      border: `1.5px solid ${reviewStatus === opt ? "var(--green-600)" : "var(--gray-300)"}`,
                      background: reviewStatus === opt ? "var(--green-50)" : "#fff",
                      transition: "all .15s",
                    }}>
                      <input type="radio" name="status" value={opt}
                        checked={reviewStatus === opt}
                        onChange={() => setReviewStatus(opt)}
                        style={{ width: "auto", accentColor: "var(--green-800)" }}
                      />
                      <span className={`badge ${m?.cls}`} style={{ fontSize: 10 }}>{m?.label}</span>
                      <span style={{ fontSize: 12, color: "var(--gray-500)" }}>
                        {opt === "approved" && "Data is correct and verified"}
                        {opt === "rejected" && "Data is invalid — exclude from report"}
                        {opt === "flagged_suspicious" && "Needs further investigation"}
                        {opt === "pending_review" && "Return to queue"}
                      </span>
                    </label>
                  );
                })}
              </div>

              <div className="form-group">
                <label>Notes <span className="text-muted">(recorded in audit trail)</span></label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Explain your decision. This is recorded permanently in the audit trail."
                />
              </div>

              <button className="btn-primary w-full" disabled={submitting}>
                {submitting ? "Saving…" : "Save Decision"}
              </button>
            </form>

            {record.reviewed_by_username && (
              <div style={{
                marginTop: 14, padding: 12, background: "var(--gray-100)",
                borderRadius: 8, fontSize: 12,
              }}>
                <div className="flex justify-between items-center mb-1">
                  <strong>Last reviewed by {record.reviewed_by_username}</strong>
                  <span className="text-muted text-xs">{fmt(record.reviewed_at)}</span>
                </div>
                {record.review_notes && (
                  <div style={{ color: "var(--gray-700)", fontStyle: "italic" }}>"{record.review_notes}"</div>
                )}
              </div>
            )}
          </div>

          {/* Audit trail */}
          {record.audit_log && record.audit_log.length > 0 && (
            <div className="card">
              <div className="card-title mb-3">Audit Trail</div>
              <ul className="audit-timeline">
                {record.audit_log.map(entry => {
                  const a = ACTION_LABELS[entry.action] ?? { label: entry.action, color: "var(--gray-500)" };
                  return (
                    <li key={entry.id}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: a.color, marginTop: 5, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div className="flex justify-between items-start">
                          <span style={{ fontWeight: 600, fontSize: 13, color: a.color }}>{a.label}</span>
                          <span className="time">{fmt(entry.performed_at)}</span>
                        </div>
                        {entry.performed_by_username && (
                          <div className="text-sm text-muted">by {entry.performed_by_username}</div>
                        )}
                        {"status" in entry.old_values && (
                          <div className="text-xs text-muted mt-1">
                            {String(entry.old_values["status"]).replace(/_/g, " ")}
                            {" → "}
                            {String(entry.new_values["status"] ?? "").replace(/_/g, " ")}
                          </div>
                        )}
                        {entry.notes && (
                          <div style={{
                            fontSize: 12, marginTop: 4, color: "var(--gray-700)",
                            fontStyle: "italic", background: "var(--gray-100)",
                            padding: "4px 8px", borderRadius: 5,
                          }}>
                            "{entry.notes}"
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
