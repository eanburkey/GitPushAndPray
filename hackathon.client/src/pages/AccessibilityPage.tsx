import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import MultiNeedPicker from "../components/MultiNeedPicker";
import { ACCESSIBILITY_LABELS } from "../components/AccessibilityIcon";
import type { AccessibilityType, AdminUser } from "../types";

export default function AccessibilityPage() {
    const { user } = useAuth();
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [filter, setFilter] = useState<"all" | "with-need">("all");
    const [search, setSearch] = useState("");
    const [savingId, setSavingId] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = async () => {
        if (!user) return;
        try {
            setUsers(await api.managerListUsers(user.id));
        } catch (e) {
            setError((e as Error).message);
        }
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return users.filter(u => {
            if (filter === "with-need" && u.accessibilityNeeds.length === 0) return false;
            if (!q) return true;
            return u.name.toLowerCase().includes(q)
                || u.email.toLowerCase().includes(q)
                || (u.teamName ?? "").toLowerCase().includes(q);
        });
    }, [users, filter, search]);

    const setNeeds = async (target: AdminUser, next: AccessibilityType[]) => {
        if (!user) return;
        // Optimistic: reflect immediately, roll back if the server rejects.
        const previous = target.accessibilityNeeds;
        setUsers(prev => prev.map(u => u.id === target.id ? { ...u, accessibilityNeeds: next } : u));
        setSavingId(target.id);
        setError(null);
        try {
            await api.setAccessibilityNeeds(user.id, target.id, next);
        } catch (e) {
            setError((e as Error).message);
            setUsers(prev => prev.map(u => u.id === target.id ? { ...u, accessibilityNeeds: previous } : u));
        } finally {
            setSavingId(null);
        }
    };

    if (!user) return null;

    const withNeedCount = users.filter(u => u.accessibilityNeeds.length > 0).length;

    return (
        <div className="page">
            <section className="hero">
                <div>
                    <h1>Accessibility needs</h1>
                    <p>
                        {withNeedCount} of {users.length} people flagged with one or more accessibility requirement{withNeedCount === 1 ? "" : "s"}.
                        Synced from Workday in production; editable here for the demo.
                    </p>
                </div>
            </section>

            {error && <section className="card"><div className="empty">{error}</div></section>}

            <section className="card">
                <header className="card-head">
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <input
                            type="text"
                            placeholder="Search name, email, or team…"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            style={{ padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 6, minWidth: 240 }}
                        />
                        <div style={{ display: "flex", gap: 4 }}>
                            <button
                                className={filter === "all" ? "primary-btn" : "ghost-btn"}
                                onClick={() => setFilter("all")}
                            >All</button>
                            <button
                                className={filter === "with-need" ? "primary-btn" : "ghost-btn"}
                                onClick={() => setFilter("with-need")}
                            >Flagged only</button>
                        </div>
                    </div>
                    <span className="hint">Showing {filtered.length}</span>
                </header>

                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                    {filtered.map(u => (
                        <div
                            key={u.id}
                            style={{
                                display: "grid",
                                gridTemplateColumns: "minmax(220px, 1fr) minmax(260px, 360px)",
                                gap: 12,
                                padding: "10px 12px",
                                border: "1px solid var(--border)",
                                borderRadius: 8,
                                alignItems: "center",
                            }}
                        >
                            <div>
                                <div style={{ fontWeight: 600 }}>{u.name}</div>
                                <div className="muted" style={{ fontSize: 12 }}>
                                    {u.email}
                                    {u.teamName && <> · {u.teamName}</>}
                                </div>
                                {u.accessibilityNeeds.length > 0 && (
                                    <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                                        Currently: {u.accessibilityNeeds.map(n => ACCESSIBILITY_LABELS[n]).join(", ")}
                                    </div>
                                )}
                            </div>
                            <MultiNeedPicker
                                selected={u.accessibilityNeeds}
                                disabled={savingId === u.id}
                                onChange={next => setNeeds(u, next)}
                            />
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}
