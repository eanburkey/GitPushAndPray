import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import type { DayPlanner, DayPlannerTeam } from "../types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;
type Day = typeof DAYS[number];

function parseDays(raw: string | null | undefined): Day[] {
    if (!raw) return [];
    return raw.split(",").map(s => s.trim()).filter((s): s is Day => (DAYS as readonly string[]).includes(s));
}

function formatDays(days: Day[]): string {
    return DAYS.filter(d => days.includes(d)).join(",");
}

function dayPillStyle(load: number, target: number): React.CSSProperties {
    if (target <= 0) return {};
    const ratio = load / target;
    if (ratio > 1.25) return { background: "#fee2e2", color: "#991b1b" };
    if (ratio < 0.75) return { background: "#dbeafe", color: "#1e40af" };
    return { background: "#dcfce7", color: "#166534" };
}

export default function PlannerPage() {
    const { user } = useAuth();
    const [data, setData] = useState<DayPlanner | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [savingTeamId, setSavingTeamId] = useState<number | null>(null);
    const [applyingAll, setApplyingAll] = useState(false);
    const [drafts, setDrafts] = useState<Record<number, Day[]>>({});
    const [search, setSearch] = useState("");

    const load = async () => {
        if (!user) return;
        try {
            const d = await api.dayPlanner(user.id);
            setData(d);
            const fresh: Record<number, Day[]> = {};
            for (const t of d.teams) fresh[t.id] = parseDays(t.preferredDays);
            setDrafts(fresh);
        } catch (e) {
            setError((e as Error).message);
        }
    };

    useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user]);

    const projected = useMemo(() => {
        if (!data) return [0, 0, 0, 0, 0];
        const totals = [0, 0, 0, 0, 0];
        for (const t of data.teams) {
            const draft = drafts[t.id] ?? parseDays(t.preferredDays);
            draft.forEach(d => {
                totals[DAYS.indexOf(d)] += t.memberCount;
            });
        }
        return totals;
    }, [data, drafts]);

    if (!user) return null;
    if (error) return <div className="page"><section className="card"><div className="empty">{error}</div></section></div>;
    if (!data) return <div className="page"><div className="muted">Loading planner…</div></div>;

    const toggle = (teamId: number, day: Day) => {
        setDrafts(prev => {
            const cur = prev[teamId] ?? [];
            if (cur.includes(day)) return { ...prev, [teamId]: cur.filter(d => d !== day) };
            if (cur.length >= 2) return prev;
            return { ...prev, [teamId]: [...cur, day] };
        });
    };

    const useSuggestion = (team: DayPlannerTeam) => {
        setDrafts(prev => ({ ...prev, [team.id]: parseDays(team.suggestedDays) }));
    };

    const useRequest = (team: DayPlannerTeam) => {
        if (!team.requestedDays) return;
        setDrafts(prev => ({ ...prev, [team.id]: parseDays(team.requestedDays) }));
    };

    const save = async (team: DayPlannerTeam) => {
        const picked = drafts[team.id] ?? [];
        if (picked.length !== 2) return;
        setSavingTeamId(team.id);
        try {
            await api.setAssignedDays(user.id, team.id, formatDays(picked));
            // Update preferredDays and clear requestedDays locally for this team
            if (data) {
                const updatedTeams = data.teams.map(t =>
                    t.id === team.id
                        ? { ...t, preferredDays: formatDays(picked), requestedDays: null }
                        : t
                );
                setData({ ...data, teams: updatedTeams });
                setDrafts(prev => ({ ...prev, [team.id]: [...picked] }));
            }
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setSavingTeamId(null);
        }
    };

    const applyAll = async () => {
        if (!confirm("Apply the suggested days to every team? This overwrites all current assignments.")) return;
        setApplyingAll(true);
        try {
            await api.applyAllSuggestions(user.id);
            await load();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setApplyingAll(false);
        }
    };

    const target = data.targetPerDay;
    const pendingCount = data.teams.filter(t => t.requestedDays).length;

    return (
        <div className="page">
            <section className="hero">
                <div>
                    <h1>Office planner</h1>
                    <p>
                        {data.totalPeople} people · target {target.toFixed(1)} in office per day.
                        {pendingCount > 0 && ` · ${pendingCount} pending manager request${pendingCount === 1 ? "" : "s"}.`}
                    </p>
                </div>
                <div className="hero-actions">
                    <button className="primary-btn" onClick={applyAll} disabled={applyingAll}>
                        {applyingAll ? "Applying…" : "Apply suggestion to all"}
                    </button>
                </div>
            </section>

            <section className="card">
                <header className="card-head">
                    <h2>Day load</h2>
                    <div className="hint">Headcount per day — current vs. projected from your edits.</div>
                </header>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginTop: 8 }}>
                    {DAYS.map((d, i) => {
                        const dayInfo = data.days[i];
                        return (
                            <div key={d} className="card" style={{ padding: 12, boxShadow: "none", border: "1px solid var(--border)" }}>
                                <div style={{ fontWeight: 600 }}>{d}</div>
                                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                                    <span className="tag" style={dayPillStyle(projected[i], target)}>
                                        Projected {projected[i]}
                                    </span>
                                    <span className="tag tag-mandatory">Now {dayInfo.assignedHeadcount}</span>
                                </div>
                                <div className="hint" style={{ marginTop: 6 }}>
                                    Requested by managers: {dayInfo.requestedHeadcount}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>

            <section className="card">
                <header className="card-head">
                    <h2>Teams</h2>
                    <div className="hint">
                        Pending requests are listed first. Click days to edit, or use the suggestion / request buttons.
                    </div>
                </header>
                <div style={{ margin: "10px 0 16px 0" }}>
                    <input
                        type="text"
                        placeholder="Search teams by name..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        style={{ width: 520, padding: "6px 10px", fontSize: 16 }}
                    />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
                    {[...data.teams]
                        .filter(team => team.name.toLowerCase().includes(search.trim().toLowerCase()))
                        .sort((a, b) => {
                            const ap = a.requestedDays ? 0 : 1;
                            const bp = b.requestedDays ? 0 : 1;
                            if (ap !== bp) return ap - bp;
                            return b.memberCount - a.memberCount;
                        })
                        .map(team => {
                            const picked = drafts[team.id] ?? parseDays(team.preferredDays);
                            const assigned = parseDays(team.preferredDays);
                            const requested = parseDays(team.requestedDays);
                            const suggested = parseDays(team.suggestedDays);
                            const dirty = formatDays(picked) !== formatDays(assigned);

                            return (
                                <div
                                    key={team.id}
                                    style={{
                                        border: "1px solid var(--border)",
                                        borderRadius: 10,
                                        padding: "12px 14px",
                                        display: "grid",
                                        gridTemplateColumns: "minmax(220px, 1fr) auto auto auto",
                                        gap: 14,
                                        alignItems: "center",
                                    }}
                                >
                                    <div>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
                                            <span
                                                aria-hidden
                                                style={{ width: 10, height: 10, borderRadius: 3, background: team.color }}
                                            />
                                            {team.name}
                                            {requested.length > 0 && (
                                                <span className="tag tag-manual" style={{ marginLeft: 6 }}>
                                                    Pending: {requested.join(", ")}
                                                </span>
                                            )}
                                        </div>
                                        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                                            {team.memberCount} people · Floor {team.homeFloor} · {team.homeWing}
                                            {team.managerName && <> · Mgr {team.managerName}</>}
                                        </div>
                                    </div>

                                    <div style={{ display: "flex", gap: 4 }}>
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
                                                    style={{ padding: "6px 10px", minWidth: 56, opacity: disabled ? 0.5 : 1 }}
                                                >
                                                    {d}
                                                </button>
                                            );
                                        })}
                                    </div>

                                    <div style={{ display: "flex", gap: 6 }}>
                                        {requested.length > 0 && (
                                            <button
                                                className="ghost-btn"
                                                onClick={() => useRequest(team)}
                                                title={`Take manager's request: ${requested.join(", ")}`}
                                            >
                                                Use request
                                            </button>
                                        )}
                                        <button
                                            className="ghost-btn"
                                            onClick={() => useSuggestion(team)}
                                            title={`Take balanced suggestion: ${suggested.join(", ")}`}
                                        >
                                            Use suggestion ({suggested.join(",")})
                                        </button>
                                    </div>

                                    <button
                                        className="primary-btn"
                                        onClick={() => save(team)}
                                        disabled={!dirty || picked.length !== 2 || savingTeamId === team.id}
                                    >
                                        {savingTeamId === team.id ? "Saving…" : "Save"}
                                    </button>
                                </div>
                            );
                        })}
                </div>
            </section>
        </div>
    );
}
