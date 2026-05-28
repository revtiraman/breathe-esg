import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { type User } from "../api";

interface Props {
  setUser: (u: User) => void;
}

export default function LoginPage({ setUser }: Props) {
  const navigate = useNavigate();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("demo1234");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const r = await api.post<User>("/auth/login/", { username, password });
      setUser(r.data);
      navigate("/dashboard");
    } catch {
      setError("Invalid username or password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center",
      background: "linear-gradient(135deg, var(--green-900) 0%, var(--green-800) 60%, var(--green-600) 100%)",
    }}>
      <div style={{ width: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14,
            background: "rgba(255,255,255,.15)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 24, margin: "0 auto 14px",
          }}>
            🌿
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#fff", letterSpacing: "-.3px" }}>
            Breathe ESG
          </div>
          <div style={{ color: "rgba(255,255,255,.7)", marginTop: 5, fontSize: 13 }}>
            Emissions Data Review Platform
          </div>
        </div>

        <div className="card" style={{ boxShadow: "0 20px 40px rgba(0,0,0,.25)" }}>
          <h2 style={{ marginBottom: 20, fontSize: 18, fontWeight: 600 }}>Sign in</h2>

          {error && <div className="alert alert-error">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Username</label>
              <input value={username} onChange={e => setUsername(e.target.value)} required autoFocus />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            <button className="btn-primary w-full" style={{ marginTop: 4 }} disabled={loading}>
              {loading ? "Signing in…" : "Sign in →"}
            </button>
          </form>

          <div style={{
            marginTop: 16, padding: 12,
            background: "var(--gray-50)", border: "1px solid var(--gray-300)",
            borderRadius: 8, fontSize: 12, color: "var(--gray-500)",
          }}>
            <strong style={{ color: "var(--gray-700)" }}>Demo credentials</strong>
            <div style={{ marginTop: 4, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <span><strong>admin</strong> / demo1234 <span style={{ fontSize: 10, color: "var(--green-800)", background: "var(--green-100)", padding: "1px 5px", borderRadius: 3 }}>admin</span></span>
              <span><strong>analyst</strong> / demo1234 <span style={{ fontSize: 10, color: "var(--blue-700)", background: "var(--blue-100)", padding: "1px 5px", borderRadius: 3 }}>analyst</span></span>
            </div>
          </div>
        </div>

        <div style={{ textAlign: "center", marginTop: 20, fontSize: 11, color: "rgba(255,255,255,.4)" }}>
          GHG Protocol · DEFRA 2023 Emission Factors · ISO 14064
        </div>
      </div>
    </div>
  );
}
