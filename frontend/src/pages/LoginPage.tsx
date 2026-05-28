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
      justifyContent: "center", background: "var(--gray-light)",
    }}>
      <div style={{ width: 360 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: "var(--green)" }}>Breathe ESG</div>
          <div style={{ color: "var(--text-muted)", marginTop: 4 }}>Emissions Data Review Platform</div>
        </div>

        <div className="card">
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
            <button className="btn-primary" style={{ width: "100%", marginTop: 4 }} disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div style={{ marginTop: 16, padding: 12, background: "var(--gray-light)", borderRadius: 6, fontSize: 12, color: "var(--text-muted)" }}>
            Demo credentials: <strong>admin</strong> / <strong>demo1234</strong> or <strong>analyst</strong> / <strong>demo1234</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
