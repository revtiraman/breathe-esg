import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import api, { type DataSource, type IngestionBatch } from "../api";

const SOURCE_HELP: Record<string, { cols: string; note: string }> = {
  SAP: {
    cols: "Werk · Materialkurztext · Buchungsdatum · Menge · Basismengeneinheit",
    note: "Semicolon-delimited MB51/ME2N export. Supports DD.MM.YYYY dates and German decimal format.",
  },
  UTILITY: {
    cols: "Meter Number · Billing Period Start · Billing Period End · Usage (kWh)",
    note: "PG&E / National Grid / ComEd portal export. Billing periods need not align with calendar months.",
  },
  TRAVEL: {
    cols: "Type · Travel Date · Origin Code · Destination Code · Distance (km) · Nights",
    note: "Navan / Concur CSV export. Flight distances computed via Haversine if not supplied.",
  },
};

function SourceCard({ source, selected, onSelect }: { source: DataSource; selected: boolean; onSelect: () => void }) {
  const colors: Record<string, string> = { SAP: "var(--orange)", UTILITY: "var(--blue-700)", TRAVEL: "var(--purple-700)" };
  return (
    <div
      onClick={onSelect}
      style={{
        padding: "14px 16px", borderRadius: 10, cursor: "pointer", marginBottom: 8,
        border: `2px solid ${selected ? "var(--green-600)" : "var(--gray-300)"}`,
        background: selected ? "var(--green-50)" : "#fff",
        transition: "all .15s",
      }}
    >
      <div className="flex justify-between items-center">
        <strong style={{ fontSize: 13 }}>{source.name}</strong>
        <span className={`badge badge-${source.source_type.toLowerCase()}`} style={{ fontSize: 10 }}>
          {source.source_type}
        </span>
      </div>
      {source.description && (
        <div style={{ fontSize: 11, color: "var(--gray-500)", marginTop: 4 }}>{source.description}</div>
      )}
      {selected && SOURCE_HELP[source.source_type] && (
        <div style={{ marginTop: 10, padding: "8px 10px", background: "var(--gray-100)", borderRadius: 6, fontSize: 11 }}>
          <div style={{ color: colors[source.source_type], fontWeight: 600, marginBottom: 3 }}>Expected columns</div>
          <div style={{ fontFamily: "ui-monospace,monospace", color: "var(--gray-700)", marginBottom: 4 }}>
            {SOURCE_HELP[source.source_type].cols}
          </div>
          <div style={{ color: "var(--gray-500)" }}>{SOURCE_HELP[source.source_type].note}</div>
        </div>
      )}
    </div>
  );
}

function DropZone({ file, onFile }: { file: File | null; onFile: (f: File) => void }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  };

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      style={{
        border: `2px dashed ${dragging ? "var(--green-600)" : file ? "var(--green-400)" : "var(--gray-300)"}`,
        background: dragging ? "var(--green-50)" : file ? "var(--green-50)" : "var(--gray-50)",
        borderRadius: 12, padding: "32px 20px", textAlign: "center",
        cursor: "pointer", transition: "all .2s",
      }}
    >
      <input ref={inputRef} type="file" accept=".csv,.txt" style={{ display: "none" }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      {file ? (
        <>
          <div style={{ fontSize: 28, marginBottom: 6 }}>📄</div>
          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--green-800)" }}>{file.name}</div>
          <div style={{ fontSize: 11, color: "var(--gray-500)", marginTop: 3 }}>
            {(file.size / 1024).toFixed(1)} KB — click to replace
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 28, marginBottom: 8 }}>⬆</div>
          <div style={{ fontWeight: 600, fontSize: 14, color: "var(--gray-700)" }}>Drop CSV here or click to browse</div>
          <div style={{ fontSize: 11, color: "var(--gray-500)", marginTop: 4 }}>Accepts .csv and .txt files</div>
        </>
      )}
    </div>
  );
}

function ResultCard({ batch, onReset }: { batch: IngestionBatch; onReset: () => void }) {
  const ok = batch.status === "completed";
  const hasIssues = batch.issues.length > 0;

  return (
    <div className="card">
      <div className="flex justify-between items-center mb-3">
        <div style={{ fontWeight: 700, fontSize: 15 }}>Ingestion Complete</div>
        <span className={`badge ${ok ? "badge-approved" : "badge-warning"}`}>
          {batch.status.replace(/_/g, " ")}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
        {[
          { label: "Total Rows", value: batch.row_count, color: "var(--gray-700)" },
          { label: "Accepted", value: batch.accepted_count, color: "var(--green-800)" },
          { label: "Rejected", value: batch.rejected_count, color: batch.rejected_count > 0 ? "var(--red)" : "var(--gray-500)" },
          { label: "Warnings", value: batch.warning_count, color: batch.warning_count > 0 ? "var(--amber)" : "var(--gray-500)" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{
            background: "var(--gray-100)", padding: "14px 16px", borderRadius: 8, textAlign: "center",
          }}>
            <div style={{ fontSize: 26, fontWeight: 800, color }}>{value}</div>
            <div style={{ fontSize: 11, color: "var(--gray-500)", fontWeight: 500 }}>{label}</div>
          </div>
        ))}
      </div>

      {hasIssues && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "var(--gray-700)" }}>
            Validation Issues ({batch.issues.length})
          </div>
          <div style={{ maxHeight: 180, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
            {batch.issues.map(issue => (
              <div key={issue.id} className={`alert alert-${issue.severity}`} style={{ marginBottom: 0, fontSize: 11 }}>
                <strong>{issue.code}</strong>
                {issue.source_row_number && <span style={{ marginLeft: 4 }}>(row {issue.source_row_number})</span>}
                : {issue.message}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Link to="/review?status=pending_review" style={{ flex: 1 }}>
          <button className="btn-primary w-full">Go to Review Queue →</button>
        </Link>
        <button className="btn-secondary" onClick={onReset}>Upload Another</button>
      </div>
    </div>
  );
}

export default function IngestPage() {
  const [sources, setSources] = useState<DataSource[]>([]);
  const [selectedSource, setSelectedSource] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<IngestionBatch | null>(null);
  const [error, setError] = useState("");

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
    setLoading(true); setError(""); setResult(null);
    const form = new FormData();
    form.append("source_id", selectedSource);
    form.append("file", file);
    try {
      const r = await api.post<IngestionBatch>("/upload/", form);
      setResult(r.data);
      setFile(null);
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { detail?: string } } };
      setError(ax.response?.data?.detail ?? "Upload failed. Check the file format and try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSource = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingSource(true);
    try {
      const r = await api.post<DataSource>("/sources/", {
        source_type: newSourceType, name: newSourceName, description: newSourceDesc,
      });
      setSources(prev => [...prev, r.data]);
      setSelectedSource(r.data.id);
      setShowNewSource(false);
      setNewSourceName(""); setNewSourceDesc("");
    } finally {
      setCreatingSource(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Ingest Data</h1>
          <p>Upload CSV exports from SAP, utility portals, or corporate travel platforms for GHG Protocol classification</p>
        </div>
      </div>

      <div className="two-col">
        {/* Left — source selection + upload */}
        <div>
          {result ? (
            <ResultCard batch={result} onReset={() => setResult(null)} />
          ) : (
            <div className="card">
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>1 · Select data source</div>

              {sources.map(s => (
                <SourceCard key={s.id} source={s} selected={s.id === selectedSource} onSelect={() => setSelectedSource(s.id)} />
              ))}

              <button
                type="button"
                className="btn-ghost btn-sm"
                style={{ marginTop: 4, width: "100%" }}
                onClick={() => setShowNewSource(!showNewSource)}
              >
                {showNewSource ? "— Cancel" : "+ Add new data source"}
              </button>

              {showNewSource && (
                <form onSubmit={handleCreateSource} style={{ marginTop: 12, padding: 14, background: "var(--gray-50)", borderRadius: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>New Data Source</div>
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
                    <input value={newSourceName} onChange={e => setNewSourceName(e.target.value)}
                      placeholder="e.g. SAP Production Q1 2024" required />
                  </div>
                  <div className="form-group">
                    <label>Description <span className="text-muted">(optional)</span></label>
                    <textarea value={newSourceDesc} onChange={e => setNewSourceDesc(e.target.value)} rows={2} />
                  </div>
                  <div className="flex gap-2">
                    <button className="btn-primary btn-sm" disabled={creatingSource}>
                      {creatingSource ? "Creating…" : "Create Source"}
                    </button>
                    <button type="button" className="btn-secondary btn-sm" onClick={() => setShowNewSource(false)}>Cancel</button>
                  </div>
                </form>
              )}

              <div style={{ borderTop: "1px solid var(--gray-300)", margin: "20px 0" }} />

              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>2 · Drop your CSV file</div>

              {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}

              <form onSubmit={handleUpload}>
                <DropZone file={file} onFile={setFile} />

                <button
                  className="btn-primary w-full"
                  disabled={loading || !file || !selectedSource}
                  style={{ marginTop: 14 }}
                >
                  {loading ? (
                    <span className="flex items-center gap-2" style={{ justifyContent: "center" }}>
                      <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                      Processing…
                    </span>
                  ) : "Upload & Ingest →"}
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Right — configured sources + format guide */}
        <div>
          <div className="card mb-4">
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Configured Sources</div>
            {sources.length === 0 ? (
              <div className="text-muted text-sm">No sources yet — create one on the left.</div>
            ) : sources.map(s => (
              <div key={s.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--gray-300)" }}>
                <div className="flex justify-between items-center">
                  <strong style={{ fontSize: 13 }}>{s.name}</strong>
                  <span className={`badge badge-${s.source_type.toLowerCase()}`} style={{ fontSize: 10 }}>{s.source_type}</span>
                </div>
                {s.description && <div style={{ fontSize: 11, color: "var(--gray-500)", marginTop: 3 }}>{s.description}</div>}
              </div>
            ))}
          </div>

          <div className="card">
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Format Reference</div>
            {Object.entries(SOURCE_HELP).map(([type, info]) => (
              <div key={type} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid var(--gray-100)" }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`badge badge-${type.toLowerCase()}`} style={{ fontSize: 10 }}>{type}</span>
                </div>
                <div style={{ fontSize: 11, fontFamily: "ui-monospace,monospace", color: "var(--gray-700)", marginBottom: 4 }}>
                  {info.cols}
                </div>
                <div style={{ fontSize: 11, color: "var(--gray-500)" }}>{info.note}</div>
              </div>
            ))}
            <div className="alert alert-warning" style={{ fontSize: 11, marginBottom: 0 }}>
              Duplicate files are detected via SHA-256 hash — re-uploading the same file will be rejected.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
