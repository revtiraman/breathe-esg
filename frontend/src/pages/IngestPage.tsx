import { useEffect, useRef, useState } from "react";
import api, { type DataSource, type IngestionBatch } from "../api";

export default function IngestPage() {
  const [sources, setSources] = useState<DataSource[]>([]);
  const [selectedSource, setSelectedSource] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<IngestionBatch | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // New source form
  const [showNewSource, setShowNewSource] = useState(false);
  const [newSourceType, setNewSourceType] = useState("SAP");
  const [newSourceName, setNewSourceName] = useState("");
  const [newSourceDesc, setNewSourceDesc] = useState("");
  const [creatingSource, setCreatingSource] = useState(false);

  useEffect(() => {
    api.get<{ results: DataSource[] }>("/sources/").then(r => {
      setSources(r.data.results);
      if (r.data.results.length > 0) setSelectedSource(r.data.results[0].id);
    });
  }, []);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !selectedSource) return;
    setLoading(true);
    setError("");
    setResult(null);
    const form = new FormData();
    form.append("source_id", selectedSource);
    form.append("file", file);
    try {
      const r = await api.post<IngestionBatch>("/upload/", form);
      setResult(r.data);
      if (fileRef.current) fileRef.current.value = "";
      setFile(null);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setError(axiosErr.response?.data?.detail ?? "Upload failed");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSource = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingSource(true);
    try {
      const r = await api.post<DataSource>("/sources/", {
        source_type: newSourceType,
        name: newSourceName,
        description: newSourceDesc,
      });
      setSources(prev => [...prev, r.data]);
      setSelectedSource(r.data.id);
      setShowNewSource(false);
      setNewSourceName("");
      setNewSourceDesc("");
    } finally {
      setCreatingSource(false);
    }
  };

  const selected = sources.find(s => s.id === selectedSource);

  const SOURCE_HELP: Record<string, string> = {
    SAP: "Upload a SAP MB51/ME2N semicolon-delimited CSV export. Expected columns: Werk, Materialkurztext, Buchungsdatum, Menge, Basismengeneinheit.",
    UTILITY: "Upload a utility portal CSV (PG&E / National Grid style). Expected columns: Meter Number, Billing Period Start, Billing Period End, Usage (kWh).",
    TRAVEL: "Upload a Navan or Concur trip export CSV. Expected columns: Type, Travel Date, Origin Code, Destination Code, Distance (km), Nights.",
  };

  return (
    <div>
      <div className="page-header">
        <h1>Ingest Data</h1>
        <p>Upload CSV exports from SAP, utility portals, or corporate travel platforms</p>
      </div>

      <div className="two-col">
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ marginBottom: 16, fontSize: 15, fontWeight: 600 }}>Upload File</h3>

            {error && <div className="alert alert-error">{error}</div>}

            <form onSubmit={handleUpload}>
              <div className="form-group">
                <label>Data Source</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <select value={selectedSource} onChange={e => setSelectedSource(e.target.value)} style={{ flex: 1 }}>
                    {sources.map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.source_type})</option>
                    ))}
                  </select>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => setShowNewSource(!showNewSource)}>
                    + New
                  </button>
                </div>
              </div>

              {selected && (
                <div className="alert alert-warning" style={{ fontSize: 12 }}>
                  <strong>{selected.source_type} format:</strong> {SOURCE_HELP[selected.source_type]}
                </div>
              )}

              <div className="form-group">
                <label>CSV File</label>
                <input
                  type="file"
                  accept=".csv,.txt"
                  ref={fileRef}
                  onChange={e => setFile(e.target.files?.[0] ?? null)}
                  required
                />
              </div>

              <button className="btn-primary" disabled={loading || !file || !selectedSource} style={{ width: "100%" }}>
                {loading ? "Processing…" : "Upload & Ingest"}
              </button>
            </form>
          </div>

          {showNewSource && (
            <div className="card">
              <h3 style={{ marginBottom: 16, fontSize: 15, fontWeight: 600 }}>New Data Source</h3>
              <form onSubmit={handleCreateSource}>
                <div className="form-group">
                  <label>Type</label>
                  <select value={newSourceType} onChange={e => setNewSourceType(e.target.value)}>
                    <option value="SAP">SAP (Fuel & Procurement)</option>
                    <option value="UTILITY">Utility Portal (Electricity)</option>
                    <option value="TRAVEL">Corporate Travel (Concur/Navan)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Name</label>
                  <input value={newSourceName} onChange={e => setNewSourceName(e.target.value)} placeholder="e.g. SAP Production Export" required />
                </div>
                <div className="form-group">
                  <label>Description (optional)</label>
                  <textarea value={newSourceDesc} onChange={e => setNewSourceDesc(e.target.value)} rows={2} />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn-primary" disabled={creatingSource}>{creatingSource ? "Creating…" : "Create"}</button>
                  <button type="button" className="btn-secondary" onClick={() => setShowNewSource(false)}>Cancel</button>
                </div>
              </form>
            </div>
          )}
        </div>

        <div>
          {result ? (
            <div className="card">
              <h3 style={{ marginBottom: 16, fontSize: 15, fontWeight: 600 }}>
                Ingestion Result
                <span className={`badge badge-${result.status === "completed" ? "approved" : "warning"}`} style={{ marginLeft: 8 }}>
                  {result.status.replace(/_/g, " ")}
                </span>
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                {[
                  { label: "Total Rows", value: result.row_count },
                  { label: "Accepted", value: result.accepted_count, color: "var(--green)" },
                  { label: "Rejected", value: result.rejected_count, color: result.rejected_count > 0 ? "var(--red)" : undefined },
                  { label: "Warnings", value: result.warning_count, color: result.warning_count > 0 ? "var(--orange)" : undefined },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ background: "var(--gray-light)", padding: "12px", borderRadius: 6, textAlign: "center" }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{label}</div>
                  </div>
                ))}
              </div>
              {result.issues.length > 0 && (
                <div>
                  <h4 style={{ marginBottom: 8, fontSize: 13 }}>Issues</h4>
                  <div style={{ maxHeight: 200, overflow: "auto" }}>
                    {result.issues.map(issue => (
                      <div key={issue.id} className={`alert alert-${issue.severity}`} style={{ marginBottom: 6, fontSize: 12 }}>
                        <strong>{issue.code}</strong> (row {issue.source_row_number}): {issue.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="card">
              <h3 style={{ marginBottom: 12, fontSize: 15, fontWeight: 600 }}>Configured Sources</h3>
              {sources.map(s => (
                <div key={s.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong style={{ fontSize: 13 }}>{s.name}</strong>
                    <span className={`badge badge-${s.source_type.toLowerCase()}`}>{s.source_type}</span>
                  </div>
                  {s.description && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{s.description}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
