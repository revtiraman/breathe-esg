import { NavLink, Outlet, useNavigate } from "react-router-dom";
import api, { type User } from "../api";

interface Props { user: User; setUser: (u: User | null) => void; }

const NAV = [
  { to: "/dashboard", label: "Dashboard",    icon: "▦" },
  { to: "/ingest",    label: "Ingest Data",  icon: "↑" },
  { to: "/review",    label: "Review Queue", icon: "✓" },
];

export default function Layout({ user, setUser }: Props) {
  const navigate = useNavigate();
  const logout = async () => { await api.post("/auth/logout/"); setUser(null); navigate("/login"); };

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* Sidebar */}
      <aside style={{
        width: 230, background: "linear-gradient(180deg, #1b5e20 0%, #2e7d32 100%)",
        display: "flex", flexDirection: "column", flexShrink: 0,
        boxShadow: "2px 0 8px rgba(0,0,0,.12)",
      }}>
        {/* Logo */}
        <div style={{ padding: "24px 20px 20px", borderBottom: "1px solid rgba(255,255,255,.1)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: "rgba(255,255,255,.15)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16, color: "#a5d6a7",
            }}>
              ♻
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#fff" }}>Breathe ESG</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,.5)", marginTop: 1 }}>
                Emissions Platform
              </div>
            </div>
          </div>
          {user.organization && (
            <div style={{
              marginTop: 12, padding: "6px 10px",
              background: "rgba(255,255,255,.08)", borderRadius: 6,
              fontSize: 12, color: "rgba(255,255,255,.7)",
            }}>
              {user.organization.name}
            </div>
          )}
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: "12px 10px" }}>
          {NAV.map(({ to, label, icon }) => (
            <NavLink key={to} to={to} style={({ isActive }) => ({
              display: "flex", alignItems: "center", gap: 10,
              padding: "9px 12px", borderRadius: 8, marginBottom: 2,
              color: isActive ? "#fff" : "rgba(255,255,255,.65)",
              background: isActive ? "rgba(255,255,255,.14)" : "transparent",
              textDecoration: "none", fontSize: 13.5, fontWeight: isActive ? 600 : 400,
              transition: "all .15s",
            })}>
              <span style={{ fontSize: 14, width: 18, textAlign: "center" }}>{icon}</span>
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div style={{ padding: "14px 16px", borderTop: "1px solid rgba(255,255,255,.1)" }}>
          <div style={{ fontSize: 11.5, color: "rgba(255,255,255,.45)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{
              width: 20, height: 20, borderRadius: "50%",
              background: "rgba(255,255,255,.15)",
              display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10,
            }}>U</span>
            {user.username} · <span style={{ textTransform: "capitalize" }}>{user.role ?? "user"}</span>
          </div>
          <button onClick={logout} style={{
            width: "100%", background: "rgba(255,255,255,.08)",
            color: "rgba(255,255,255,.7)", border: "1px solid rgba(255,255,255,.15)",
            fontSize: 12.5, padding: "6px 0", borderRadius: 6,
          }}>
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, padding: "28px 32px", overflow: "auto", minWidth: 0 }}>
        <Outlet />
      </main>
    </div>
  );
}
