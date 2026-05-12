import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import type { VirtualTeam, VirtualTeamCandidate } from "../types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;
type Day = typeof DAYS[number];

function todayISO(): string {
    const d = new Date();
    return d.toISOString().slice(0, 10);
}

function addDaysISO(iso: string, days: number): string {
    const d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
    return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
        weekday: "short", month: "short", day: "numeric", year: "numeric",
    });
}

function isExpired(iso: string): boolean {
    return iso < todayISO();
}

export default function VirtualTeamsPage() {
    const { user } = useAuth();
    const [teams, setTeams] = useState<VirtualTeam[]>([]);
    const [candidates, setCandidates] = useState<VirtualTeamCandidate[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Create-form state
    const [name, setName] = useState("");
    const [start, setStart] = useState(todayISO());
    const [end, setEnd] = useState(addDaysISO(todayISO(), 14));
    const [days, setDays] = useState<Day[]>([]);
    const [memberIds, setMemberIds] = useState<Set<number>>(new Set());
    const [search, setSearch] = useState("");
    const [submitting, setSubmitting] = useState(false);

    // Extend-form state per team
    const [extendDrafts, setExtendDrafts] = useState<Record<number, string>>({});
    const [busyTeam, setBusyTeam] = useState<number | null>(null);

    const refresh = async () => {
        if (!user) return;
        setLoading(true);
        try {
            const [vt, cand] = await Promise.all([
                api.listVirtualTeams(user.id),
                api.virtualTeamCandidates(user.id),
            ]);
            setTeams(vt);
            setCandidates(cand);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id]);

    const filteredCandidates = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return candidates;
        return candidates.filter(c =>
            c.name.toLowerCase().includes(q) ||
            c.email.toLowerCase().includes(q) ||
            (c.teamName ?? "").toLowerCase().includes(q));
    }, [candidates, search]);

    if (!user) return null;

    const toggleDay = (d: Day) => {
        setDays(prev => {
            if (prev.includes(d)) return prev.filter(x => x !== d);
            if (prev.length >= 2) return prev;
            return [...prev, d];
        });
    };

    const toggleMember = (id: number) => {
        setMemberIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const submit = async () => {
        setError(null);
        if (!name.trim()) { setError("Give the team a name."); return; }
        if (days.length !== 2) { setError("Pick exactly two days."); return; }
        if (memberIds.size === 0) { setError("Add at least one member."); return; }
        if (end < start) { setError("End date must be on or after start date."); return; }

        setSubmitting(true);
        try {
            const orderedDays = DAYS.filter(d => days.includes(d)).join(",");
            await api.createVirtualTeam(user.id, {
                name: name.trim(),
                preferredDays: orderedDays,
                startDate: start,
                endDate: end,
                memberIds: Array.from(memberIds),
            });
            setName("");
            setDays([]);
            setMemberIds(new Set());
            setSearch("");
            setStart(todayISO());
            setEnd(addDaysISO(todayISO(), 14));
            await refresh();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setSubmitting(false);
        }
    };

    const extend = async (team: VirtualTeam) => {
        const draft = extendDrafts[team.id];
        if (!draft) return;
        setBusyTeam(team.id);
        try {
            await api.extendVirtualTeam(user.id, team.id, draft);
            await refresh();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusyTeam(null);
        }
    };

    const disband = async (team: VirtualTeam) => {
        if (!window.confirm(`Disband "${team.name}"? Members go back to their normal team allocation.`)) return;
        setBusyTeam(team.id);
        try {
            await api.disbandVirtualTeam(user.id, team.id);
            await refresh();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusyTeam(null);
        }
    };

    return (
        <div className="page">
            <section className="hero">
                <div>
                    <h1>Virtual teams</h1>
                    <p>
                        Pull people from different teams into a short-lived group so they get seated together.
                        While the virtual team is active, the auto-booker overrides their normal team's allocation
                        for the days you pick.
                    </p>
                </div>
            </section>

            {error && <section className="card" style={{ borderColor: "#dc2626" }}><div style={{ color: "#dc2626" }}>{error}</div></section>}

            <section className="card">
                <header className="card-head"><h2>Create virtual team</h2></header>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <span className="muted">Name</span>
                        <input
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="e.g. Q3 launch task force"
                        />
                    </label>
                    <div style={{ display: "flex", gap: 12 }}>
                        <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                            <span className="muted">Starts</span>
                            <input type="date" value={start} onChange={e => setStart(e.target.value)} />
                        </label>
                        <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                            <span className="muted">Ends</span>
                            <input type="date" value={end} min={start} onChange={e => setEnd(e.target.value)} />
                        </label>
                    </div>
                </div>

                <div style={{ marginTop: 14 }}>
                    <div className="muted" style={{ marginBottom: 6 }}>Office days (pick exactly 2)</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {DAYS.map(d => {
                            const on = days.includes(d);
                            const disabled = !on && days.length >= 2;
                            return (
                                <button
                                    key={d}
                                    type="button"
                                    onClick={() => toggleDay(d)}
                                    disabled={disabled}
                                    className={on ? "primary-btn" : "ghost-btn"}
                                    style={{ minWidth: 72, opacity: disabled ? 0.5 : 1 }}
                                >{d}</button>
                            );
                        })}
                    </div>
                </div>

                <div style={{ marginTop: 18 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16 }}>
                        <div>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, gap: 8 }}>
                                <div className="muted">People</div>
                                <input
                                    value={search}
                                    onChange={e => setSearch(e.target.value)}
                                    placeholder="Search by name, email, or team"
                                    style={{ flex: 1, maxWidth: 320 }}
                                />
                            </div>
                            <div style={{
                                maxHeight: 360, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8,
                                padding: 10, background: "var(--surface, transparent)",
                            }}>
                                {filteredCandidates.length === 0 ? (
                                    <div className="empty" style={{ padding: 16 }}>No matches.</div>
                                ) : (
                                    <div style={{
                                        display: "grid",
                                        gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                                        gap: 8,
                                    }}>
                                        {filteredCandidates.map(c => {
                                            const checked = memberIds.has(c.id);
                                            return (
                                                <button
                                                    key={c.id}
                                                    type="button"
                                                    onClick={() => toggleMember(c.id)}
                                                    aria-pressed={checked}
                                                    title={`${c.name} · ${c.teamName ?? "—"} · F${c.homeFloor ?? "?"} ${c.homeWing ?? ""}`}
                                                    style={{
                                                        textAlign: "left",
                                                        padding: "10px 12px",
                                                        borderRadius: 8,
                                                        border: checked ? "1px solid var(--primary, #2563eb)" : "1px solid var(--border)",
                                                        background: checked ? "var(--primary-soft, #e0ecff)" : "var(--surface, #fff)",
                                                        cursor: "pointer",
                                                        display: "flex",
                                                        flexDirection: "column",
                                                        gap: 4,
                                                        minHeight: 64,
                                                    }}
                                                >
                                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                                        <span
                                                            aria-hidden
                                                            style={{
                                                                width: 10, height: 10, borderRadius: 2,
                                                                background: c.teamColor ?? "#999", display: "inline-block",
                                                                flexShrink: 0,
                                                            }}
                                                        />
                                                        <span style={{
                                                            fontWeight: 600,
                                                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                                        }}>{c.name}</span>
                                                    </div>
                                                    <span className="muted" style={{
                                                        fontSize: 12,
                                                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                                    }}>
                                                        {c.teamName ?? "—"} · F{c.homeFloor ?? "?"} {c.homeWing ?? ""}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                                <div className="muted">Selected ({memberIds.size})</div>
                                {memberIds.size > 0 && (
                                    <button
                                        type="button"
                                        className="ghost-btn"
                                        onClick={() => setMemberIds(new Set())}
                                        style={{ fontSize: 12, padding: "2px 8px" }}
                                    >Clear</button>
                                )}
                            </div>
                            <div style={{
                                maxHeight: 360, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8,
                            }}>
                                {memberIds.size === 0 ? (
                                    <div className="empty" style={{ padding: 16, fontSize: 13 }}>
                                        Click people on the left to add them.
                                    </div>
                                ) : candidates
                                    .filter(c => memberIds.has(c.id))
                                    .map(c => (
                                        <div
                                            key={c.id}
                                            style={{
                                                display: "flex", alignItems: "center", gap: 10,
                                                padding: "8px 12px", borderBottom: "1px solid var(--border)",
                                            }}
                                        >
                                            <span
                                                aria-hidden
                                                style={{
                                                    width: 10, height: 10, borderRadius: 2,
                                                    background: c.teamColor ?? "#999", display: "inline-block",
                                                    flexShrink: 0,
                                                }}
                                            />
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{
                                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                                }}>{c.name}</div>
                                                <div className="muted" style={{
                                                    fontSize: 12,
                                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                                }}>
                                                    {c.teamName ?? "—"}
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => toggleMember(c.id)}
                                                aria-label={`Remove ${c.name}`}
                                                title="Remove"
                                                style={{
                                                    border: "none", background: "transparent", cursor: "pointer",
                                                    color: "var(--muted)", fontSize: 18, lineHeight: 1, padding: "0 4px",
                                                }}
                                            >×</button>
                                        </div>
                                    ))}
                            </div>
                        </div>
                    </div>
                </div>

                <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
                    <button className="primary-btn" onClick={submit} disabled={submitting}>
                        {submitting ? "Creating…" : "Create virtual team"}
                    </button>
                    <span className="hint">The system picks the home floor and wing from where most members already sit.</span>
                </div>
            </section>

            <section className="card">
                <header className="card-head"><h2>Existing virtual teams</h2></header>
                {loading ? (
                    <div className="muted">Loading…</div>
                ) : teams.length === 0 ? (
                    <div className="empty">No virtual teams yet.</div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                        {teams.map(t => {
                            const expired = isExpired(t.endDate);
                            const draft = extendDrafts[t.id] ?? t.endDate;
                            return (
                                <div
                                    key={t.id}
                                    style={{
                                        border: "1px solid var(--border)", borderRadius: 10, padding: 14,
                                        opacity: expired ? 0.6 : 1,
                                    }}
                                >
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                                        <div>
                                            <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
                                                <span aria-hidden style={{
                                                    width: 12, height: 12, borderRadius: 3,
                                                    background: t.color, display: "inline-block",
                                                }} />
                                                {t.name}
                                                {expired && <span className="hint" style={{ marginLeft: 6 }}>(ended)</span>}
                                            </h3>
                                            <div className="muted" style={{ marginTop: 4, fontSize: 14 }}>
                                                {formatDate(t.startDate)} → {formatDate(t.endDate)} · {t.preferredDays.replace(",", ", ")} · Floor {t.homeFloor} {t.homeWing} · {t.members.length} members
                                            </div>
                                            <div className="muted" style={{ marginTop: 2, fontSize: 13 }}>
                                                Created by {t.createdByName ?? "—"}
                                            </div>
                                        </div>
                                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                            <input
                                                type="date"
                                                value={draft}
                                                min={t.startDate}
                                                onChange={e => setExtendDrafts(prev => ({ ...prev, [t.id]: e.target.value }))}
                                            />
                                            <button
                                                className="ghost-btn"
                                                onClick={() => extend(t)}
                                                disabled={busyTeam === t.id || draft === t.endDate}
                                            >
                                                {busyTeam === t.id ? "Saving…" : "Update end date"}
                                            </button>
                                            <button
                                                className="ghost-btn"
                                                onClick={() => disband(t)}
                                                disabled={busyTeam === t.id}
                                                style={{ borderColor: "#dc2626", color: "#dc2626" }}
                                            >Disband</button>
                                        </div>
                                    </div>
                                    <details style={{ marginTop: 10 }}>
                                        <summary style={{ cursor: "pointer", color: "var(--muted)" }}>
                                            {t.members.length} member{t.members.length === 1 ? "" : "s"}
                                        </summary>
                                        <ul style={{ margin: "8px 0 0 0", padding: 0, listStyle: "none", display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 4 }}>
                                            {t.members.map(m => (
                                                <li key={m.userId} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                                                    <span aria-hidden style={{
                                                        width: 8, height: 8, borderRadius: 2,
                                                        background: m.teamColor ?? "#999", display: "inline-block",
                                                    }} />
                                                    <span>{m.name}</span>
                                                    <span className="muted">· {m.teamName ?? "—"}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </details>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>
        </div>
    );
}
