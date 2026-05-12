import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { api } from "../api";
import type { User } from "../types";

export default function LoginPage() {
    const [email, setEmail] = useState("alice.anderson@company.com");
    const [error, setError] = useState<string | null>(null);
    const [demoUsers, setDemoUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(false);
    const { login } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        api.allUsers().then(setDemoUsers).catch(() => setDemoUsers([]));
    }, []);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            await login(email.trim());
            navigate("/");
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-shell">
            <div className="login-card">
                <div className="login-brand">
                    <span className="brand-mark large">D</span>
                    <h1>IntelliDesk</h1>
                </div>
                <p className="login-sub">Book a desk. Trade with teammates. Find your spot.</p>
                <form onSubmit={submit} className="login-form">
                    <label>
                        Work email
                        <input
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            placeholder="you@company.com"
                            required
                        />
                    </label>
                    <button type="submit" className="primary-btn" disabled={loading}>
                        {loading ? "Signing in…" : "Sign in"}
                    </button>
                    {error && <div className="error-text">{error}</div>}
                </form>
                {demoUsers.length > 0 && (
                    <div className="demo-users">
                        <div className="hint">Demo accounts — pick a role to sign in as:</div>
                        <div className="chip-row">
                            {(() => {
                                const admin = demoUsers.find(u => u.role === "Admin");
                                const managers = demoUsers.filter(u => u.role === "TeamManager").slice(0, 4);
                                const members = demoUsers
                                    .filter(u => u.role === "Member")
                                    .filter((u, i, arr) => arr.findIndex(x => x.teamName === u.teamName) === i)
                                    .slice(0, 3);
                                const picks = [admin, ...managers, ...members].filter(Boolean) as User[];
                                return picks.map(u => (
                                    <button
                                        key={u.id}
                                        type="button"
                                        className="chip"
                                        style={{ background: u.teamColor ?? undefined, color: "#fff" }}
                                        onClick={() => setEmail(u.email)}
                                        title={u.email}
                                    >
                                        {u.role !== "Member" && (
                                            <span style={{ opacity: 0.85, marginRight: 6 }}>
                                                {u.role === "Admin" ? "★ Admin" : "✦ Manager"}
                                            </span>
                                        )}
                                        {u.name} · {u.teamName}
                                    </button>
                                ));
                            })()}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
