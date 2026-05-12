import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import type { Team } from "../types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;
type Day = typeof DAYS[number];

function parseDays(raw: string | null): Day[] {
    if (!raw) return [];
    return raw.split(",").map(s => s.trim()).filter((s): s is Day => (DAYS as readonly string[]).includes(s));
}

function formatDays(days: Day[]): string {
    const ordered = DAYS.filter(d => days.includes(d));
    return ordered.join(", ");
}

export default function TeamDaysPage() {
    const { user } = useAuth();
    const [teams, setTeams] = useState<Team[]>([]);
    const [drafts, setDrafts] = useState<Record<number, Day[]>>({});
    const [status, setStatus] = useState<Record<number, string | null>>({});
    const [saving, setSaving] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);

    const myTeams = useMemo(
        () => teams.filter(t => user && t.managerUserId === user.id),
        [teams, user],
    );

    useEffect(() => {
        api.listTeams().then(t => {
            setTeams(t);
            setLoading(false);
        });
    }, []);

    useEffect(() => {
        // Seed drafts from each team's pending request, falling back to assigned days.
        const seed: Record<number, Day[]> = {};
        for (const t of myTeams) {
            seed[t.id] = parseDays(t.requestedDays ?? t.preferredDays);
        }
        setDrafts(seed);
    }, [myTeams]);

    if (!user) return null;

    const toggle = (teamId: number, day: Day) => {
        setDrafts(prev => {
            const cur = prev[teamId] ?? [];
            if (cur.includes(day)) return { ...prev, [teamId]: cur.filter(d => d !== day) };
            if (cur.length >= 2) return prev; // cap at 2
            return { ...prev, [teamId]: [...cur, day] };
        });
        setStatus(prev => ({ ...prev, [teamId]: null }));
    };

    const submit = async (team: Team) => {
        const picked = drafts[team.id] ?? [];
        if (picked.length !== 2) {
            setStatus(prev => ({ ...prev, [team.id]: "Pick exactly 2 days." }));
            return;
        }
        setSaving(team.id);
        try {
            const days = DAYS.filter(d => picked.includes(d)).join(",");
            const res = await api.requestTeamDays(user.id, team.id, days);
            setTeams(prev => prev.map(t => t.id === team.id ? { ...t, requestedDays: res.requestedDays } : t));
            setStatus(prev => ({ ...prev, [team.id]: "Sent — awaiting admin approval." }));
        } catch (e) {
            setStatus(prev => ({ ...prev, [team.id]: (e as Error).message }));
        } finally {
            setSaving(null);
        }
    };

    return (
        <div className="page">
            <section className="hero">
                <div>
                    <h1>Team days</h1>
                    <p>
                        Pick the two weekdays you'd like your team in the office. Your request goes to the
                        office admin, who balances the building before applying it.
                    </p>
                </div>
            </section>

            {loading ? (
                <div className="muted">Loading…</div>
            ) : myTeams.length === 0 ? (
                <section className="card">
                    <div className="empty">You don't manage any teams yet.</div>
                </section>
            ) : (
                myTeams.map(team => {
                    const picked = drafts[team.id] ?? [];
                    const assigned = parseDays(team.preferredDays);
                    const requested = parseDays(team.requestedDays);
                    const dirty = formatDays(picked) !== formatDays(requested.length ? requested : assigned);
                    return (
                        <section key={team.id} className="card">
                            <header className="card-head">
                                <div>
                                    <h2 style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                        <span
                                            aria-hidden
                                            style={{
                                                width: 12, height: 12, borderRadius: 3,
                                                background: team.color, display: "inline-block",
                                            }}
                                        />
                                        {team.name}
                                    </h2>
                                    <div className="muted" style={{ marginTop: 4 }}>
                                        {team.memberCount} members · Floor {team.homeFloor} · {team.homeWing}
                                    </div>
                                </div>
                            </header>

                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                                {DAYS.map(d => {
                                    const isOn = picked.includes(d);
                                    const disabled = !isOn && picked.length >= 2;
                                    return (
                                        <button
                                            key={d}
                                            type="button"
                                            onClick={() => toggle(team.id, d)}
                                            disabled={disabled}
                                            className={isOn ? "primary-btn" : "ghost-btn"}
                                            style={{ minWidth: 72, opacity: disabled ? 0.5 : 1 }}
                                        >
                                            {d}
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="hint" style={{ marginTop: 12 }}>
                                Currently assigned: <strong>{formatDays(assigned) || "—"}</strong>
                                {requested.length > 0 && (
                                    <> · Pending request: <strong>{formatDays(requested)}</strong></>
                                )}
                            </div>

                            <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center" }}>
                                <button
                                    className="primary-btn"
                                    onClick={() => submit(team)}
                                    disabled={saving === team.id || !dirty || picked.length !== 2}
                                >
                                    {saving === team.id ? "Sending…" : "Submit preference"}
                                </button>
                                {status[team.id] && <span className="hint">{status[team.id]}</span>}
                            </div>
                        </section>
                    );
                })
            )}
        </div>
    );
}
