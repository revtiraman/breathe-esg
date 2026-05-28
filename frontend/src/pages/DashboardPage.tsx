import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { type DashboardStats } from "../api";

const fmtNum = (n: number, dp = 0) => n.toLocaleString("en", { maximumFractionDigits: dp });
const fmtTCO2e = (kg: number) => kg >= 1000
  ? `${fmtNum(kg / 1000, 2)} tCO₂e`
  : `${fmtNum(kg, 1)} kgCO₂e`;
const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

function BatchStatus({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: "badge-approved", completed_with_errors: "badge-warning",
    processing: "badge-info", failed: "badge-rejected",
  };
  return <span className={`badge ${map[status] ?? "badge-info"}`}>{status.replace(/_/g, " ")}</span>;
}

// SVG donut chart — pure, no deps
function Donut({ data, size = 120, thickness = 20 }: {
  data: { value: number; color: string; label: string }[];
  size?: number; thickness?: number;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return (
    <svg width={size} height={size}>
      <circle cx={size/2} cy={size/2} r={(size-thickness)/2}
        fill="none" stroke="#e0e0e0" strokeWidth={thickness} />
      <text x={size/2} y={size/2+4} textAnchor="middle" fontSize={11} fill="#9e9e9e">No data</text>
    </svg>
  );
  const r = (size - thickness) / 2;
  const circ = 2 * Math.PI * r;
  let cumulative = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {data.map((d, i) => {
        const dash = (d.value / total) * circ;
        const dashOffset = circ / 4 - cumulative;
        cumulative += dash;
        return (
          <circle key={i} cx={size/2} cy={size/2} r={r}
            fill="none" stroke={d.color} strokeWidth={thickness}
            strokeDasharray={`${dash} ${circ - dash}`}
            strokeDashoffset={dashOffset}
          >
            <title>{d.label}: {fmtNum(d.value)} ({Math.round(d.value/total*100)}%)</title>
          </circle>
        );
      })}
    </svg>
  );
}

function BarChart({ data, max }: { data: { label: string; value: number; co2e: number; color: string }[]; max: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {data.map(d => (
        <div key={d.label}>
          <div className="flex justify-between items-center mb-1">
            <span className="text-sm font-semibold" style={{ color: d.color }}>{d.label}</span>
            <span className="text-xs text-muted">{fmtNum(d.value)} records · {fmtTCO2e(d.co2e)}</span>
          </div>
          <div className="progress-bar">
            <div className="progress-bar-fill" style={{ width: `${max ? (d.value/max)*100 : 0}%`, background: d.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<DashboardStats>("/dashboard/")
      .then(r => setStats(r.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner" />
      <span>Loading dashboard…</span>
    </div>
  );
  if (!stats) return <div className="alert alert-error">Failed to load dashboard</div>;

  const reviewed = stats.approved + stats.rejected + stats.flagged;
  const pctReviewed = stats.total_records ? Math.round((reviewed / stats.total_records) * 100) : 0;

  const scopeData = [
    { value: stats.scope_breakdown.scope_1 ?? 0, color: "#e91e63", label: "Scope 1" },
    { value: stats.scope_breakdown.scope_2 ?? 0, color: "#1565c0", label: "Scope 2" },
    { value: stats.scope_breakdown.scope_3 ?? 0, color: "#6a1b9a", label: "Scope 3" },
  ];
  const statusData = [
    { value: stats.pending_review, color: "#e65100", label: "Pending" },
    { value: stats.approved, color: "#2e7d32", label: "Approved" },
    { value: stats.flagged, color: "#1565c0", label: "Flagged" },
    { value: stats.rejected, color: "#c62828", label: "Rejected" },
  ];

  const sourceBarData = [
    { label: "SAP (Fuel)", value: stats.source_breakdown.SAP ?? 0, co2e: stats.source_co2e?.SAP ?? 0, color: "#2e7d32" },
    { label: "Utility (Electricity)", value: stats.source_breakdown.UTILITY ?? 0, co2e: stats.source_co2e?.UTILITY ?? 0, color: "#f57f17" },
    { label: "Travel", value: stats.source_breakdown.TRAVEL ?? 0, co2e: stats.source_co2e?.TRAVEL ?? 0, color: "#283593" },
  ];
  const sourceMax = Math.max(...sourceBarData.map(d => d.value), 1);

  return (
    <div>
      {/* Header */}
      <div className="page-header flex justify-between items-center">
        <div>
          <h1>Emissions Dashboard</h1>
          <p>Q1 2024 activity data — Acme Corp · GHG Protocol aligned</p>
        </div>
        <div className="flex gap-2">
          <a href="/api/records/export/?status=approved" download>
            <button className="btn-secondary">
              ↓ Export Approved CSV
            </button>
          </a>
          <Link to="/review?status=pending_review">
            <button className="btn-primary">
              Review pending ({stats.pending_review})
            </button>
          </Link>
        </div>
      </div>

      {/* CO2e hero strip */}
      <div style={{
        background: "linear-gradient(135deg, #1b5e20 0%, #2e7d32 60%, #388e3c 100%)",
        borderRadius: 12, padding: "20px 28px", marginBottom: 20,
        display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr",
        gap: 0, color: "#fff", boxShadow: "0 4px 12px rgba(27,94,32,.3)",
      }}>
        {[
          { label: "Total Estimated Emissions", value: fmtTCO2e(stats.total_co2e_kg), sub: "All records (DEFRA 2023 EFs)" },
          { label: "Scope 1 — Direct", value: fmtTCO2e(stats.scope_co2e?.scope_1 ?? 0), sub: "Fuel combustion" },
          { label: "Scope 2 — Electricity", value: fmtTCO2e(stats.scope_co2e?.scope_2 ?? 0), sub: "DE grid avg 0.434 kgCO₂e/kWh" },
          { label: "Scope 3 — Travel", value: fmtTCO2e(stats.scope_co2e?.scope_3 ?? 0), sub: "Flights, hotels, ground" },
        ].map((item, i) => (
          <div key={i} style={{
            padding: "0 24px", borderLeft: i > 0 ? "1px solid rgba(255,255,255,.15)" : "none",
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px", color: "rgba(255,255,255,.6)", marginBottom: 6 }}>
              {item.label}
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.5px" }}>{item.value}</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,.55)", marginTop: 3 }}>{item.sub}</div>
          </div>
        ))}
      </div>

      {/* Stats row */}
      <div className="stats-grid" style={{ gridTemplateColumns: "repeat(5,1fr)" }}>
        <div className="stat-card">
          <div className="number">{fmtNum(stats.total_records)}</div>
          <div className="label">Total Records</div>
        </div>
        <div className="stat-card">
          <div className="number orange">{fmtNum(stats.pending_review)}</div>
          <div className="label">Pending Review</div>
          <div className="sublabel">{pctReviewed}% complete</div>
        </div>
        <div className="stat-card">
          <div className="number green">{fmtNum(stats.approved)}</div>
          <div className="label">Approved</div>
          <div className="sublabel">{fmtTCO2e(stats.approved_co2e_kg)} locked</div>
        </div>
        <div className="stat-card flagged">
          <div className="number blue">{fmtNum(stats.flagged)}</div>
          <div className="label">Flagged</div>
          <div className="sublabel">Needs investigation</div>
        </div>
        <div className="stat-card rejected">
          <div className="number red">{fmtNum(stats.rejected)}</div>
          <div className="label">Rejected</div>
          <div className="sublabel">Data quality issue</div>
        </div>
      </div>

      {/* Review progress bar */}
      <div className="card mb-4" style={{ marginBottom: 16 }}>
        <div className="flex justify-between items-center mb-2">
          <span className="card-title">Review Progress</span>
          <span className="text-sm text-muted">{reviewed} of {stats.total_records} reviewed</span>
        </div>
        <div style={{ height: 10, background: "var(--gray-300)", borderRadius: 5, overflow: "hidden", display: "flex" }}>
          {[
            { pct: stats.approved / stats.total_records, color: "var(--green-600)" },
            { pct: stats.flagged / stats.total_records, color: "var(--blue-700)" },
            { pct: stats.rejected / stats.total_records, color: "var(--red)" },
          ].map((s, i) => (
            <div key={i} style={{ width: `${s.pct * 100}%`, background: s.color, transition: "width .6s ease" }} />
          ))}
        </div>
        <div className="flex gap-4 mt-2" style={{ fontSize: 11, color: "var(--gray-500)" }}>
          {[
            { color: "var(--green-600)", label: `Approved (${stats.approved})` },
            { color: "var(--blue-700)", label: `Flagged (${stats.flagged})` },
            { color: "var(--red)", label: `Rejected (${stats.rejected})` },
            { color: "var(--gray-300)", label: `Pending (${stats.pending_review})` },
          ].map(l => (
            <span key={l.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: l.color, display: "inline-block" }} />
              {l.label}
            </span>
          ))}
        </div>
      </div>

      {/* Charts + source bar */}
      <div className="two-col" style={{ marginBottom: 16 }}>
        {/* Scope donut */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Emissions by Scope</div>
              <div className="card-subtitle">GHG Protocol classification</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div style={{ position: "relative", flexShrink: 0 }}>
              <Donut data={scopeData} size={120} thickness={22} />
              <div style={{
                position: "absolute", inset: 0, display: "flex",
                flexDirection: "column", alignItems: "center", justifyContent: "center",
              }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: "var(--gray-900)" }}>{fmtNum(stats.total_records)}</div>
                <div style={{ fontSize: 10, color: "var(--gray-500)" }}>records</div>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              {[
                { label: "Scope 1 — Direct", key: "scope_1", color: "#e91e63", badge: "badge-scope1" },
                { label: "Scope 2 — Electricity", key: "scope_2", color: "#1565c0", badge: "badge-scope2" },
                { label: "Scope 3 — Travel", key: "scope_3", color: "#6a1b9a", badge: "badge-scope3" },
              ].map(s => (
                <div key={s.key} style={{ marginBottom: 10 }}>
                  <div className="flex justify-between items-center" style={{ marginBottom: 3 }}>
                    <span className={`badge ${s.badge}`} style={{ fontSize: 10 }}>{s.label}</span>
                    <span className="text-xs text-muted">{fmtNum(stats.scope_breakdown[s.key] ?? 0)}</span>
                  </div>
                  <div style={{ height: 5, background: "var(--gray-300)", borderRadius: 3 }}>
                    <div style={{
                      height: "100%", borderRadius: 3, background: s.color,
                      width: `${stats.total_records ? ((stats.scope_breakdown[s.key] ?? 0) / stats.total_records) * 100 : 0}%`,
                      transition: "width .6s ease",
                    }} />
                  </div>
                  <div className="text-xs text-muted mt-1">{fmtTCO2e(stats.scope_co2e?.[s.key] ?? 0)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Status donut */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Review Status</div>
              <div className="card-subtitle">Analyst workflow progress</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div style={{ position: "relative", flexShrink: 0 }}>
              <Donut data={statusData} size={120} thickness={22} />
              <div style={{
                position: "absolute", inset: 0, display: "flex",
                flexDirection: "column", alignItems: "center", justifyContent: "center",
              }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: "var(--green-800)" }}>{pctReviewed}%</div>
                <div style={{ fontSize: 10, color: "var(--gray-500)" }}>reviewed</div>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              {[
                { label: "Pending", val: stats.pending_review, color: "#e65100", badge: "badge-pending" },
                { label: "Approved", val: stats.approved, color: "#2e7d32", badge: "badge-approved" },
                { label: "Flagged", val: stats.flagged, color: "#1565c0", badge: "badge-flagged" },
                { label: "Rejected", val: stats.rejected, color: "#c62828", badge: "badge-rejected" },
              ].map(s => (
                <div key={s.label} className="flex justify-between items-center" style={{ marginBottom: 8 }}>
                  <span className={`badge ${s.badge}`} style={{ fontSize: 10 }}>{s.label}</span>
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: 14, fontWeight: 700, color: s.color }}>{s.val}</span>
                    <span className="text-xs text-muted">
                      {stats.total_records ? Math.round((s.val / stats.total_records) * 100) : 0}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Source breakdown */}
      <div className="two-col" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-header">
            <div className="card-title">By Data Source</div>
          </div>
          <BarChart data={sourceBarData} max={sourceMax} />
        </div>

        {/* Emission factor info card */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Emission Factor Reference</div>
              <div className="card-subtitle">DEFRA/BEIS 2023 — for analyst guidance only</div>
            </div>
          </div>
          <div style={{ fontSize: 12 }}>
            {[
              { cat: "Diesel", ef: "2.510 kgCO₂e/L", scope: 1 },
              { cat: "Natural Gas", ef: "0.183 kgCO₂e/kWh", scope: 1 },
              { cat: "Petrol", ef: "2.154 kgCO₂e/L", scope: 1 },
              { cat: "Electricity (DE)", ef: "0.434 kgCO₂e/kWh", scope: 2 },
              { cat: "Long-haul flight", ef: "0.196 kgCO₂e/km", scope: 3 },
              { cat: "Hotel stay", ef: "28.4 kgCO₂e/night", scope: 3 },
            ].map(row => (
              <div key={row.cat} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "6px 0", borderBottom: "1px solid var(--gray-300)",
              }}>
                <div className="flex items-center gap-2">
                  <span className={`badge badge-scope${row.scope}`} style={{ fontSize: 9, padding: "1px 5px" }}>S{row.scope}</span>
                  <span style={{ color: "var(--gray-700)" }}>{row.cat}</span>
                </div>
                <span className="ef-pill">{row.ef}</span>
              </div>
            ))}
            <div style={{ marginTop: 10, fontSize: 11, color: "var(--gray-500)", lineHeight: 1.5 }}>
              CO₂e values are approximate. Validate against client-specific grid mix
              and fuel certificates before audit submission.
            </div>
          </div>
        </div>
      </div>

      {/* Recent batches */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Recent Ingestion Batches</div>
          <Link to="/ingest"><button className="btn-secondary btn-sm">+ Upload file</button></Link>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>File</th><th>Source</th><th>Uploaded</th>
                <th>Status</th><th>Accepted</th><th>Errors</th><th>Warnings</th>
              </tr>
            </thead>
            <tbody>
              {stats.recent_batches.map(b => (
                <tr key={b.id}>
                  <td className="truncate" style={{ maxWidth: 200 }}>
                    <span title={b.original_filename} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
                      {b.original_filename}
                    </span>
                  </td>
                  <td><span className={`badge badge-${b.source_type.toLowerCase()}`}>{b.source_type}</span></td>
                  <td className="text-muted text-sm">{fmtDate(b.uploaded_at)}</td>
                  <td><BatchStatus status={b.status} /></td>
                  <td><span style={{ fontWeight: 600 }}>{b.accepted_count}</span></td>
                  <td style={{ color: b.rejected_count > 0 ? "var(--red)" : "var(--gray-500)", fontWeight: b.rejected_count > 0 ? 600 : 400 }}>
                    {b.rejected_count}
                  </td>
                  <td style={{ color: b.warning_count > 0 ? "var(--amber)" : "var(--gray-500)", fontWeight: b.warning_count > 0 ? 600 : 400 }}>
                    {b.warning_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
