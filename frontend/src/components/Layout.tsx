import { NavLink, Outlet, useNavigate } from "react-router-dom";
import api, { type User } from "../api";

interface Props {
  user: User;
  setUser: (u: User | null) => void;
}

export default function Layout({ user, setUser }: Props) {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await api.post("/auth/logout/");
    setUser(null);
    navigate("/login");
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <nav style={{
        width: 220, background: "#1b5e20", color: "white",
        display: "flex", flexDirection: "column", padding: "0",
        flexShrink: 0,
      }}>
        <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
          <div style={{ fontWeight: 700, fontSize: 18, color: "#a5d6a7" }}>Breathe ESG</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: 2 }}>
            {user.organization?.name}
          </div>
        </div>

        <div style={{ flex: 1, padding: "12px 0" }}>
          {[
            { to: "/dashboard", label: "Dashboard", icon: "▦" },
            { to: "/ingest", label: "Ingest Data", icon: "↑" },
            { to: "/review", label: "Review", icon: "✓" },
          ].map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              style={({ isActive }) => ({
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 20px",
                color: isActive ? "white" : "rgba(255,255,255,0.7)",
                background: isActive ? "rgba(255,255,255,0.12)" : "transparent",
                textDecoration: "none",
                fontSize: 14,
                fontWeight: isActive ? 600 : 400,
                borderLeft: isActive ? "3px solid #a5d6a7" : "3px solid transparent",
              })}
            >
              <span>{icon}</span>
              <span>{label}</span>
            </NavLink>
          ))}
        </div>

        <div style={{ padding: "16px 20px", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 8 }}>
            {user.username} · {user.role}
          </div>
          <button
            onClick={handleLogout}
            style={{
              background: "rgba(255,255,255,0.1)", color: "white",
              border: "1px solid rgba(255,255,255,0.2)", width: "100%",
              padding: "7px", fontSize: 13,
            }}
          >
            Log out
          </button>
        </div>
      </nav>

      <main style={{ flex: 1, padding: "28px 32px", overflow: "auto" }}>
        <Outlet />
      </main>
    </div>
  );
}
